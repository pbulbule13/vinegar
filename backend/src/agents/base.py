from abc import ABC, abstractmethod
from typing import List, Optional
from src.models.types import AgentRequest, AgentResponse, AgentType, Message
from src.utils.config import settings
from src.utils.logger import logger
from src.utils.llm_client import llm_client


class BaseAgent(ABC):
    """Base class for all VINEGAR agents"""

    def __init__(self, agent_type: AgentType):
        self.agent_type = agent_type
        self.llm_client = llm_client
        self.model = settings.MODEL_NAME

    @abstractmethod
    async def process(self, request: AgentRequest) -> AgentResponse:
        """Process a request and return a response"""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """Get the system prompt for this agent"""
        pass

    async def call_llm(
        self,
        messages: List[dict],
        system_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.7
    ) -> str:
        """Call LLM API with automatic fallback (Euron → DeepSeek → Gemini → OpenAI)"""
        try:
            content = await self.llm_client.chat_completion(
                messages=messages,
                system_prompt=system_prompt,
                max_tokens=max_tokens,
                temperature=temperature
            )

            logger.info(f"{self.agent_type} agent generated response")
            return content

        except Exception as e:
            logger.error(f"Error calling LLM: {e}")
            return f"I encountered an error: {str(e)}"

    # Alias for backwards compatibility
    async def call_claude(self, messages: List[dict], system_prompt: str, max_tokens: int = 2000, temperature: float = 0.7) -> str:
        """Backwards compatibility alias"""
        return await self.call_llm(messages, system_prompt, max_tokens, temperature)

    def format_conversation_history(self, messages: List[Message]) -> List[dict]:
        """Format conversation history for LLM API"""
        formatted = []
        for msg in messages:
            if msg.role in ['user', 'assistant']:
                formatted.append({
                    'role': msg.role,
                    'content': msg.content
                })
        return formatted

    def extract_user_context(self, request: AgentRequest) -> str:
        """Extract relevant user context as a string"""
        profile = request.context.user_profile
        context_parts = [
            f"User: {profile.name}",
            f"Current mood: {profile.emotional_state.current_mood}",
            f"Time of day: {request.context.time_of_day}",
        ]

        if profile.goals:
            top_goals = sorted(profile.goals, key=lambda g: g.priority, reverse=True)[:3]
            context_parts.append("Top goals: " + ", ".join([g.title for g in top_goals]))

        return "\n".join(context_parts)
