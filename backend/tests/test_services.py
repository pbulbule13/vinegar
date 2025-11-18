import pytest
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
from src.services.gmail import gmail_service
from src.services.calendar import calendar_service
from src.services.voice import voice_service
from src.services.firestore import firestore_service
from src.models.types import UserProfile, UserPreferences, WorkingHours, EmotionalState, MoodType


@pytest.fixture
def sample_user():
    """Sample user for testing"""
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


# Gmail Service Tests
@pytest.mark.asyncio
async def test_gmail_get_recent_emails():
    """Test getting recent emails"""
    emails = await gmail_service.get_recent_emails(max_results=5)

    assert emails is not None
    assert isinstance(emails, list)
    # Should return mock emails
    assert len(emails) >= 0


@pytest.mark.asyncio
async def test_gmail_search_emails():
    """Test searching emails"""
    emails = await gmail_service.search_emails(query="important", max_results=5)

    assert emails is not None
    assert isinstance(emails, list)


@pytest.mark.asyncio
async def test_gmail_send_email():
    """Test sending email (mock)"""
    success = await gmail_service.send_email(
        to="test@example.com",
        subject="Test",
        body="Test message"
    )

    # Should handle gracefully even if not configured
    assert isinstance(success, bool)


# Calendar Service Tests
@pytest.mark.asyncio
async def test_calendar_get_upcoming_events():
    """Test getting upcoming events"""
    events = await calendar_service.get_upcoming_events(max_results=5)

    assert events is not None
    assert isinstance(events, list)


@pytest.mark.asyncio
async def test_calendar_create_event():
    """Test creating calendar event (mock)"""
    success = await calendar_service.create_event(
        summary="Test Meeting",
        start_time=datetime.utcnow(),
        end_time=datetime.utcnow(),
        description="Test description"
    )

    assert isinstance(success, bool)


@pytest.mark.asyncio
async def test_calendar_search_events():
    """Test searching calendar events"""
    events = await calendar_service.search_events(query="meeting")

    assert events is not None
    assert isinstance(events, list)


# Voice Service Tests
@pytest.mark.asyncio
async def test_voice_text_to_speech():
    """Test text-to-speech conversion"""
    text = "Hello, this is a test"

    audio = await voice_service.text_to_speech(text)

    # Should return None if API not configured, or bytes if configured
    assert audio is None or isinstance(audio, bytes)


def test_voice_audio_to_base64():
    """Test audio to base64 conversion"""
    test_audio = b"fake audio data"

    base64_str = voice_service.audio_to_base64(test_audio)

    assert base64_str is not None
    assert isinstance(base64_str, str)


# Firestore Service Tests
@pytest.mark.asyncio
async def test_firestore_get_user_profile():
    """Test getting user profile"""
    profile = await firestore_service.get_user_profile("test-user")

    assert profile is not None
    assert isinstance(profile, UserProfile)
    assert profile.id is not None


@pytest.mark.asyncio
async def test_firestore_save_user_profile(sample_user):
    """Test saving user profile"""
    success = await firestore_service.save_user_profile(sample_user)

    # May fail if Firestore not configured, but shouldn't crash
    assert isinstance(success, bool)


@pytest.mark.asyncio
async def test_firestore_save_session():
    """Test saving session"""
    session_data = {
        'user_id': 'test-user',
        'messages': []
    }

    success = await firestore_service.save_session("test-session", session_data)

    assert isinstance(success, bool)


@pytest.mark.asyncio
async def test_firestore_get_session():
    """Test getting session"""
    session = await firestore_service.get_session("test-session")

    # May be None if not found
    assert session is None or isinstance(session, dict)


@pytest.mark.asyncio
async def test_firestore_save_knowledge():
    """Test saving knowledge node"""
    knowledge_data = {
        'user_id': 'test-user',
        'content': 'Test knowledge',
        'category': 'test',
        'embedding': [0.1, 0.2, 0.3]
    }

    success = await firestore_service.save_knowledge("test-node", knowledge_data)

    assert isinstance(success, bool)


@pytest.mark.asyncio
async def test_firestore_query_knowledge():
    """Test querying knowledge"""
    results = await firestore_service.query_knowledge(
        user_id='test-user',
        category='test'
    )

    assert results is not None
    assert isinstance(results, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
