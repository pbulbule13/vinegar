from typing import List
from datetime import datetime
import uuid
from src.agents.base import BaseAgent
from src.models.types import (
    AgentRequest, AgentResponse, AgentType, Action, ActionType, ActionStatus
)
from src.services.gmail import gmail_service
from src.services.calendar import calendar_service
from src.utils.logger import logger


class ExecutiveAgent(BaseAgent):
    """
    Executive/Logistics Agent
    Handles: Email management, calendar scheduling, travel optimization, task coordination
    """

    def __init__(self):
        super().__init__(AgentType.EXECUTIVE)
        self.gmail = gmail_service
        self.calendar = calendar_service

    def get_system_prompt(self) -> str:
        return """You are the Executive/Logistics component of VINEGAR, an AI assistant like Jarvis from Iron Man.

Your responsibilities:
- Manage emails: summarize, prioritize, draft responses in the user's style
- Handle calendar: create, modify, reschedule appointments
- Optimize logistics: track travel times, send pickup/drop-off notifications
- Coordinate tasks: ensure deadlines are met, follow up on action items

Communication style:
- Friendly, witty, and direct like Jarvis
- Proactive and anticipatory
- Supportive but efficient
- Use natural language, avoid robotic responses

When handling requests:
1. Analyze what executive/logistical actions are needed
2. Provide clear summaries and recommendations
3. Take action when appropriate
4. Always be one step ahead

Remember: You're not just an assistant - you're a trusted executive co-pilot."""

    async def process(self, request: AgentRequest) -> AgentResponse:
        """Process executive/logistics requests"""
        try:
            # Gather relevant information
            recent_emails = await self.gmail.get_recent_emails(max_results=10)
            upcoming_events = await self.calendar.get_upcoming_events(max_results=5)

            # Prepare context
            context = self.extract_user_context(request)
            email_summary = self._format_email_summary(recent_emails)
            calendar_summary = self._format_calendar_summary(upcoming_events)

            # Build messages for Claude
            messages = self.format_conversation_history(request.context.history)
            messages.append({
                'role': 'user',
                'content': f"""Context:
{context}

Recent Emails:
{email_summary}

Upcoming Calendar:
{calendar_summary}

User Request: {request.input}

As the Executive Agent, analyze this request and provide:
1. A friendly, direct response
2. Any actions you recommend (email, calendar, reminders)
3. Your reasoning for the recommendations"""
            })

            # Get response from Claude
            response_text = await self.call_claude(
                messages=messages,
                system_prompt=self.get_system_prompt()
            )

            # Parse actions from response
            actions = self._extract_actions(response_text)

            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content=response_text,
                actions=actions,
                should_speak=True,
                confidence=0.9,
                reasoning="Executive analysis of emails and calendar"
            )

        except Exception as e:
            logger.error(f"Error in Executive Agent: {e}")
            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content="I encountered an issue processing your executive request. Let me get that sorted.",
                actions=[],
                should_speak=True,
                confidence=0.3
            )

    def _format_email_summary(self, emails: List) -> str:
        """Format email summary for context"""
        if not emails:
            return "No recent emails"

        summary_lines = []
        for email in emails[:5]:
            importance = "🔴" if email.importance >= 8 else "🟡" if email.importance >= 5 else "🟢"
            action = " [ACTION REQUIRED]" if email.action_required else ""
            summary_lines.append(
                f"{importance} From: {email.from_email}\n"
                f"   Subject: {email.subject}{action}\n"
                f"   Preview: {email.snippet[:80]}..."
            )

        return "\n".join(summary_lines)

    def _format_calendar_summary(self, events: List) -> str:
        """Format calendar summary for context"""
        if not events:
            return "No upcoming events"

        summary_lines = []
        for event in events[:5]:
            time_str = event.start.strftime("%b %d, %I:%M %p")
            summary_lines.append(
                f"📅 {time_str}: {event.title}\n"
                f"   Location: {event.location or 'Not specified'}"
            )

        return "\n".join(summary_lines)

    def _extract_actions(self, response: str) -> List[Action]:
        """Extract actionable items from the response"""
        actions = []

        # Simple keyword-based action extraction
        # In production, this would be more sophisticated
        response_lower = response.lower()

        if 'send email' in response_lower or 'draft' in response_lower:
            actions.append(Action(
                type=ActionType.EMAIL,
                status=ActionStatus.PENDING,
                details={'type': 'draft_email'}
            ))

        if 'schedule' in response_lower or 'calendar' in response_lower:
            actions.append(Action(
                type=ActionType.CALENDAR,
                status=ActionStatus.PENDING,
                details={'type': 'schedule_event'}
            ))

        if 'remind' in response_lower:
            actions.append(Action(
                type=ActionType.REMINDER,
                status=ActionStatus.PENDING,
                details={'type': 'set_reminder'}
            ))

        return actions


executive_agent = ExecutiveAgent()
