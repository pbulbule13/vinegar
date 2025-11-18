from abc import ABC, abstractmethod
from typing import List, Optional
from anthropic import AsyncAnthropic
from src.models.types import AgentRequest, AgentResponse, AgentType, Message
from src.utils.config import settings
from src.utils.logger import logger


class BaseAgent(ABC):
    """Base class for all VINEGAR agents"""

    def __init__(self, agent_type: AgentType):
        self.agent_type = agent_type
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.CLAUDE_MODEL

    @abstractmethod
    async def process(self, request: AgentRequest) -> AgentResponse:
        """Process a request and return a response"""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """Get the system prompt for this agent"""
        pass

    async def call_claude(
        self,
        messages: List[dict],
        system_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.7
    ) -> str:
        """Call Claude API with messages"""
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system_prompt,
                messages=messages
            )

            content = response.content[0].text
            logger.info(f"{self.agent_type} agent generated response")
            return content

        except Exception as e:
            logger.error(f"Error calling Claude: {e}")
            return f"I encountered an error: {str(e)}"

    def format_conversation_history(self, messages: List[Message]) -> List[dict]:
        """Format conversation history for Claude API"""
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
