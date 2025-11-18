import pytest
from datetime import datetime
from unittest.mock import Mock, patch, AsyncMock
from src.services.rag import rag_service
from src.models.types import UserProfile, UserPreferences, WorkingHours, EmotionalState, MoodType


@pytest.fixture
def sample_user():
    """Sample user for testing"""
    return UserProfile(
        id="test-user-rag",
        name="Test User",
        email="test@example.com",
        preferences=UserPreferences(
            wake_word="VINEGAR",
            voice_id="test-voice",
            timezone="America/Los_Angeles",
            working_hours=WorkingHours(start="09:00", end="18:00")
        ),
        goals=[],
        relationships=[],
        achievements=[],
        emotional_state=EmotionalState(
            current_mood=MoodType.NEUTRAL,
            confidence=0.8,
            timestamp=datetime.utcnow()
        ),
        knowledge_graph=[]
    )


@pytest.mark.asyncio
@patch('src.services.rag.vector_store')
@patch('src.services.rag.firestore_service')
async def test_add_knowledge(mock_firestore, mock_vector, sample_user):
    """Test adding knowledge to the graph"""
    # Mock embedding generation
    mock_vector.get_embedding = AsyncMock(return_value=[0.1, 0.2, 0.3])
    mock_firestore.save_knowledge = AsyncMock(return_value=True)

    success = await rag_service.add_knowledge(
        user_id=sample_user.id,
        content="Test knowledge about AI",
        category="technical",
        metadata={"source": "test"}
    )

    assert success is True
    mock_vector.get_embedding.assert_called_once()
    mock_firestore.save_knowledge.assert_called_once()


@pytest.mark.asyncio
@patch('src.services.rag.vector_store')
@patch('src.services.rag.firestore_service')
async def test_search_knowledge(mock_firestore, mock_vector, sample_user):
    """Test searching knowledge graph"""
    # Mock query embedding
    mock_vector.get_embedding = AsyncMock(return_value=[0.1, 0.2, 0.3])

    # Mock knowledge base
    mock_firestore.query_knowledge = AsyncMock(return_value=[
        {
            'content': 'Python is great for AI',
            'embedding': [0.1, 0.2, 0.3],
            'category': 'technical',
            'metadata': {}
        },
        {
            'content': 'FastAPI is fast',
            'embedding': [0.2, 0.3, 0.4],
            'category': 'technical',
            'metadata': {}
        }
    ])

    # Mock similarity search
    mock_vector.find_similar = AsyncMock(return_value=[
        ({'content': 'Python is great for AI', 'metadata': {}}, 0.95),
        ({'content': 'FastAPI is fast', 'metadata': {}}, 0.75)
    ])

    results = await rag_service.search_knowledge(
        user_id=sample_user.id,
        query="Tell me about Python",
        top_k=2
    )

    assert len(results) == 2
    assert results[0].similarity == 0.95
    assert 'Python' in results[0].content


@pytest.mark.asyncio
@patch('src.services.rag.vector_store')
@patch('src.services.rag.firestore_service')
async def test_get_context_for_query(mock_firestore, mock_vector, sample_user):
    """Test getting context for a query"""
    mock_vector.get_embedding = AsyncMock(return_value=[0.1, 0.2, 0.3])
    mock_firestore.query_knowledge = AsyncMock(return_value=[
        {
            'content': 'Important fact about AI',
            'embedding': [0.1, 0.2, 0.3],
            'metadata': {}
        }
    ])
    mock_vector.find_similar = AsyncMock(return_value=[
        ({'content': 'Important fact about AI', 'metadata': {}}, 0.90)
    ])

    context = await rag_service.get_context_for_query(
        user_id=sample_user.id,
        query="What do you know about AI?"
    )

    assert context
    assert 'Important fact about AI' in context
    assert 'Relevant context' in context


@pytest.mark.asyncio
@patch('src.services.rag.vector_store')
@patch('src.services.rag.firestore_service')
async def test_initialize_default_knowledge(mock_firestore, mock_vector, sample_user):
    """Test initializing default knowledge"""
    mock_vector.get_embedding = AsyncMock(return_value=[0.1, 0.2, 0.3])
    mock_firestore.save_knowledge = AsyncMock(return_value=True)

    success = await rag_service.initialize_default_knowledge(sample_user)

    assert success is True
    # Should have called save_knowledge multiple times for default knowledge
    assert mock_firestore.save_knowledge.call_count >= 5


@pytest.mark.asyncio
@patch('src.services.rag.vector_store')
async def test_add_knowledge_embedding_failure(mock_vector):
    """Test handling of embedding generation failure"""
    mock_vector.get_embedding = AsyncMock(return_value=None)

    success = await rag_service.add_knowledge(
        user_id="test-user",
        content="Test content",
        category="test"
    )

    assert success is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
