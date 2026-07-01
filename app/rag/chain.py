import logging
import time
import json
from typing import Any, Dict, Generator

from groq import Groq

from app.ingestion.embedder import CodeEmbedder
from app.retrieval.vector_store import VectorDBClient
from app.rag.query_analyzer import QueryAnalyzer
from app.config import GROQ_API_KEY, GROQ_MODEL, LLM_PROVIDER

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHARS = 4000


class RAGChain:
    """
    RAG pipeline using Groq cloud inference for fast, free LLM responses.
    Groq runs Llama 3.1 8B at 200+ tokens/sec — ~100x faster than local CPU.
    """

    def __init__(self):
        self.embedder = CodeEmbedder()
        self.db_client = VectorDBClient()
        self.query_analyzer = QueryAnalyzer()
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        logger.info(f"RAGChain ready. Using Groq model: {GROQ_MODEL}")

    def _retrieve(self, question: str, repo_url: str | None = None, repo_summary: dict | None = None) -> tuple[str | None, list, dict, str]:
        """Embed the question and retrieve top relevant code chunks."""
        t_start = time.perf_counter()
        
        # Intent Detection Phase
        target_modules = None
        intent = "unknown"
        if repo_summary:
            main_modules = repo_summary.get("main_modules", [])
            if main_modules:
                analysis = self.query_analyzer.detect_intent(question, main_modules)
                target_modules = analysis.get("selected_modules", [])
                intent = analysis.get("intent", "unknown")
        
        # Vector Generation Phase
        t_embed_start = time.perf_counter()
        vector = self.embedder.generate_embedding(question)
        t_embed = time.perf_counter() - t_embed_start
        
        # Database Retrieval Phase
        t_db_start = time.perf_counter()
        results = self.db_client.search_similar(query_embedding=vector, top_k=10, target_modules=target_modules, repo_url=repo_url)
        t_db = time.perf_counter() - t_db_start
        
        metrics: Dict[str, Any] = {
            "embedding_time": t_embed,
            "retrieval_time": t_db
        }

        if not results:
            return None, [], metrics, intent

        # Confidence Scoring
        try:
            max_score = max((float(r.get("score") or 0) for r in results), default=0.0)
            confidence = "High" if max_score > 0.25 else "Low"
        except Exception:
            confidence = "Low"
        metrics["confidence"] = confidence

        # Boosting and Deduplication
        boosted_results = []
        for r in results:
            score = r.get("score", 0)
            p = r["payload"]
            fp = p.get("file_path", "").lower()
            if "readme" in fp or "main.py" in fp or "config.py" in fp:
                score += 0.1
            r["score"] = score
            boosted_results.append(r)
            
        boosted_results.sort(key=lambda x: x["score"], reverse=True)
        
        # Sort by file and line for merging
        sorted_for_merge = sorted(boosted_results, key=lambda x: (x["payload"].get("file_path", ""), x["payload"].get("start_line", 0)))
        
        merged_chunks = []
        if sorted_for_merge:
            current = sorted_for_merge[0]["payload"].copy()
            current_score = sorted_for_merge[0]["score"]
            for i in range(1, len(sorted_for_merge)):
                p = sorted_for_merge[i]["payload"]
                if p.get("file_path") == current.get("file_path") and p.get("start_line", 0) <= current.get("end_line", 0) + 10:
                    current["end_line"] = max(current.get("end_line", 0), p.get("end_line", 0))
                    current["content"] += "\n" + p.get("content", "")
                    current_score = max(current_score, sorted_for_merge[i]["score"])
                else:
                    merged_chunks.append({"score": current_score, "payload": current})
                    current = p.copy()
                    current_score = sorted_for_merge[i]["score"]
            merged_chunks.append({"score": current_score, "payload": current})

        merged_chunks.sort(key=lambda x: x["score"], reverse=True)

        context, citations = "", []
        seen_files = set()
        seen_chunks = set()

        for i, r in enumerate(merged_chunks):
            p = r["payload"]
            file_path = p.get("file_path", "unknown")
            content = p.get("content", "")
            s, e = p.get("start_line", 0), p.get("end_line", 0)
            chunk_type = p.get("chunk_type", "chunk")
            name = p.get("name", "Unknown")

            if len(content) > 800:
                content = content[:800] + "\n...[truncated]"

            chunk_id = f"{file_path}_{s}_{e}"
            if chunk_id in seen_chunks:
                continue
            seen_chunks.add(chunk_id)

            snippet = f"[{i+1}] File: {file_path} | Type: {chunk_type} | Name: {name} | Lines: {s}-{e}\n{content}\n\n"
            if len(context) + len(snippet) > MAX_CONTEXT_CHARS:
                break
            context += snippet
            
            # Keep frontend citations deduplicated by file to avoid UI clutter
            if file_path not in seen_files:
                citations.append({"file_path": file_path, "start_line": s, "end_line": e})
                seen_files.add(file_path)

        # Inject confidence context directly into snippet top
        context = f"RETRIEVAL CONFIDENCE: {confidence}\n\n" + context

        return context, citations, metrics, intent

    def _messages(self, question: str, context: str, repo_summary: dict | None = None, intent: str = "unknown") -> Any:
        """Build the chat messages list for the Groq API."""
        
        system_content = (
            "You are an expert AI codebase assistant, built to explain code cleanly to senior engineers.\n\n"
            "Your highest priority is to output HIGHLY READABLE, INTERACTIVE, AND DYNAMIC MARKDOWN.\n"
            "The user is viewing this in a modern chat interface. If you output boring, robotic walls of text, you fail.\n\n"
            "=== CRITICAL FORMATTING RULES ===\n"
            "1. NUMBERED SEQUENCES: When explaining multiple concepts, files, or steps, you MUST use a numbered sequence. Format it EXACTLY like this:\n"
            "   1. **Dynamic Concept Name:** Then explain the concept.\n"
            "   2. **Another Concept:** Then explain it.\n\n"
            "2. AGGRESSIVE BOLDING: You MUST generously use **bold text** to highlight important concepts, function names, and file names. Make the text highly scannable.\n"
            "3. EXPLICIT SPACING: You MUST add a blank line (double newline `\n\n`) after EVERY paragraph, EVERY numbered item, and EVERY complete statement. The text must be heavily spaced out to prevent clustering.\n"
            "4. DYNAMIC HEADINGS: Never use generic headings like 'Overview'. If you use an `###` heading, it MUST be highly specific to the user's question (e.g., `### Database Architecture`).\n"
            "5. NO CITATIONS AT THE END: NEVER include a 'Sources', 'References', or 'Files Used' section. The UI handles citations natively.\n"
            "6. MANDATORY CODE BLOCKS: If the user asks for 'code snippets', 'code', or if explaining code is necessary, you MUST extract and show the actual source code using full Markdown fenced code blocks (e.g., ```python\n<code here>\n```). Do not just describe the code in plain text.\n"
            "7. FINAL SUMMARY: You MUST always conclude every response with a comprehensive, detailed summary (at least 3-4 sentences or a bulleted list). The summary should thoroughly recap all key takeaways, architectural decisions, or main code functionality discussed to make the answer feel complete and substantial. You can use a `### Summary` heading.\n"
            "8. ANSWER DEPTH: By default, provide highly detailed, comprehensive, and in-depth answers that fully explore the codebase. Go deep into the architecture, edge cases, and logic. HOWEVER, if the user explicitly asks for a 'short', 'small', or 'brief' answer in their query, you MUST provide a concise, minimal response.\n\n"
            "Remember: Readability is your #1 goal. Use numbered sequences, bold text, and aggressive double-spacing to structure your answer beautifully, just like a premium AI assistant."
        )
                
        if repo_summary:
            architecture = repo_summary.get("architecture_summary", "Unknown architecture")
            project_type = repo_summary.get("project_type", "Unknown type")
            language = repo_summary.get("primary_language", "Unknown language")
            frameworks = ", ".join(repo_summary.get("frameworks", []))
            
            files_indexed = repo_summary.get("total_files", "Unknown")
            chunks_indexed = repo_summary.get("total_chunks", "Unknown")
            
            system_content += (
                f"\n\n--- GLOBAL REPOSITORY CONTEXT ---\n"
                f"Project Type: {project_type}\n"
                f"Primary Language: {language}\n"
                f"Frameworks: {frameworks}\n"
                f"Architecture Summary: {architecture}\n"
                f"Files Indexed: {files_indexed}\n"
                f"Chunks Indexed: {chunks_indexed}\n"
                f"---------------------------------\n"
            )

        return [
            {
                "role": "system",
                "content": system_content,
            },
            {
                "role": "user",
                "content": f"RETRIEVED CODE CHUNKS:\n{context}\n\nUSER QUESTION:\n{question}\n\n[MANDATORY FORMATTING INSTRUCTION: If your answer contains multiple parts, format it as a numbered list. You MUST put a full blank line (\\n\\n) between EVERY numbered item and EVERY paragraph. If the user asks for code snippets, you MUST provide full Markdown fenced code blocks (```language ... ```) containing the actual code. Use **bold** for key terms.]",
            },
        ]

    def ask_question(self, question: str, repo_url: str | None = None, repo_summary: dict | None = None) -> Dict[str, Any]:
        """Non-streaming: returns full answer + citations with accurate metrics."""
        t_start = time.perf_counter()
        
        context, citations, metrics, intent = self._retrieve(question, repo_url, repo_summary)

        if context is None:
            return {
                "answer": "No relevant code found. Please ingest a repository first.",
                "citations": [],
            }

        t_prompt_start = time.perf_counter()
        messages = self._messages(question, context, repo_summary, intent)
        t_prompt = time.perf_counter() - t_prompt_start

        t_llm_start = time.perf_counter()
        try:
            response = self.groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                max_tokens=2048,
                temperature=0.2,
            )
            content = response.choices[0].message.content
            answer = str(content).strip() if content else ""
        except Exception as e:
            logger.error(f"Groq API generation failed: {e}")
            answer = "Error generating response: Groq API is currently unavailable or returned an error. Please try again later."
            
        t_llm = time.perf_counter() - t_llm_start
        t_total = time.perf_counter() - t_start
        
        logger.info(
            f"RAG Metrics -> Total: {t_total:.2f}s | "
            f"Embed: {metrics['embedding_time']:.2f}s | "
            f"Search: {metrics['retrieval_time']:.2f}s | "
            f"Prompt: {t_prompt:.3f}s | "
            f"LLM: {t_llm:.2f}s"
        )
        
        return {"answer": answer, "citations": citations}

    def stream_question(self, question: str, repo_url: str | None = None, repo_summary: dict | None = None) -> Generator[str, None, None]:
        """
        SSE streaming via Groq. First token arrives in ~0.3-0.5s.
        Yields: 'data: {"token":"..."}\n\n' per token
                'data: {"citations":[...],"done":true}\n\n' at end
        """
        try:
            context, citations, metrics, intent = self._retrieve(question, repo_url, repo_summary)
        except Exception as e:
            logger.error(f"Retrieval error during streaming: {e}")
            err_msg = str(e)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
                user_friendly_error = "Codexa is currently receiving too many requests. Please wait about 10 seconds and try again."
            else:
                user_friendly_error = "Something went wrong while analyzing the codebase. Please try asking again in a moment."
            yield f'data: {json.dumps({"token": f"Error: {user_friendly_error}"})}\n\n'
            yield f'data: {json.dumps({"citations": [], "done": True})}\n\n'
            return

        if context is None:
            yield f'data: {json.dumps({"token": "No relevant code found. Please ingest a repository first."})}\n\n'
            yield f'data: {json.dumps({"citations": [], "done": True})}\n\n'
            return

        try:
            stream = self.groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=self._messages(question, context, repo_summary, intent),
                max_tokens=2048,
                temperature=0.2,
                stream=True,
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f'data: {json.dumps({"token": token})}\n\n'

        except Exception as e:
            logger.error(f"Groq streaming error: {e}")
            yield f'data: {json.dumps({"token": f"Error: {str(e)}"})}\n\n'

        yield f'data: {json.dumps({"citations": citations, "done": True})}\n\n'
