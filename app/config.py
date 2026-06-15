from dotenv import load_dotenv
import os

load_dotenv()

# --- Database ---
DATABASE_URL = os.getenv("DATABASE_URL")

# --- Authentication ---
JWT_SECRET = os.getenv("JWT_SECRET")

# --- GitHub ---
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# --- Vector Database ---
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

# --- Local LLM (fallback) ---
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# --- Groq Cloud LLM (primary — fast & free) ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")