import pytest
from fastapi.testclient import TestClient
from src.server import app


client = TestClient(app)


def test_root_endpoint():
    """Test root health check endpoint"""
    response = client.get("/")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "operational"
    assert data["service"] == "VINEGAR AI-OS"
    assert "version" in data


def test_health_endpoint():
    """Test detailed health check"""
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert "uptime_seconds" in data
    assert "active_sessions" in data


def test_metrics_endpoint():
    """Test system metrics endpoint"""
    response = client.get("/metrics")

    assert response.status_code == 200
    data = response.json()
    assert "active_agents" in data
    assert "response_latency" in data
    assert "tokens_used" in data
    assert "uptime" in data
    assert "request_count" in data
    assert data["active_agents"] == 3  # Executive, Emotional, Prioritization


def test_profile_endpoint():
    """Test getting user profile"""
    response = client.get("/profile/test-user")

    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "name" in data
    assert "email" in data
    assert "preferences" in data


def test_profile_not_found():
    """Test profile endpoint with non-existent user returns default"""
    response = client.get("/profile/non-existent-user-xyz")

    # Should return default profile, not 404
    assert response.status_code == 200
    data = response.json()
    assert "id" in data


@pytest.mark.asyncio
async def test_chat_endpoint():
    """Test main chat endpoint"""
    chat_request = {
        "message": "Hello VINEGAR",
        "user_id": "test-user",
        "voice_enabled": False
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert "session_id" in data
    assert "agent_type" in data
    assert "actions" in data
    assert len(data["response"]) > 0


@pytest.mark.asyncio
async def test_chat_with_voice():
    """Test chat endpoint with voice enabled"""
    chat_request = {
        "message": "Tell me about my emails",
        "user_id": "test-user",
        "voice_enabled": True
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    # audio_url may be None if ElevenLabs not configured
    assert "audio_url" in data


@pytest.mark.asyncio
async def test_chat_executive_query():
    """Test chat endpoint with executive query"""
    chat_request = {
        "message": "What emails do I have?",
        "user_id": "test-user",
        "voice_enabled": False
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 200
    data = response.json()
    assert data["agent_type"] in ["executive", "orchestrator"]


@pytest.mark.asyncio
async def test_chat_emotional_query():
    """Test chat endpoint with emotional query"""
    chat_request = {
        "message": "I'm feeling stressed",
        "user_id": "test-user",
        "voice_enabled": False
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 200
    data = response.json()
    assert data["agent_type"] in ["emotional", "orchestrator"]


@pytest.mark.asyncio
async def test_chat_prioritization_query():
    """Test chat endpoint with prioritization query"""
    chat_request = {
        "message": "What should I focus on?",
        "user_id": "test-user",
        "voice_enabled": False
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 200
    data = response.json()
    assert data["agent_type"] in ["prioritization", "orchestrator"]


@pytest.mark.asyncio
async def test_chat_session_persistence():
    """Test that chat sessions persist across requests"""
    # First message
    chat_request1 = {
        "message": "My name is Alice",
        "user_id": "test-user-session",
        "voice_enabled": False
    }

    response1 = client.post("/chat", json=chat_request1)
    assert response1.status_code == 200
    data1 = response1.json()
    session_id = data1["session_id"]

    # Second message using same session
    chat_request2 = {
        "message": "What's my name?",
        "user_id": "test-user-session",
        "session_id": session_id,
        "voice_enabled": False
    }

    response2 = client.post("/chat", json=chat_request2)
    assert response2.status_code == 200
    data2 = response2.json()
    assert data2["session_id"] == session_id


def test_initialize_knowledge_endpoint():
    """Test initializing user knowledge"""
    response = client.post("/profile/test-user/initialize")

    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert "message" in data


@pytest.mark.asyncio
async def test_chat_invalid_request():
    """Test chat endpoint with invalid request"""
    # Missing message field
    chat_request = {
        "user_id": "test-user"
    }

    response = client.post("/chat", json=chat_request)

    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_chat_empty_message():
    """Test chat endpoint with empty message"""
    chat_request = {
        "message": "",
        "user_id": "test-user"
    }

    response = client.post("/chat", json=chat_request)

    # Should either handle gracefully or return validation error
    assert response.status_code in [200, 422]


def test_websocket_connection():
    """Test WebSocket connection"""
    with client.websocket_connect("/ws/test-user") as websocket:
        # Send a message
        websocket.send_json({"message": "Hello VINEGAR"})

        # Receive response
        data = websocket.receive_json()

        assert "type" in data
        assert "content" in data
        assert len(data["content"]) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
