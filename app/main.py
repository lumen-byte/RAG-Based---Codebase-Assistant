import logging
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure logging before any imports that use loggers
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

logger = logging.getLogger(__name__)

from app.auth.routes import router as auth_router
from app.api.ingestion_routes import router as ingestion_router
from app.api.rag_routes import router as rag_router

# Create FastAPI application
app = FastAPI(
    title="AI Codebase Assistant API",
    description="RAG-based assistant for understanding GitHub repositories",
    version="1.0.0"
)

from app.db.database import Base, engine
from app.db import models

# Create tables in the database if they do not exist
Base.metadata.create_all(bind=engine)

# CORS middleware — required for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten to specific domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(ingestion_router)
app.include_router(rag_router)


@app.get("/")
def root():  # Trigger reload to pick up new GROQ_API_KEY env variable
    return {
        "message": "AI Codebase Assistant API"
    }


@app.get("/health")
def health():
    """
    Production health check endpoint.
    Verifies connectivity to all downstream services (Qdrant, Ollama).
    """
    health_status = {"status": "healthy", "services": {}}

    # Check Qdrant
    try:
        resp = httpx.get("http://localhost:6333", timeout=3.0)
        health_status["services"]["qdrant"] = "connected" if resp.status_code == 200 else "degraded"
    except Exception:
        health_status["services"]["qdrant"] = "unreachable"
        health_status["status"] = "degraded"

    # Check Ollama
    try:
        resp = httpx.get("http://localhost:11434/api/tags", timeout=3.0)
        health_status["services"]["ollama"] = "connected" if resp.status_code == 200 else "degraded"
    except Exception:
        health_status["services"]["ollama"] = "unreachable"
        health_status["status"] = "degraded"

    return health_status