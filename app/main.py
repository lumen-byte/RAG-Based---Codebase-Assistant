import logging
import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging before any imports that use loggers
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Auth router removed (Clerk handles it)
import uvicorn
# Triggering reload to clear threadpool deadlocks
from app.api.ingestion_routes import router as ingestion_router
from app.api.rag_routes import router as rag_router
from app.api.repository_routes import router as repository_router

from app.db.database import Base, engine
from app.db import models
from app.config import FRONTEND_URL, QDRANT_URL, QDRANT_HOST, QDRANT_PORT, LLM_PROVIDER, OLLAMA_BASE_URL

# Re-create all tables defined in models.py if they don't exist
Base.metadata.create_all(bind=engine)

# --- Rate Limiter ---
limiter = Limiter(key_func=get_remote_address)

# Initialize FastAPI application instance
app = FastAPI(
    title="RAG-Based Codebase Assistant",
    description="Ask questions about your codebase, powered by local and cloud LLMs.",
    version="1.0.0",
)

# Attach rate limiter to the app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore

# Configure CORS so your React frontend can communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[url.strip() for url in FRONTEND_URL.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers from different feature modules
app.include_router(ingestion_router)
app.include_router(rag_router)
app.include_router(repository_router)


@app.on_event("startup")
def startup_log():
    """Log configuration status on startup for operational visibility."""
    logger.info("=" * 60)
    logger.info("  RAG-Based Codebase Assistant — Starting Up")
    logger.info("=" * 60)
    logger.info(f"  CORS Origins: {FRONTEND_URL}")
    logger.info(f"  LLM Provider: {LLM_PROVIDER}")
    logger.info(f"  Qdrant URL: {QDRANT_URL or f'http://{QDRANT_HOST}:{QDRANT_PORT}'}")
    logger.info("=" * 60)


@app.get("/")
def root():
    return {
        "message": "AI Codebase Assistant API",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    """
    Production health check endpoint.
    Verifies connectivity to all downstream services (Qdrant, Ollama/Groq).
    """
    health_status = {"status": "healthy", "services": {}}

    # Check Qdrant
    qdrant_target = QDRANT_URL if QDRANT_URL else f"http://{QDRANT_HOST}:{QDRANT_PORT}"
    try:
        resp = httpx.get(qdrant_target, timeout=3.0)
        health_status["services"]["qdrant"] = "connected" if resp.status_code == 200 else "degraded"
    except Exception:
        health_status["services"]["qdrant"] = "unreachable"
        health_status["status"] = "degraded"

    # Check LLM Provider
    if LLM_PROVIDER == "ollama":
        try:
            resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3.0)
            health_status["services"]["ollama"] = "connected" if resp.status_code == 200 else "degraded"
        except Exception:
            health_status["services"]["ollama"] = "unreachable"
            health_status["status"] = "degraded"
    else:
        # If Groq or another cloud provider is used, assume connected for backend health check
        health_status["services"]["groq"] = "configured"

    return health_status