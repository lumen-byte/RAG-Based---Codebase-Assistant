import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

from app.services.github_fetcher import GithubFetcher
fetcher = GithubFetcher()
try:
    print("Validating repo...")
    exists = fetcher.validate_repo_exists("https://github.com/lumen-byte/RAG-Based---Codebase-Assistant")
    print("Exists:", exists)
    if exists:
        print("Fetching files...")
        data = fetcher.fetch_code_files("https://github.com/lumen-byte/RAG-Based---Codebase-Assistant")
        print("Found code files:", len(data.get("code_files", [])))
except Exception as e:
    print("Error:", e)

from app.ingestion.embedder import CodeEmbedder
try:
    embedder = CodeEmbedder()
    emb = embedder.generate_embeddings_batch(["test text"])
    print("Embeddings worked!")
except Exception as e:
    print("Embedding Error:", type(e).__name__, e)

