import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

# Import our custom RAG modules
from app.config import EMBEDDING_BATCH_SIZE
from app.auth.dependencies import get_current_user
from app.ingestion.code_chunker import PythonCodeChunker
from app.ingestion.embedder import CodeEmbedder
from app.retrieval.vector_store import VectorDBClient
from app.services.github_fetcher import GithubFetcher
from app.services.repository_analyzer import RepositoryAnalyzer
from app.db.database import get_db, SessionLocal
from app.db.models import RepositorySummary, User

# Configure a module-level logger
logger = logging.getLogger(__name__)

# Initialize the router for this endpoint group
router = APIRouter(
    prefix="/api/v1/ingestion",
    tags=["Ingestion Pipeline"]
)

# Global dictionary to track ingestion status
# Format: url -> {"status": "processing"|"completed"|"failed", "progress": 0-100, "error": None, "repo_id": None}
ingestion_status_tracker: Dict[str, Dict[str, Any]] = {}

class IngestRequest(BaseModel):
    repo_url: HttpUrl

class IngestResponse(BaseModel):
    message: str
    status: str

class StatusResponse(BaseModel):
    status: str
    progress: int
    error: Optional[str] = None
    repo_id: Optional[str] = None


def _run_ingestion_task(url_str: str):
    """Background task to process repository ingestion without blocking the HTTP response."""
    ingestion_status_tracker[url_str] = {"status": "processing", "progress": 0, "error": None, "repo_id": None}
    
    # Create an independent DB session for this background thread
    db = SessionLocal()
    try:
        github_fetcher = GithubFetcher()
        code_chunker = PythonCodeChunker()
        embedder = CodeEmbedder()
        vector_db = VectorDBClient()
        analyzer = RepositoryAnalyzer()
        
        # 1. Fetch
        logger.info(f"Starting GitHub fetch for {url_str}...")
        fetched_data = github_fetcher.fetch_code_files(repo_url=url_str)
        files = fetched_data.get("code_files", [])
        metadata_files = fetched_data.get("metadata_files", [])
        
        if not files:
            raise ValueError("No supported code files found in the given repository.")
            
        ingestion_status_tracker[url_str]["progress"] = 5
        
        # 2. Analyze & Save
        logger.info("Analyzing repository metadata...")
        summary_json = analyzer.analyze(metadata_files)
        
        existing_summary = db.query(RepositorySummary).filter_by(repo_url=url_str).first()
        if existing_summary:
            existing_summary.summary_json = summary_json
            db.commit()
            repo_id = str(existing_summary.id)
        else:
            new_summary = RepositorySummary(repo_url=url_str, summary_json=summary_json)
            db.add(new_summary)
            db.commit()
            db.refresh(new_summary)
            repo_id = str(new_summary.id)
            
        ingestion_status_tracker[url_str]["repo_id"] = repo_id
        ingestion_status_tracker[url_str]["progress"] = 15
        
        # 3. Chunk
        logger.info("Chunking code files...")
        all_chunks: List[Dict[str, Any]] = []
        for file_obj in files:
            file_path = file_obj.get("path", "")
            content = file_obj.get("content", "")
            if file_path.endswith(".py"):
                chunks = code_chunker.chunk_code(source_code=content, file_path=file_path)
                all_chunks.extend(chunks)
                
        if not all_chunks:
            raise ValueError("No indexable Python chunks (classes/functions) found.")
            
        ingestion_status_tracker[url_str]["progress"] = 25
        
        # 4. Embed in Batches
        logger.info(f"Starting batched embeddings for {len(all_chunks)} chunks...")
        embeddings = []
        successful_chunks = []
        total_batches = (len(all_chunks) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE
        
        for i in range(0, len(all_chunks), EMBEDDING_BATCH_SIZE):
            batch = all_chunks[i:i + EMBEDDING_BATCH_SIZE]
            batch_texts = [chunk["content"] for chunk in batch]
            
            success = False
            # Exponential backoff for API limits (especially Gemini 15 RPM)
            for attempt in range(3):
                try:
                    batch_embeddings = embedder.generate_embeddings_batch(batch_texts)
                    embeddings.extend(batch_embeddings)
                    successful_chunks.extend(batch)
                    success = True
                    break
                except Exception as e:
                    logger.warning(f"Batch failed on attempt {attempt + 1}: {e}")
                    # e.g., 2^0 = 1s, 2^1 = 2s, 2^2 = 4s.
                    # Or for severe limits we could sleep much longer, but we keep it simple here.
                    time.sleep((2 ** attempt) * 2) 
                    
            if not success:
                logger.error("Batch permanently failed due to repeated errors.")
                
            # Update progress between 25% and 90%
            current_batch_index = (i // EMBEDDING_BATCH_SIZE) + 1
            progress_fraction = current_batch_index / total_batches
            current_progress = 25 + int(progress_fraction * 65)
            ingestion_status_tracker[url_str]["progress"] = current_progress

        if not embeddings:
            raise RuntimeError("Failed to generate embeddings for any chunks.")
            
        # 5. Insert to Qdrant
        logger.info("Storing chunks in VectorDB...")
        vector_db.store_chunks(chunks=successful_chunks, embeddings=embeddings, repo_url=url_str)
        
        ingestion_status_tracker[url_str]["progress"] = 100
        ingestion_status_tracker[url_str]["status"] = "completed"
        logger.info("Background ingestion task completed successfully.")
        
    except Exception as e:
        logger.exception("Background ingestion failed")
        ingestion_status_tracker[url_str]["status"] = "failed"
        ingestion_status_tracker[url_str]["error"] = str(e)
    finally:
        db.close()


@router.post("/ingest", response_model=IngestResponse, status_code=202)
def ingest_repository(
    request: IngestRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> IngestResponse:
    """
    Kicks off an asynchronous ingestion pipeline for a repository.
    Returns 202 Accepted.
    """
    url_str = str(request.repo_url).rstrip("/")
    
    # Prevent duplicate concurrent ingestions
    status_info = ingestion_status_tracker.get(url_str)
    if status_info and status_info["status"] == "processing":
        return IngestResponse(message="Ingestion already in progress.", status="processing")
        
    ingestion_status_tracker[url_str] = {"status": "processing", "progress": 0, "error": None, "repo_id": None}
    background_tasks.add_task(_run_ingestion_task, url_str)
    
    return IngestResponse(message="Ingestion started.", status="processing")


@router.get("/status", response_model=StatusResponse)
def get_ingestion_status(
    repo_url: HttpUrl,
    current_user: User = Depends(get_current_user)
) -> StatusResponse:
    """
    Endpoint to poll for the real-time progress of an ingestion task.
    """
    url_str = str(repo_url).rstrip("/")
    status_info = ingestion_status_tracker.get(url_str)
    
    if not status_info:
        return StatusResponse(status="not_found", progress=0)
        
    return StatusResponse(
        status=status_info["status"],
        progress=status_info["progress"],
        error=status_info["error"],
        repo_id=status_info.get("repo_id")
    )
