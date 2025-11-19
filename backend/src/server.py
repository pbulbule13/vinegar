from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid
import asyncio

from src.agents.orchestrator import orchestrator
from src.models.types import (
    AgentRequest, UserProfile, Message, ConversationContext,
    SystemMetrics, EmotionalState, MoodType
)
from src.services.firestore import firestore_service
from src.services.voice import voice_service
from src.services.rag import rag_service
from src.utils.config import settings
from src.utils.logger import logger

app = FastAPI(
    title="VINEGAR AI-OS",
    description="Vigilant Intelligent Networked Assistant - Your Jarvis-like AI companion",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
active_sessions = {}
system_start_time = datetime.utcnow()
request_counter = 0


class ChatRequest(BaseModel):
    message: str
    user_id: Optional[str] = settings.DEFAULT_USER_ID
    session_id: Optional[str] = None
    voice_enabled: bool = False


class ChatResponse(BaseModel):
    response: str
    session_id: str
    agent_type: str
    audio_url: Optional[str] = None
    actions: List[dict] = []


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "operational",
        "service": "VINEGAR AI-OS",
        "version": "1.0.0",
        "tagline": "Your Jarvis-like AI personal assistant"
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "uptime_seconds": (datetime.utcnow() - system_start_time).total_seconds(),
        "active_sessions": len(active_sessions)
    }


@app.get("/metrics")
async def get_metrics() -> SystemMetrics:
    """Get system metrics"""
    uptime = (datetime.utcnow() - system_start_time).total_seconds()

    return SystemMetrics(
        active_agents=3,  # Executive, Emotional, Prioritization
        response_latency=245.5,  # Average in ms (mock)
        tokens_used=request_counter * 1500,  # Estimate
        uptime=uptime,
        request_count=request_counter,
        error_rate=0.02  # 2% error rate (mock)
    )


@app.get("/profile/{user_id}")
async def get_profile(user_id: str):
    """Get user profile"""
    profile = await firestore_service.get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    return profile.model_dump(mode='json')


@app.post("/profile/{user_id}/initialize")
async def initialize_profile(user_id: str):
    """Initialize default knowledge for a user"""
    profile = await firestore_service.get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    success = await rag_service.initialize_default_knowledge(profile)

    return {
        "success": success,
        "message": "Knowledge graph initialized" if success else "Failed to initialize"
    }


@app.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """Main chat endpoint"""
    global request_counter
    request_counter += 1

    logger.info(f"[CHAT] New request from user: {request.user_id}")
    logger.info(f"[CHAT] Message: {request.message[:100]}...")
    logger.info(f"[CHAT] Voice enabled: {request.voice_enabled}")
    logger.info(f"[CHAT] Session ID: {request.session_id}")

    try:
        # Get or create session
        session_id = request.session_id or str(uuid.uuid4())
        logger.info(f"[CHAT] Using session: {session_id}")

        # Get user profile
        profile = await firestore_service.get_user_profile(request.user_id)
        if not profile:
            logger.error(f"[CHAT] User not found: {request.user_id}")
            raise HTTPException(status_code=404, detail="User not found")

        logger.info(f"[CHAT] User profile loaded: {profile.name}")

        # Get session history
        session_data = await firestore_service.get_session(session_id)
        history = []

        if session_data and 'messages' in session_data:
            history = [
                Message(**msg) for msg in session_data['messages']
            ]
            logger.info(f"[CHAT] Loaded {len(history)} messages from history")

        # Determine time of day
        hour = datetime.utcnow().hour
        if 5 <= hour < 12:
            time_of_day = "morning"
        elif 12 <= hour < 17:
            time_of_day = "afternoon"
        elif 17 <= hour < 21:
            time_of_day = "evening"
        else:
            time_of_day = "night"

        # Create conversation context
        context = ConversationContext(
            session_id=session_id,
            history=history,
            user_profile=profile,
            time_of_day=time_of_day
        )

        # Create agent request
        agent_request = AgentRequest(
            id=str(uuid.uuid4()),
            user_id=request.user_id,
            type="text",
            input=request.message,
            context=context
        )

        # Process with orchestrator
        logger.info(f"[CHAT] Processing with orchestrator...")
        response = await orchestrator.process_request(agent_request)
        logger.info(f"[CHAT] Agent response: {response.agent_type.value}")
        logger.info(f"[CHAT] Response length: {len(response.content)} chars")
        logger.info(f"[CHAT] Should speak: {response.should_speak}")

        # Generate voice if requested
        audio_url = None
        if request.voice_enabled and response.should_speak:
            logger.info(f"[CHAT] Voice enabled, generating speech...")
            audio_bytes = await voice_service.text_to_speech(response.content)
            if audio_bytes:
                logger.info(f"[CHAT] Speech generated: {len(audio_bytes)} bytes")
                # In production, upload to Cloud Storage and return URL
                audio_url = f"data:audio/mpeg;base64,{voice_service.audio_to_base64(audio_bytes)}"
                logger.info(f"[CHAT] Audio URL created (base64 length: {len(audio_url)})")
            else:
                logger.warning(f"[CHAT] Failed to generate speech (likely no API key)")
        else:
            logger.info(f"[CHAT] Voice not requested or agent shouldn't speak")

        # Update session history
        history.append(Message(
            role="user",
            content=request.message,
            timestamp=datetime.utcnow()
        ))
        history.append(Message(
            role="assistant",
            content=response.content,
            timestamp=datetime.utcnow(),
            agent_type=response.agent_type
        ))

        # Save session
        logger.info(f"[CHAT] Saving session with {len(history)} messages")
        await firestore_service.save_session(session_id, {
            'user_id': request.user_id,
            'messages': [msg.model_dump(mode='json') for msg in history]
        })

        # Add to knowledge graph
        logger.info(f"[CHAT] Adding to knowledge graph")
        await rag_service.add_knowledge(
            user_id=request.user_id,
            content=f"User asked: {request.message}. VINEGAR responded: {response.content}",
            category="conversation",
            metadata={
                'session_id': session_id,
                'agent_type': response.agent_type.value
            }
        )

        logger.info(f"[CHAT] Request completed successfully")
        return ChatResponse(
            response=response.content,
            session_id=session_id,
            agent_type=response.agent_type.value,
            audio_url=audio_url,
            actions=[action.model_dump() for action in response.actions]
        )

    except Exception as e:
        logger.error(f"[CHAT] Error in chat endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time communication"""
    await websocket.accept()
    session_id = str(uuid.uuid4())
    active_sessions[session_id] = websocket

    logger.info(f"WebSocket connection established for user {user_id}")

    try:
        while True:
            # Receive message
            data = await websocket.receive_json()
            message = data.get('message', '')

            if not message:
                continue

            # Process similar to chat endpoint
            profile = await firestore_service.get_user_profile(user_id)
            if not profile:
                await websocket.send_json({
                    'error': 'User not found'
                })
                continue

            # Get session
            session_data = await firestore_service.get_session(session_id)
            history = []
            if session_data and 'messages' in session_data:
                history = [Message(**msg) for msg in session_data['messages']]

            # Create context and request
            context = ConversationContext(
                session_id=session_id,
                history=history,
                user_profile=profile,
                time_of_day=datetime.utcnow().strftime("%H:%M")
            )

            agent_request = AgentRequest(
                id=str(uuid.uuid4()),
                user_id=user_id,
                type="text",
                input=message,
                context=context
            )

            # Process
            response = await orchestrator.process_request(agent_request)

            # Send response
            await websocket.send_json({
                'type': 'message',
                'content': response.content,
                'agent_type': response.agent_type.value,
                'actions': [action.model_dump() for action in response.actions],
                'session_id': session_id
            })

            # Update history
            history.append(Message(
                role="user",
                content=message,
                timestamp=datetime.utcnow()
            ))
            history.append(Message(
                role="assistant",
                content=response.content,
                timestamp=datetime.utcnow(),
                agent_type=response.agent_type
            ))

            await firestore_service.save_session(session_id, {
                'user_id': user_id,
                'messages': [msg.model_dump(mode='json') for msg in history]
            })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
        if session_id in active_sessions:
            del active_sessions[session_id]
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.ENV == "development"
    )
