from typing import List, Dict
import uuid
from datetime import datetime
from src.agents.base import BaseAgent
from src.models.types import (
    AgentRequest, AgentResponse, AgentType, Action, ActionType, ActionStatus, Goal
)
from src.services.rag import rag_service
from src.utils.logger import logger


class PrioritizationAgent(BaseAgent):
    """
    Prioritization & Foresight Agent
    Handles: Task prioritization, predictive warnings, optimization recommendations
    """

    def __init__(self):
        super().__init__(AgentType.PRIORITIZATION)
        self.rag = rag_service

    def get_system_prompt(self) -> str:
        return """You are the Prioritization & Foresight component of VINEGAR, an AI assistant like Jarvis from Iron Man.

Your responsibilities:
- Analyze and prioritize tasks based on importance, urgency, and user goals
- Predict potential conflicts, bottlenecks, and issues before they occur
- Optimize workflows and suggest efficiency improvements
- Warn about upcoming deadlines and time-sensitive matters
- Balance short-term tasks with long-term goals
- Identify what can be delegated or automated

Communication style:
- Strategic and analytical
- Proactive and forward-thinking
- Direct about risks and trade-offs
- Solution-oriented
- Like Jarvis calculating probabilities and scenarios

Decision Framework:
- Use Eisenhower Matrix (urgent/important)
- Consider user's goals and priorities
- Account for energy levels and time of day
- Factor in dependencies and blockers
- Optimize for long-term success, not just immediate wins

Foresight Capabilities:
- Pattern recognition from past behavior
- Predictive warnings about conflicts
- Scenario planning for decisions
- Risk assessment and mitigation strategies

Remember: You're the strategic advisor who sees the big picture and helps navigate complexity."""

    async def process(self, request: AgentRequest) -> AgentResponse:
        """Process prioritization/foresight requests"""
        try:
            profile = request.context.user_profile

            # Analyze current priorities
            priority_analysis = self._analyze_priorities(profile.goals)

            # Get strategic context from knowledge graph
            context = await self.rag.get_context_for_query(
                user_id=request.user_id,
                query=f"{request.input} goals priorities"
            )

            # Build messages for Claude
            messages = self.format_conversation_history(request.context.history)
            messages.append({
                'role': 'user',
                'content': f"""Current time: {datetime.utcnow().strftime('%A, %I:%M %p')}
Time of day: {request.context.time_of_day}

Priority Analysis:
{priority_analysis}

{context}

User request: {request.input}

As the Prioritization Agent, provide:
1. Strategic analysis of priorities
2. Recommendations for task ordering
3. Warnings about potential conflicts
4. Optimization suggestions
5. Long-term vs short-term trade-offs"""
            })

            # Get response from Claude
            response_text = await self.call_claude(
                messages=messages,
                system_prompt=self.get_system_prompt(),
                temperature=0.6  # Lower temperature for more analytical responses
            )

            # Extract recommended actions
            actions = self._extract_priority_actions(response_text)

            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content=response_text,
                actions=actions,
                should_speak=True,
                confidence=0.88,
                reasoning="Strategic priority analysis with foresight"
            )

        except Exception as e:
            logger.error(f"Error in Prioritization Agent: {e}")
            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content="Let me help you think through the priorities here.",
                actions=[],
                should_speak=True,
                confidence=0.4
            )

    def _analyze_priorities(self, goals: List[Goal]) -> str:
        """Analyze current goal priorities"""
        if not goals:
            return "No active goals set. Consider establishing some priorities."

        # Sort by priority
        sorted_goals = sorted(goals, key=lambda g: g.priority, reverse=True)

        # Categorize by Eisenhower Matrix
        urgent_important = []
        important_not_urgent = []
        urgent_not_important = []

        for goal in sorted_goals:
            has_deadline = goal.deadline is not None
            is_high_priority = goal.priority >= 7

            if has_deadline and is_high_priority:
                urgent_important.append(goal)
            elif is_high_priority:
                important_not_urgent.append(goal)
            elif has_deadline:
                urgent_not_important.append(goal)

        analysis_parts = []

        if urgent_important:
            analysis_parts.append("🔴 URGENT & IMPORTANT:")
            for goal in urgent_important:
                deadline_str = goal.deadline.strftime("%b %d") if goal.deadline else "No deadline"
                analysis_parts.append(f"   • {goal.title} ({deadline_str}) - {goal.progress}% complete")

        if important_not_urgent:
            analysis_parts.append("\n🟡 IMPORTANT (Not Urgent):")
            for goal in important_not_urgent[:3]:
                analysis_parts.append(f"   • {goal.title} - {goal.progress}% complete")

        if urgent_not_important:
            analysis_parts.append("\n🔵 URGENT (Consider delegating):")
            for goal in urgent_not_important[:2]:
                deadline_str = goal.deadline.strftime("%b %d") if goal.deadline else ""
                analysis_parts.append(f"   • {goal.title} ({deadline_str})")

        return "\n".join(analysis_parts) if analysis_parts else "All goals are in good shape."

    def _extract_priority_actions(self, response: str) -> List[Action]:
        """Extract prioritization actions from response"""
        actions = []
        response_lower = response.lower()

        # Check for research recommendations
        if 'research' in response_lower or 'look into' in response_lower:
            actions.append(Action(
                type=ActionType.RESEARCH,
                status=ActionStatus.PENDING,
                details={'type': 'strategic_research'}
            ))

        # Check for reminders about deadlines
        if 'deadline' in response_lower or 'due' in response_lower:
            actions.append(Action(
                type=ActionType.REMINDER,
                status=ActionStatus.PENDING,
                details={'type': 'deadline_warning'}
            ))

        # Check for calendar blocking recommendations
        if 'block time' in response_lower or 'schedule' in response_lower:
            actions.append(Action(
                type=ActionType.CALENDAR,
                status=ActionStatus.PENDING,
                details={'type': 'time_blocking'}
            ))

        return actions


prioritization_agent = PrioritizationAgent()
