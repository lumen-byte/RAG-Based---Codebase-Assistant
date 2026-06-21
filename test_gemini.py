import os
from google import genai
client = genai.Client()
try:
    response = client.models.embed_content(
        model="text-embedding-004",
        contents="Hello world",
        config={"output_dimensionality": 384}
    )
    print("004 success, dims:", len(response.embeddings[0].values))
except Exception as e:
    print("004 error:", e)

try:
    response = client.models.embed_content(
        model="models/embedding-001",
        contents="Hello world"
    )
    print("001 success, dims:", len(response.embeddings[0].values))
except Exception as e:
    print("001 error:", e)
