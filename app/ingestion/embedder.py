import logging
import os
from typing import List

from openai import OpenAI, OpenAIError

# Configure a basic logger for error handling and tracking
logger = logging.getLogger(__name__)

class CodeEmbedder:
    """
    A utility class to convert raw text (like code chunks or search queries) into
    high-dimensional vector representations using OpenAI's embedding models.
    """
    
    def __init__(self, model: str = "text-embedding-3-small"):
        """
        Initialize the embedder with the specified OpenAI model.
        
        :param model: The OpenAI embedding model to use. Defaults to "text-embedding-3-small"
                      which offers an excellent balance of retrieval performance and low cost.
        """
        self.model = model
        
        # Securely retrieve the API key from environment variables
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OPENAI_API_KEY environment variable is not set. "
                "Please ensure it is defined in your .env file or environment variables."
            )
            
        # Initialize the official, thread-safe OpenAI client
        self.client = OpenAI(api_key=self.api_key)

    def generate_embedding(self, text: str) -> List[float]:
        """
        Generates a numerical vector embedding for the given text.

        :param text: The raw text (or code snippet) to embed.
        :return: A list of floats representing the dense vector embedding.
        """
        # Guard clause: avoid unnecessary API calls for empty data
        if not text or not text.strip():
            logger.warning("Attempted to embed an empty string. Returning an empty vector.")
            return []

        try:
            # Replacing newlines with spaces is a long-standing OpenAI best practice 
            # to slightly improve embedding quality and consistency.
            sanitized_text = text.replace("\n", " ")
            
            # Make the network call to OpenAI's embeddings endpoint
            response = self.client.embeddings.create(
                input=[sanitized_text],
                model=self.model
            )
            
            # Extract and return the float list
            embedding = response.data[0].embedding
            return embedding
            
        except OpenAIError as e:
            # Cleanly catch and log specific API-related errors (e.g., rate limits, invalid keys)
            logger.error(f"OpenAI API Error while generating embedding: {e}")
            raise RuntimeError(f"Failed to generate embedding due to OpenAI API error: {e}")
            
        except Exception as e:
            # Catch-all for unexpected local system/network failures
            logger.error(f"Unexpected error during embedding generation: {e}")
            raise
