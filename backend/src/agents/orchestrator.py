from typing import List, Optional
import uuid
from datetime import datetime
from src.models.types import (
    AgentRequest, AgentResponse, AgentType, Message, ConversationContext
)
from src.agents.executive import executive_agent
from src.agents.emotional import emotional_agent
from src.agents.prioritization import prioritization_agent
from src.utils.logger import logger
from src.utils.llm_client import llm_client
from src.utils.config import settings


class Orchestrator:
    """
    Central orchestrator that routes requests to appropriate agents
    Similar to how Jarvis coordinates different subsystems
    """

    def __init__(self):
        self.executive = executive_agent
        self.emotional = emotional_agent
        self.prioritization = prioritization_agent
        self.llm_client = llm_client

    async def process_request(self, request: AgentRequest) -> AgentResponse:
        """
        Main entry point: analyze request and route to appropriate agent(s)
        """
        logger.info(f"Orchestrator processing request: {request.input[:50]}...")

        # Determine which agent(s) should handle this
        selected_agents = await self._select_agents(request)

        logger.info(f"Selected agents: {[a.value for a in selected_agents]}")

        # If multiple agents needed, coordinate their responses
        if len(selected_agents) > 1:
            return await self._coordinate_multi_agent_response(request, selected_agents)
        elif selected_agents:
            return await self._single_agent_response(request, selected_agents[0])
        else:
            # Default: handle with orchestrator directly
            return await self._direct_response(request)

    async def _select_agents(self, request: AgentRequest) -> List[AgentType]:
        """Intelligently select which agent(s) should handle the request"""
        input_lower = request.input.lower()
        selected = []

        # Executive agent triggers
        executive_keywords = [
            'email', 'calendar', 'schedule', 'meeting', 'appointment',
            'remind', 'inbox', 'send', 'draft', 'reschedule'
        ]
        if any(keyword in input_lower for keyword in executive_keywords):
            selected.append(AgentType.EXECUTIVE)

        # Emotional agent triggers
        emotional_keywords = [
            'feel', 'stressed', 'frustrated', 'sad', 'happy', 'excited',
            'tired', 'overwhelmed', 'motivation', 'support', 'help me cope'
        ]
        if any(keyword in input_lower for keyword in emotional_keywords):
            selected.append(AgentType.EMOTIONAL)

        # Prioritization agent triggers
        priority_keywords = [
            'priority', 'prioritize', 'what should', 'which', 'focus',
            'important', 'urgent', 'deadline', 'goal', 'strategy', 'plan'
        ]
        if any(keyword in input_lower for keyword in priority_keywords):
            selected.append(AgentType.PRIORITIZATION)

        # If no specific triggers, use AI to decide
        if not selected:
            selected = await self._ai_agent_selection(request)

        return selected

    async def _ai_agent_selection(self, request: AgentRequest) -> List[AgentType]:
        """Use LLM to intelligently select agents"""
        try:
            messages = [{
                'role': 'user',
                'content': f"""User request: "{request.input}"

Which agent(s) should handle this? Choose from:
- EXECUTIVE: emails, calendar, logistics, scheduling
- EMOTIONAL: feelings, motivation, support, well-being
- PRIORITIZATION: task priorities, strategy, planning, optimization

Respond with just the agent name(s), comma-separated."""
            }]

            agent_text = await self.llm_client.chat_completion(
                messages=messages,
                system_prompt="You are an AI routing system. Classify user requests into agent types.",
                max_tokens=100,
                temperature=0.3
            )

            agent_text = agent_text.upper()
            selected = []

            if 'EXECUTIVE' in agent_text:
                selected.append(AgentType.EXECUTIVE)
            if 'EMOTIONAL' in agent_text:
                selected.append(AgentType.EMOTIONAL)
            if 'PRIORITIZATION' in agent_text:
                selected.append(AgentType.PRIORITIZATION)

            return selected if selected else [AgentType.EXECUTIVE]

        except Exception as e:
            logger.error(f"Error in AI agent selection: {e}")
            return [AgentType.EXECUTIVE]  # Default fallback

    async def _single_agent_response(
        self,
        request: AgentRequest,
        agent_type: AgentType
    ) -> AgentResponse:
        """Get response from a single agent"""
        agent_map = {
            AgentType.EXECUTIVE: self.executive,
            AgentType.EMOTIONAL: self.emotional,
            AgentType.PRIORITIZATION: self.prioritization,
        }

        agent = agent_map.get(agent_type)
        if agent:
            return await agent.process(request)
        else:
            return await self._direct_response(request)

    async def _coordinate_multi_agent_response(
        self,
        request: AgentRequest,
        agent_types: List[AgentType]
    ) -> AgentResponse:
        """Coordinate responses from multiple agents"""
        logger.info("Coordinating multi-agent response")

        # Get responses from all selected agents in parallel
        import asyncio

        agent_map = {
            AgentType.EXECUTIVE: self.executive,
            AgentType.EMOTIONAL: self.emotional,
            AgentType.PRIORITIZATION: self.prioritization,
        }

        tasks = [
            agent_map[agent_type].process(request)
            for agent_type in agent_types
            if agent_type in agent_map
        ]

        responses = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out any errors
        valid_responses = [r for r in responses if isinstance(r, AgentResponse)]

        if not valid_responses:
            return await self._direct_response(request)

        # Synthesize responses
        synthesized = await self._synthesize_responses(request, valid_responses)
        return synthesized

    async def _synthesize_responses(
        self,
        request: AgentRequest,
        responses: List[AgentResponse]
    ) -> AgentResponse:
        """Synthesize multiple agent responses into one coherent response"""
        # Combine all agent insights
        combined_content = []
        all_actions = []

        for response in responses:
            combined_content.append(f"[{response.agent_type.value.upper()}]: {response.content}")
            all_actions.extend(response.actions)

        # Use LLM to create a coherent synthesis
        try:
            messages = [{
                'role': 'user',
                'content': f"""User asked: "{request.input}"

Agent responses:
{chr(10).join(combined_content)}

Synthesize these into one natural, helpful response that sounds like Jarvis."""
            }]

            synthesized_text = await self.llm_client.chat_completion(
                messages=messages,
                system_prompt="""You are VINEGAR, a Jarvis-like AI assistant. Multiple specialized agents have analyzed the user's request.
Synthesize their insights into ONE coherent, natural response. Be friendly, witty, and direct.""",
                max_tokens=1500,
                temperature=0.7
            )

            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=AgentType.ORCHESTRATOR,
                content=synthesized_text,
                actions=all_actions,
                should_speak=True,
                confidence=0.9,
                reasoning="Multi-agent coordination"
            )

        except Exception as e:
            logger.error(f"Error synthesizing responses: {e}")
            # Fallback: return first response
            return responses[0]

    async def _direct_response(self, request: AgentRequest) -> AgentResponse:
        """Handle request directly without specialized agents"""
        try:
            messages = []
            for msg in request.context.history:
                if msg.role in ['user', 'assistant']:
                    messages.append({'role': msg.role, 'content': msg.content})

            messages.append({'role': 'user', 'content': request.input})

            response_text = await self.llm_client.chat_completion(
                messages=messages,
                system_prompt="""You are VINEGAR, a Jarvis-like AI personal assistant.
You're friendly, witty, direct, and proactive.
Communicate like Jarvis from Iron Man - capable, supportive, and occasionally sarcastic.""",
                max_tokens=1000,
                temperature=0.7
            )

            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=AgentType.ORCHESTRATOR,
                content=response_text,
                actions=[],
                should_speak=True,
                confidence=0.75,
                reasoning="Direct orchestrator response"
            )

        except Exception as e:
            logger.error(f"Error in direct response: {e}")
            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=AgentType.ORCHESTRATOR,
                content="I'm experiencing some technical difficulties. Give me a moment.",
                actions=[],
                should_speak=True,
                confidence=0.3
            )


orchestrator = Orchestrator()
