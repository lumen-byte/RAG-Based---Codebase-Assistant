import logging
import time
import json
from typing import Any, Dict, Generator

from groq import Groq

from app.ingestion.embedder import CodeEmbedder
from app.retrieval.vector_store import VectorDBClient
from app.config import GROQ_API_KEY

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHARS = 2000

# llama-3.1-8b-instant: free on Groq, ~200 tokens/sec, excellent at code
GROQ_MODEL = "llama-3.1-8b-instant"


class RAGChain:
    """
    RAG pipeline using Groq cloud inference for fast, free LLM responses.
    Groq runs Llama 3.1 8B at 200+ tokens/sec — ~100x faster than local CPU.
    """

    def __init__(self):
        self.embedder = CodeEmbedder()
        self.db_client = VectorDBClient()
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        logger.info(f"RAGChain ready. Using Groq model: {GROQ_MODEL}")

    def _retrieve(self, question: str):
        """Embed the question and retrieve top-2 relevant code chunks."""
        vector = self.embedder.generate_embedding(question)
        results = self.db_client.search_similar(query_embedding=vector, top_k=2)

        if not results:
            return None, []

        context, citations = "", []
        for i, r in enumerate(results):
            p = r["payload"]
            file_path = p.get("file_path", "unknown")
            content = p.get("content", "")
            s, e = p.get("start_line", 0), p.get("end_line", 0)

            if len(content) > 800:
                content = content[:800] + "\n...[truncated]"

            snippet = f"[{i+1}] {file_path} L{s}-{e}:\n{content}\n"
            if len(context) + len(snippet) > MAX_CONTEXT_CHARS:
                break
            context += snippet
            citations.append({"file_path": file_path, "start_line": s, "end_line": e})

        return context, citations

    def _messages(self, question: str, context: str):
        """Build the chat messages list for the Groq API."""
        return [
            {
                "role": "system",
                "content": (
                    "You are an expert code analyst. You are given source code snippets "
                    "from a real project. Explain clearly what the code does, mentioning "
                    "specific class names, function names, and libraries. Be concise and accurate."
                ),
            },
            {
                "role": "user",
                "content": f"Code:\n{context}\n\nQuestion: {question}",
            },
        ]

    def ask_question(self, question: str) -> Dict[str, Any]:
        """Non-streaming: returns full answer + citations."""
        t0 = time.perf_counter()
        context, citations = self._retrieve(question)

        if context is None:
            return {
                "answer": "No relevant code found. Please ingest a repository first.",
                "citations": [],
            }

        response = self.groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=self._messages(question, context),
            max_tokens=512,
            temperature=0.2,
        )
        answer = response.choices[0].message.content.strip()
        logger.info(f"Groq RAG completed in {time.perf_counter()-t0:.2f}s")
        return {"answer": answer, "citations": citations}

    def stream_question(self, question: str) -> Generator[str, None, None]:
        """
        SSE streaming via Groq. First token arrives in ~0.3-0.5s.
        Yields: 'data: {"token":"..."}\n\n' per token
                'data: {"citations":[...],"done":true}\n\n' at end
        """
        context, citations = self._retrieve(question)

        if context is None:
            yield f'data: {json.dumps({"token": "No relevant code found. Please ingest a repository first."})}\n\n'
            yield f'data: {json.dumps({"citations": [], "done": True})}\n\n'
            return

        try:
            stream = self.groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=self._messages(question, context),
                max_tokens=512,
                temperature=0.2,
                stream=True,
            )

            for chunk in stream:
                token = chunk.choices[0].delta.content
                if token:
                    yield f'data: {json.dumps({"token": token})}\n\n'

        except Exception as e:
            logger.error(f"Groq streaming error: {e}")
            yield f'data: {json.dumps({"token": f"Error: {str(e)}"})}\n\n'

        yield f'data: {json.dumps({"citations": citations, "done": True})}\n\n'
