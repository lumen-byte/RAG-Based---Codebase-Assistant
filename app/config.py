from dotenv import load_dotenv
import os

load_dotenv()

# --- Database ---
DATABASE_URL = os.getenv("DATABASE_URL")

# --- Authentication ---
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY", "").strip()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173,http://127.0.0.1:5173").strip()

# --- GitHub ---
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
MAX_FILES_TO_INDEX = int(os.getenv("MAX_FILES_TO_INDEX", "200"))

# --- Vector Database ---
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost").strip()
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
QDRANT_URL = os.getenv("QDRANT_URL", "").strip()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "").strip()

# --- Local LLM (fallback) ---
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# --- LLM Provider ---
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")  # 'groq' or 'ollama'

# --- Groq Cloud LLM (primary — fast & free) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()

# --- Embeddings (Local vs OpenAI vs Gemini) ---
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local").strip()  # 'local', 'openai', or 'gemini'
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "100"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()