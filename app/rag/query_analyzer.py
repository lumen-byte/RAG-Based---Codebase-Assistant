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

    def detect_intent(self, question: str, main_modules: List[str]) -> dict:
        """
        Takes the user's question and the repository's known main modules.
        Returns a dictionary containing the detected intent and a list of modules to search within.
        """
        default_result = {"intent": "unknown", "selected_modules": []}
        if not main_modules:
            return default_result

        system_prompt = f"""You are an advanced query router for a RAG system.
Given a user's question and a list of available repository modules, you must determine:
1. The INTENT of the question. Must be exactly one of: "architecture", "interview", "code_explanation", "repo_summary", "feature_explanation", "unknown".
2. Which modules are MOST likely to contain the answer.

Available modules: {json.dumps(main_modules)}

Examples:
- Question: "How does authentication work?" -> Intent: "feature_explanation", Modules: ["auth", "security"]
- Question: "Where are the database models defined?" -> Intent: "code_explanation", Modules: ["models", "db"]
- Question: "What is the overall architecture?" -> Intent: "architecture", Modules: []
- Question: "What are some interview questions for this codebase?" -> Intent: "interview", Modules: []

Output ONLY a valid JSON object matching this schema:
{{
  "intent": "architecture | interview | code_explanation | repo_summary | feature_explanation | unknown",
  "selected_modules": ["module1", "module2"]
}}
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
                return default_result
                
            result = json.loads(content)
            intent = result.get("intent", "unknown")
            selected = result.get("selected_modules") or []
            
            # Filter the selected modules to only those that actually exist in main_modules
            valid_selected = [m for m in selected if any(m.lower() in mm.lower() or mm.lower() in m.lower() for mm in main_modules)]
            
            final_result = {"intent": intent, "selected_modules": valid_selected}
            logger.info(f"Query Intent Detector result: {final_result}")
            return final_result

        except Exception as e:
            logger.error(f"QueryAnalyzer failed to detect intent: {e}")
            return default_result
