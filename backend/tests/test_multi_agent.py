import pytest
from datetime import datetime
from src.models.types import (
    AgentRequest, ConversationContext, UserProfile, AgentType,
    EmotionalState, MoodType, UserPreferences, WorkingHours
)
from src.agents.orchestrator import orchestrator
from src.agents.executive import executive_agent
from src.agents.emotional import emotional_agent
from src.agents.prioritization import prioritization_agent


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
        goals=[
            {"id": "1", "title": "Complete AI project", "progress": 0.6}
        ],
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


# Executive Agent Tests
@pytest.mark.asyncio
async def test_executive_agent_email_query(sample_context):
    """Test Executive agent handling email queries"""
    request = AgentRequest(
        id="test-1",
        user_id="test-user",
        type="text",
        input="Show me my recent emails",
        context=sample_context
    )

    response = await executive_agent.process(request)

    assert response is not None
    assert response.agent_type == AgentType.EXECUTIVE
    assert response.content
    assert len(response.content) > 0


@pytest.mark.asyncio
async def test_executive_agent_calendar_query(sample_context):
    """Test Executive agent handling calendar queries"""
    request = AgentRequest(
        id="test-2",
        user_id="test-user",
        type="text",
        input="What's on my calendar today?",
        context=sample_context
    )

    response = await executive_agent.process(request)

    assert response is not None
    assert response.agent_type == AgentType.EXECUTIVE
    assert response.content


@pytest.mark.asyncio
async def test_executive_agent_scheduling(sample_context):
    """Test Executive agent scheduling functionality"""
    request = AgentRequest(
        id="test-3",
        user_id="test-user",
        type="text",
        input="Schedule a meeting for tomorrow at 2pm",
        context=sample_context
    )

    response = await executive_agent.process(request)

    assert response is not None
    assert response.content


# Emotional Agent Tests
@pytest.mark.asyncio
async def test_emotional_agent_stress_query(sample_context):
    """Test Emotional agent handling stress"""
    request = AgentRequest(
        id="test-4",
        user_id="test-user",
        type="text",
        input="I'm feeling really stressed about this deadline",
        context=sample_context
    )

    response = await emotional_agent.process(request)

    assert response is not None
    assert response.agent_type == AgentType.EMOTIONAL
    assert response.content
    # Should provide supportive response
    assert len(response.content) > 20


@pytest.mark.asyncio
async def test_emotional_agent_motivation(sample_context):
    """Test Emotional agent providing motivation"""
    request = AgentRequest(
        id="test-5",
        user_id="test-user",
        type="text",
        input="I need some motivation to keep going",
        context=sample_context
    )

    response = await emotional_agent.process(request)

    assert response is not None
    assert response.agent_type == AgentType.EMOTIONAL
    assert response.content


@pytest.mark.asyncio
async def test_emotional_agent_celebration(sample_context):
    """Test Emotional agent celebrating success"""
    request = AgentRequest(
        id="test-6",
        user_id="test-user",
        type="text",
        input="I just finished my AI project!",
        context=sample_context
    )

    response = await emotional_agent.process(request)

    assert response is not None
    assert response.content


# Prioritization Agent Tests
@pytest.mark.asyncio
async def test_prioritization_agent_task_priority(sample_context):
    """Test Prioritization agent sorting tasks"""
    request = AgentRequest(
        id="test-7",
        user_id="test-user",
        type="text",
        input="What should I focus on today?",
        context=sample_context
    )

    response = await prioritization_agent.process(request)

    assert response is not None
    assert response.agent_type == AgentType.PRIORITIZATION
    assert response.content


@pytest.mark.asyncio
async def test_prioritization_agent_strategic_planning(sample_context):
    """Test Prioritization agent for strategic planning"""
    request = AgentRequest(
        id="test-8",
        user_id="test-user",
        type="text",
        input="Help me plan my goals for next quarter",
        context=sample_context
    )

    response = await prioritization_agent.process(request)

    assert response is not None
    assert response.content


@pytest.mark.asyncio
async def test_prioritization_agent_deadline_management(sample_context):
    """Test Prioritization agent handling deadlines"""
    request = AgentRequest(
        id="test-9",
        user_id="test-user",
        type="text",
        input="I have multiple deadlines coming up, help me prioritize",
        context=sample_context
    )

    response = await prioritization_agent.process(request)

    assert response is not None
    assert response.content


# Multi-Agent Coordination Tests
@pytest.mark.asyncio
async def test_orchestrator_multi_agent_query(sample_context):
    """Test orchestrator coordinating multiple agents"""
    request = AgentRequest(
        id="test-10",
        user_id="test-user",
        type="text",
        input="I'm stressed about my upcoming meeting tomorrow, what should I prioritize?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    # Should involve multiple agents: emotional (stressed) and prioritization (prioritize)


@pytest.mark.asyncio
async def test_orchestrator_agent_selection(sample_context):
    """Test orchestrator selecting correct agents"""
    test_cases = [
        ("Check my emails", [AgentType.EXECUTIVE]),
        ("I'm feeling down", [AgentType.EMOTIONAL]),
        ("What's most important?", [AgentType.PRIORITIZATION]),
    ]

    for input_text, expected_agents in test_cases:
        request = AgentRequest(
            id=f"test-{input_text}",
            user_id="test-user",
            type="text",
            input=input_text,
            context=sample_context
        )

        # Test agent selection logic
        selected = await orchestrator._select_agents(request)

        # Should include at least one expected agent
        assert any(agent in selected for agent in expected_agents), \
            f"Expected one of {expected_agents} for '{input_text}', got {selected}"


@pytest.mark.asyncio
async def test_orchestrator_general_conversation(sample_context):
    """Test orchestrator handling general conversation"""
    request = AgentRequest(
        id="test-11",
        user_id="test-user",
        type="text",
        input="Hello VINEGAR, how are you?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content
    assert len(response.content) > 0


@pytest.mark.asyncio
async def test_orchestrator_context_awareness(sample_context):
    """Test orchestrator using conversation context"""
    # Add some history
    from src.models.types import Message

    sample_context.history = [
        Message(
            role="user",
            content="I have a meeting at 3pm",
            timestamp=datetime.utcnow()
        ),
        Message(
            role="assistant",
            content="Got it, you have a meeting at 3pm",
            timestamp=datetime.utcnow(),
            agent_type=AgentType.EXECUTIVE
        )
    ]

    request = AgentRequest(
        id="test-12",
        user_id="test-user",
        type="text",
        input="Can you remind me about that?",
        context=sample_context
    )

    response = await orchestrator.process_request(request)

    assert response is not None
    assert response.content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
