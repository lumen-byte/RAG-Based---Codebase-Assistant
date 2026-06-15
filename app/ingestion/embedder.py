import logging
from typing import List
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# --- Module-level singleton ---
# The model is loaded ONCE when the Python process starts, not per-request.
# This avoids the expensive ~2s model load on every query.
_MODEL_NAME = "all-MiniLM-L6-v2"
_model_instance: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model_instance
    if _model_instance is None:
        logger.info(f"Loading SentenceTransformer model: {_MODEL_NAME}")
        _model_instance = SentenceTransformer(_MODEL_NAME)
        logger.info("Embedding model loaded and cached in memory.")
    return _model_instance


class CodeEmbedder:
    """
    Converts text/code into dense vectors using a cached local SentenceTransformer.
    The underlying model is a process-level singleton — only loaded once.
    """

    def __init__(self):
        # Trigger load at startup (warm-up), not at first request
        self.model = _get_model()

    def generate_embedding(self, text: str) -> List[float]:
        if not text or not text.strip():
            raise ValueError("Cannot generate embedding for an empty string.")
        try:
            return self.model.encode(text.strip(), normalize_embeddings=True).tolist()
        except Exception as e:
            logger.error(f"Embedding failed: {e}")
            raise RuntimeError(f"Failed to generate embedding: {e}")
