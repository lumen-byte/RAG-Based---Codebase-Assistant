import logging
from typing import List, Any

from app.config import EMBEDDING_PROVIDER, OPENAI_API_KEY, GEMINI_API_KEY

logger = logging.getLogger(__name__)


_MODEL_NAME = "all-MiniLM-L6-v2"
_model_instance = None


def _get_local_model():
    global _model_instance
    if _model_instance is None:
        from sentence_transformers import SentenceTransformer

        logger.info(f"Loading SentenceTransformer model: {_MODEL_NAME}")
        _model_instance = SentenceTransformer(_MODEL_NAME)
        logger.info("Embedding model loaded and cached in memory.")
    return _model_instance


# ---Module-level singleton for OpenAI client---
_openai_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI

        logger.info("Initializing OpenAI client for embeddings...")
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


# --- Module-level singleton for Gemini client ---
_gemini_client = None


def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        from google import genai

        logger.info("Initializing Gemini client for embeddings...")
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


class CodeEmbedder:
    """
    Converts text/code into dense vectors.
    Supports local SentenceTransformer (default), OpenAI, or Gemini embeddings (for low-memory, free deployments).
    """

    def __init__(self):
        self.provider = EMBEDDING_PROVIDER.lower()
        self.openai_client: Any = None
        self.gemini_client: Any = None
        self.local_model: Any = None

        if self.provider == "openai":
            if not OPENAI_API_KEY:
                logger.warning(
                    "EMBEDDING_PROVIDER is 'openai' but OPENAI_API_KEY is missing!"
                )
            self.openai_client = _get_openai_client()
        elif self.provider == "gemini":
            if not GEMINI_API_KEY:
                logger.warning(
                    "EMBEDDING_PROVIDER is 'gemini' but GEMINI_API_KEY is missing!"
                )
            self.gemini_client = _get_gemini_client()
        else:
            # Trigger load at startup (warm-up)
            self.local_model = _get_local_model()

    def generate_embedding(self, text: str) -> List[float]:
        """Backward compatibility: Generate embedding for a single text."""
        return self.generate_embeddings_batch([text])[0]

    def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        # Filter out empty strings to prevent API errors
        valid_texts = [t.strip() for t in texts if t and t.strip()]
        if not valid_texts:
            raise ValueError("All texts in the batch were empty.")

        try:
            if self.provider == "openai" and self.openai_client:
                response = self.openai_client.embeddings.create(
                    model="text-embedding-3-small",
                    input=valid_texts,
                    dimensions=384,  # Matches the dimension of all-MiniLM-L6-v2
                )
                return [item.embedding for item in response.data]
            
            elif self.provider == "gemini" and self.gemini_client:
                # Generate embeddings in batch
                response = self.gemini_client.models.embed_content(
                    model="text-embedding-004",
                    contents=valid_texts,
                    config={"output_dimensionality": 384},
                )
                return [emb.values for emb in response.embeddings]
                
            elif self.local_model:
                return self.local_model.encode(
                    valid_texts, normalize_embeddings=True
                ).tolist()
                
            else:
                raise RuntimeError("No embedding provider is properly initialized.")
        except Exception as e:
            logger.error(f"Batch embedding failed: {e}")
            raise RuntimeError(f"Failed to generate embeddings batch: {e}")
