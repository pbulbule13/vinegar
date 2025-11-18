import numpy as np
from typing import List, Tuple
from openai import AsyncOpenAI
from src.utils.config import settings
from src.utils.logger import logger


class VectorStore:
    """Vector operations for embeddings and similarity search"""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.embeddings_cache = {}

    async def get_embedding(self, text: str) -> List[float]:
        """Get embedding for a text using OpenAI"""
        if text in self.embeddings_cache:
            return self.embeddings_cache[text]

        try:
            response = await self.client.embeddings.create(
                model=settings.EMBEDDING_MODEL,
                input=text
            )
            embedding = response.data[0].embedding
            self.embeddings_cache[text] = embedding
            return embedding
        except Exception as e:
            logger.error(f"Error getting embedding: {e}")
            return []

    def cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors"""
        if not vec1 or not vec2:
            return 0.0

        v1 = np.array(vec1)
        v2 = np.array(vec2)

        dot_product = np.dot(v1, v2)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return float(dot_product / (norm1 * norm2))

    async def find_similar(
        self,
        query_embedding: List[float],
        knowledge_base: List[dict],
        top_k: int = 5
    ) -> List[Tuple[dict, float]]:
        """Find most similar items from knowledge base"""
        similarities = []

        for item in knowledge_base:
            if 'embedding' in item:
                similarity = self.cosine_similarity(query_embedding, item['embedding'])
                similarities.append((item, similarity))

        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities[:top_k]


vector_store = VectorStore()
