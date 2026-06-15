import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl

# Import our custom RAG modules
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
        
        # Step 3: Generate embeddings for each chunk
        logger.info("Starting embedding generation...")
        embeddings = []
        for chunk in all_chunks:
            # We embed the actual source code content so it can be semantically searched later
            embedding = embedder.generate_embedding(chunk["content"])
            embeddings.append(embedding)
            
        logger.info(f"Successfully generated {len(embeddings)} embeddings.")
            
        # Step 4: Store chunks and their embeddings in Qdrant
        logger.info("Starting Qdrant insertion...")
        vector_db.store_chunks(chunks=all_chunks, embeddings=embeddings)
        
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
