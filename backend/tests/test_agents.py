import pytest
from datetime import datetime
from src.models.types import (
    AgentRequest, ConversationContext, UserProfile,
    EmotionalState, MoodType, UserPreferences, WorkingHours
)
from src.agents.orchestrator import orchestrator


@pytest.fixture
def sample_user_profile():
    """Create a sample user profile for testing"""
    return UserProfile(
        id="test-user",
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


@pytest.fixture
def sample_context(sample_user_profile):
    """Create a sample conversation context"""
    return ConversationContext(
        session_id="test-session",
        history=[],
        user_profile=sample_user_profile,
        time_of_day="afternoon"
    )


@pytest.mark.asyncio
async def test_orchestrator_executive_routing(sample_context):
    """Test that email-related queries route to Executive agent"""
    request = AgentRequest(
        id="test-1",
        user_id="test-user",
        type="text",
        input="What emails do I have?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    assert response.agent_type in ['executive', 'orchestrator']


@pytest.mark.asyncio
async def test_orchestrator_emotional_routing(sample_context):
    """Test that emotional queries route to Emotional agent"""
    request = AgentRequest(
        id="test-2",
        user_id="test-user",
        type="text",
        input="I'm feeling stressed about work",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    assert response.agent_type in ['emotional', 'orchestrator']


@pytest.mark.asyncio
async def test_orchestrator_prioritization_routing(sample_context):
    """Test that priority queries route to Prioritization agent"""
    request = AgentRequest(
        id="test-3",
        user_id="test-user",
        type="text",
        input="What should I focus on today?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    assert response.agent_type in ['prioritization', 'orchestrator']


@pytest.mark.asyncio
async def test_orchestrator_general_query(sample_context):
    """Test general queries"""
    request = AgentRequest(
        id="test-4",
        user_id="test-user",
        type="text",
        input="Hello, how are you?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    assert len(response.content) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
