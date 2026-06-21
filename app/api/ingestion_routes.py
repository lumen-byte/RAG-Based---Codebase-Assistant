import logging
import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl

# Import our custom RAG modules
from app.config import EMBEDDING_BATCH_SIZE
from app.ingestion.code_chunker import PythonCodeChunker
from app.ingestion.embedder import CodeEmbedder
from app.retrieval.vector_store import VectorDBClient
from app.services.github_fetcher import GithubFetcher

# Configure a module-level logger
logger = logging.getLogger(__name__)

# Initialize the router for this endpoint group
router = APIRouter(
    prefix="/api/v1/ingestion",
    tags=["Ingestion Pipeline"]
)

class IngestRequest(BaseModel):
    """
    Pydantic schema representing the required JSON payload for ingestion.
    """
    repo_url: HttpUrl


class IngestResponse(BaseModel):
    """
    Pydantic schema representing the success response returned to the client.
    """
    message: str
    files_processed: int
    chunks_processed: int


@router.post("/ingest", response_model=IngestResponse, status_code=200)
def ingest_repository(request: IngestRequest) -> IngestResponse:
    """
    Ingests a public GitHub repository into the vector database.
    
    This is a synchronous pipeline endpoint that orchestrates:
    1. Fetching raw files from GitHub.
    2. Semantically chunking the code into classes and functions.
    3. Generating vector embeddings for every chunk.
    4. Upserting the metadata and vectors into the Qdrant database.
    """
    # HttpUrl objects return a specialized URL object, we cast it back to string.
    url_str = str(request.repo_url)
    logger.info(f"Starting ingestion process for repository: {url_str}")
    
    try:
        # Initialize our RAG pipeline services
        github_fetcher = GithubFetcher()
        code_chunker = PythonCodeChunker()
        embedder = CodeEmbedder()
        vector_db = VectorDBClient()
        
        # Step 1: Fetch raw files from the GitHub repository
        logger.info("Starting GitHub fetch...")
        files = github_fetcher.fetch_code_files(repo_url=url_str)
        
        logger.info(f"GitHub fetcher returned {len(files)} files with extensions: {list(set(f['path'].rsplit('.', 1)[-1] for f in files))}")
        
        if not files:
            raise HTTPException(status_code=400, detail="No supported code files found in the given repository. Ensure the repo is public and contains .py, .js, .ts, or other supported code files.")
            
        logger.info(f"Fetched {len(files)} files successfully.")
        
        # Step 2: Parse and chunk the code files
        logger.info("Starting code chunking...")
        all_chunks: List[Dict[str, Any]] = []
        py_files_found = [f['path'] for f in files if f['path'].endswith('.py')]
        logger.info(f"Python files available for chunking: {py_files_found}")
        
        for file_obj in files:
            file_path = file_obj.get("path", "unknown")
            content = file_obj.get("content", "")
            
            # Since our specific chunker is currently optimized for Python, 
            # we filter for `.py` files. You can expand this logic later for multi-language support.
            if file_path.endswith(".py"):
                logger.info(f"Chunking file: {file_path}")
                chunks = code_chunker.chunk_code(source_code=content, file_path=file_path)
                logger.info(f"  -> Extracted {len(chunks)} chunks from {file_path}")
                all_chunks.extend(chunks)
                
        if not all_chunks:
            raise HTTPException(
                status_code=400,
                detail=f"No indexable Python chunks (classes/functions) found. Python files found: {py_files_found}. "
                       f"Ensure the repo contains Python files with classes or functions defined at module level."
            )
            
        logger.info(f"Successfully generated {len(all_chunks)} chunks.")
        
        # Step 3: Generate embeddings for each chunk in batches
        logger.info(f"Starting batched embedding generation for {len(all_chunks)} chunks (Batch Size: {EMBEDDING_BATCH_SIZE})...")
        embeddings = []
        
        start_time = time.time()
        
        # We need a list to keep track of successfully embedded chunks (since some batches may permanently fail)
        successful_chunks = []
        
        for i in range(0, len(all_chunks), EMBEDDING_BATCH_SIZE):
            batch = all_chunks[i:i + EMBEDDING_BATCH_SIZE]
            batch_texts = [chunk["content"] for chunk in batch]
            
            batch_start_time = time.time()
            
            # Retry logic for the batch (up to 3 tries)
            retries = 3
            success = False
            for attempt in range(retries):
                try:
                    batch_embeddings = embedder.generate_embeddings_batch(batch_texts)
                    
                    # Ensure the API returned the expected number of embeddings
                    if len(batch_embeddings) != len(batch):
                        raise ValueError(f"API returned {len(batch_embeddings)} embeddings but expected {len(batch)}")
                        
                    embeddings.extend(batch_embeddings)
                    successful_chunks.extend(batch)
                    success = True
                    break
                except Exception as e:
                    logger.warning(f"Batch {i//EMBEDDING_BATCH_SIZE + 1} failed on attempt {attempt + 1}: {e}")
                    time.sleep(1) # Backoff before retry
                    
            if success:
                batch_duration = time.time() - batch_start_time
                logger.info(f"Successfully processed batch {i//EMBEDDING_BATCH_SIZE + 1} ({len(batch)} chunks) in {batch_duration:.2f}s")
            else:
                logger.error(f"Batch {i//EMBEDDING_BATCH_SIZE + 1} permanently failed after {retries} retries. Skipping {len(batch)} chunks (indexes {i} to {i+len(batch)-1}).")

        total_embedding_time = time.time() - start_time
        
        if not embeddings:
            raise HTTPException(status_code=500, detail="Failed to generate embeddings for all chunks.")
            
        logger.info(f"Completed embedding generation: {len(embeddings)} total embeddings generated in {total_embedding_time:.2f}s")
            
        # Step 4: Store chunks and their embeddings in Qdrant
        logger.info("Starting Qdrant insertion...")
        vector_db.store_chunks(chunks=successful_chunks, embeddings=embeddings)
        
        logger.info("Successfully inserted chunks into Qdrant.")
        
        logger.info("Ingestion pipeline completed successfully.")
        
        # Return cleanly formatted Pydantic response
        return IngestResponse(
            message="Repository indexed successfully",
            files_processed=len(files),
            chunks_processed=len(all_chunks)
        )
        
    except HTTPException:
        # MUST be first: re-raise FastAPI HTTP exceptions with their original status code intact
        raise

    except ValueError as ve:
        # Predictable input/configuration errors (e.g. bad GitHub URL, missing API key)
        logger.error(f"Validation error during ingestion: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))

    except Exception as e:
        # Catch-all for unexpected systemic failures (network, parsing, etc.)
        logger.exception("Unexpected error during ingestion")
        raise HTTPException(status_code=500, detail=str(e))
