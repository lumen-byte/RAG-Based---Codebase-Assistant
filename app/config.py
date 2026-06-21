from dotenv import load_dotenv
import os

load_dotenv()

# --- Database ---
DATABASE_URL = os.getenv("DATABASE_URL")

# --- Authentication ---
JWT_SECRET = os.getenv("JWT_SECRET")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

# --- GitHub ---
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# --- Vector Database ---
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")

# --- Local LLM (fallback) ---
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# --- Groq Cloud LLM (primary — fast & free) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# --- Embeddings (Local vs OpenAI vs Gemini) ---
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local")  # 'local', 'openai', or 'gemini'
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "10"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")