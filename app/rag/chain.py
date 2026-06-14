import os
from typing import Any, Dict

from openai import OpenAI

# Import the tools we built earlier
from app.ingestion.embedder import CodeEmbedder
from app.retrieval.vector_store import VectorDBClient

class RAGChain:
    """
    This class ties everything together! It acts as the brain of the assistant.
    It takes a user's question, finds the relevant code from the database, 
    and asks the AI to answer the question using that specific code.
    """
    
    def __init__(self):
        """
        Initialize the core tools we need: the embedder, the database client, 
        and the OpenAI client.
        """
        self.embedder = CodeEmbedder()
        self.db_client = VectorDBClient()
        
        # We use the official OpenAI client to talk to GPT-4o-mini
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not set. Please set it in your .env file.")
            
        self.openai_client = OpenAI(api_key=api_key)
        
    def ask_question(self, question: str) -> Dict[str, Any]:
        """
        Answers a question about the codebase and provides exactly where it found the answer.
        
        :param question: The user's question (e.g., "Where is the user password hashed?")
        :return: A dictionary containing the text 'answer' and a list of 'citations'.
        """
        # Step 1: Turn the user's question into a mathematical vector (embedding)
        query_vector = self.embedder.generate_embedding(question)
        
        # Step 2: Search the vector database for the top 5 most relevant code chunks
        search_results = self.db_client.search_similar(query_embedding=query_vector, top_k=5)
        
        # Step 3: Build a "Context String" and collect citations
        # We will paste all the retrieved code into one big string to show the AI.
        context_string = ""
        citations = []
        
        for idx, result in enumerate(search_results):
            # Extract the stored data (payload) from the database result
            payload = result["payload"]
            file_path = payload.get("file_path", "unknown_file")
            content = payload.get("content", "")
            start_line = payload.get("start_line", 0)
            end_line = payload.get("end_line", 0)
            
            # Add this code chunk to our big context string so the AI can read it
            context_string += f"\n--- Code Snippet {idx + 1} ---\n"
            context_string += f"File: {file_path} (Lines {start_line}-{end_line})\n"
            context_string += f"{content}\n"
            
            # Save the citation info to return to the user later
            citations.append({
                "file_path": file_path,
                "start_line": start_line,
                "end_line": end_line
            })

        # Step 4: Write the prompt for GPT-4o-mini
        # We tell the AI how to behave and give it the code context.
        system_prompt = (
            "You are an expert programming assistant. Answer the user's question "
            "based ONLY on the provided code snippets. If the answer is not in the "
            "code snippets, politely say 'I cannot find the answer in the provided codebase.' "
            "Keep your explanation clear, professional, and beginner-friendly."
        )
        
        user_prompt = f"Code Context:\n{context_string}\n\nUser Question: {question}"
        
        # Step 5: Send it to OpenAI!
        response = self.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2  # A low temperature keeps the AI focused, factual, and less "creative"
        )
        
        # Extract the text answer from the AI's response
        answer_text = response.choices[0].message.content
        
        # Step 6: Return the final packaged answer and citations
        return {
            "answer": answer_text,
            "citations": citations
        }
