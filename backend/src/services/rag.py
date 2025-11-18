from typing import List, Optional, Dict, Any
from datetime import datetime
from src.models.types import VectorSearchResult, UserProfile
from src.utils.vectors import vector_store
from src.services.firestore import firestore_service
from src.utils.logger import logger
import uuid


class RAGService:
    """Retrieval-Augmented Generation service for Personal Knowledge Graph"""

    def __init__(self):
        self.vector_store = vector_store

    async def add_knowledge(
        self,
        user_id: str,
        content: str,
        category: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Add new knowledge to the user's knowledge graph"""
        try:
            # Generate embedding
            embedding = await self.vector_store.get_embedding(content)

            if not embedding:
                logger.error("Failed to generate embedding")
                return False

            # Create knowledge node
            node_id = str(uuid.uuid4())
            node_data = {
                'id': node_id,
                'user_id': user_id,
                'content': content,
                'embedding': embedding,
                'category': category,
                'metadata': metadata or {},
                'timestamp': datetime.utcnow()
            }

            # Save to Firestore
            success = await firestore_service.save_knowledge(node_id, node_data)

            if success:
                logger.info(f"Added knowledge node: {content[:50]}...")

            return success

        except Exception as e:
            logger.error(f"Error adding knowledge: {e}")
            return False

    async def search_knowledge(
        self,
        user_id: str,
        query: str,
        category: Optional[str] = None,
        top_k: int = 5
    ) -> List[VectorSearchResult]:
        """Search the knowledge graph using semantic similarity"""
        try:
            # Get query embedding
            query_embedding = await self.vector_store.get_embedding(query)

            if not query_embedding:
                logger.error("Failed to generate query embedding")
                return []

            # Fetch user's knowledge base
            knowledge_base = await firestore_service.query_knowledge(
                user_id=user_id,
                category=category
            )

            if not knowledge_base:
                logger.warning(f"No knowledge found for user {user_id}")
                return []

            # Find similar items
            similar_items = await self.vector_store.find_similar(
                query_embedding,
                knowledge_base,
                top_k=top_k
            )

            # Convert to VectorSearchResult
            results = [
                VectorSearchResult(
                    content=item['content'],
                    similarity=similarity,
                    metadata=item.get('metadata', {})
                )
                for item, similarity in similar_items
            ]

            logger.info(f"Found {len(results)} relevant knowledge items")
            return results

        except Exception as e:
            logger.error(f"Error searching knowledge: {e}")
            return []

    async def get_context_for_query(
        self,
        user_id: str,
        query: str,
        max_context_length: int = 2000
    ) -> str:
        """Get relevant context from knowledge graph for a query"""
        results = await self.search_knowledge(user_id, query, top_k=5)

        context_parts = []
        total_length = 0

        for result in results:
            content_length = len(result.content)
            if total_length + content_length <= max_context_length:
                context_parts.append(f"- {result.content}")
                total_length += content_length
            else:
                break

        if context_parts:
            return "Relevant context from your knowledge graph:\n" + "\n".join(context_parts)
        else:
            return ""

    async def initialize_default_knowledge(self, user_profile: UserProfile) -> bool:
        """Initialize default knowledge for a new user (Prashil's profile)"""
        default_knowledge = [
            {
                'content': f"{user_profile.name} is an AIML engineer and executive focused on cutting-edge AI technologies.",
                'category': 'profile',
                'metadata': {'source': 'system'}
            },
            {
                'content': f"Working hours: {user_profile.preferences.working_hours.start} to {user_profile.preferences.working_hours.end}",
                'category': 'preferences',
                'metadata': {'source': 'system'}
            },
            {
                'content': "Preferred communication style: direct, witty, supportive, and friendly like Jarvis from Iron Man",
                'category': 'preferences',
                'metadata': {'source': 'system'}
            },
            {
                'content': "Primary focus areas: AI/ML development, multi-agent systems, production-grade deployments",
                'category': 'interests',
                'metadata': {'source': 'system'}
            },
            {
                'content': "Technology stack: Python, FastAPI, React, Google Cloud Platform, Anthropic Claude, OpenAI",
                'category': 'technical',
                'metadata': {'source': 'system'}
            }
        ]

        success_count = 0
        for item in default_knowledge:
            if await self.add_knowledge(
                user_id=user_profile.id,
                content=item['content'],
                category=item['category'],
                metadata=item['metadata']
            ):
                success_count += 1

        logger.info(f"Initialized {success_count}/{len(default_knowledge)} default knowledge items")
        return success_count == len(default_knowledge)


rag_service = RAGService()
