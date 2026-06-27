import asyncio
from dotenv import load_dotenv
load_dotenv()
from app.api.ingestion_routes import _run_ingestion_task, ingestion_status_tracker

url = "https://github.com/lumen-byte/RAG-Based---Codebase-Assistant"
try:
    _run_ingestion_task(url)
    print("Final status:", ingestion_status_tracker[url])
except Exception as e:
    print("Failed hard:", e)
