import json
import logging
from typing import List

from groq import Groq
from app.config import GROQ_API_KEY

logger = logging.getLogger(__name__)

class QueryAnalyzer:
    """
    Pre-retrieval LLM routing step.
    Determines which repository modules are likely to contain the answer to a user query.
    """
    def __init__(self):
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        self.model = "llama-3.1-8b-instant"

    def detect_intent(self, question: str, main_modules: List[str]) -> List[str]:
        """
        Takes the user's question and the repository's known main modules.
        Returns a list of modules to search within, or an empty list to search the whole repo.
        """
        if not main_modules:
            return []

        system_prompt = f"""You are a query router for a RAG system.
Given a user's question and a list of available repository modules, you must determine which modules are MOST likely to contain the answer.

Available modules: {json.dumps(main_modules)}

Examples:
- Question: "How does authentication work?" -> Output: ["auth", "security", "middleware"] (if they exist)
- Question: "Where are the database models defined?" -> Output: ["models", "db"] (if they exist)
- Question: "What is the overall architecture?" -> Output: [] (search everywhere)

Output ONLY a valid JSON object matching this schema:
{{
  "selected_modules": ["module1", "module2"]
}}
If the question is too broad or you are unsure, return an empty list for "selected_modules". Do not include markdown code blocks.
"""
        
        try:
            logger.info(f"Analyzing query intent for: '{question}'")
            response = self.groq_client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": question}
                ],
                max_tokens=256,
                temperature=0.0, # Zero temperature for deterministic routing
                response_format={"type": "json_object"}
            )
            
            content = response.choices[0].message.content
            if not content:
                return []
                
            result = json.loads(content)
            selected = result.get("selected_modules", [])
            
            # Filter the selected modules to only those that actually exist in main_modules
            # (or let Qdrant handle it, but validating is safer)
            valid_selected = [m for m in selected if any(m.lower() in mm.lower() or mm.lower() in m.lower() for mm in main_modules)]
            
            logger.info(f"Query Intent Detector selected modules: {valid_selected}")
            return valid_selected

        except Exception as e:
            logger.error(f"QueryAnalyzer failed to detect intent: {e}")
            return []
