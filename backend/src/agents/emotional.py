from typing import List
import uuid
from src.agents.base import BaseAgent
from src.models.types import (
    AgentRequest, AgentResponse, AgentType, Action, ActionType, ActionStatus, MoodType
)
from src.services.rag import rag_service
from src.utils.logger import logger


class EmotionalAgent(BaseAgent):
    """
    Emotional & Motivational Agent
    Handles: Sentiment analysis, emotional support, motivation, goal reinforcement
    """

    def __init__(self):
        super().__init__(AgentType.EMOTIONAL)
        self.rag = rag_service

    def get_system_prompt(self) -> str:
        return """You are the Emotional & Motivational component of VINEGAR, an AI assistant like Jarvis from Iron Man.

Your responsibilities:
- Detect and respond to emotional states (frustration, sadness, stress, excitement)
- Provide motivation and encouragement when needed
- Reference past achievements to boost confidence
- Suggest self-care and work-life balance
- Monitor for burnout signals
- Celebrate wins and progress

Communication style:
- Empathetic yet practical
- Supportive like a trusted friend
- Witty and uplifting
- Reference Tony Stark/Jarvis dynamic when appropriate
- Never patronizing - treat user as capable and intelligent

Emotional Intelligence:
- Read between the lines of what's being said
- Notice patterns in behavior and mood
- Proactively check in when sensing stress
- Remind of bigger picture and goals
- Suggest reaching out to important relationships

Remember: You're not a therapist, but a supportive friend who knows the user well and genuinely cares."""

    async def process(self, request: AgentRequest) -> AgentResponse:
        """Process emotional/motivational requests"""
        try:
            # Analyze sentiment
            detected_mood = await self._analyze_sentiment(request.input)

            # Get relevant context from knowledge graph
            context = await self.rag.get_context_for_query(
                user_id=request.user_id,
                query=request.input
            )

            # Build user profile summary
            profile = request.context.user_profile
            achievements_summary = self._format_achievements(profile.achievements[:3])
            goals_summary = self._format_goals(profile.goals[:3])

            # Build messages for Claude
            messages = self.format_conversation_history(request.context.history)
            messages.append({
                'role': 'user',
                'content': f"""Current emotional state: {profile.emotional_state.current_mood}
Detected mood in message: {detected_mood}

Recent achievements:
{achievements_summary}

Current goals:
{goals_summary}

{context}

User message: {request.input}

As the Emotional Agent, provide:
1. An empathetic, supportive response
2. Motivation or encouragement if needed
3. Practical suggestions for well-being
4. References to past successes if relevant"""
            })

            # Get response from Claude
            response_text = await self.call_claude(
                messages=messages,
                system_prompt=self.get_system_prompt(),
                temperature=0.8  # Higher temperature for more empathetic responses
            )

            # Determine if we should take any actions
            actions = self._suggest_actions(detected_mood, response_text)

            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content=response_text,
                actions=actions,
                should_speak=True,
                confidence=0.85,
                reasoning=f"Emotional analysis: detected {detected_mood}"
            )

        except Exception as e:
            logger.error(f"Error in Emotional Agent: {e}")
            return AgentResponse(
                id=str(uuid.uuid4()),
                agent_type=self.agent_type,
                content="I'm here for you. How can I support you right now?",
                actions=[],
                should_speak=True,
                confidence=0.5
            )

    async def _analyze_sentiment(self, text: str) -> MoodType:
        """Analyze sentiment of user input"""
        text_lower = text.lower()

        # Frustrated indicators
        if any(word in text_lower for word in ['frustrated', 'annoyed', 'stuck', 'damn', 'argh', 'ugh']):
            return MoodType.FRUSTRATED

        # Sad indicators
        if any(word in text_lower for word in ['sad', 'down', 'depressed', 'lonely', 'tired']):
            return MoodType.SAD

        # Stressed indicators
        if any(word in text_lower for word in ['stressed', 'overwhelmed', 'anxious', 'worried', 'deadline']):
            return MoodType.STRESSED

        # Happy/Excited indicators
        if any(word in text_lower for word in ['great', 'awesome', 'excited', 'happy', 'amazing', 'love']):
            return MoodType.EXCITED if 'excited' in text_lower else MoodType.HAPPY

        return MoodType.NEUTRAL

    def _format_achievements(self, achievements: List) -> str:
        """Format achievements for context"""
        if not achievements:
            return "Building your achievement history..."

        lines = []
        for ach in achievements:
            date_str = ach.date.strftime("%B %Y")
            lines.append(f"✨ {ach.title} ({date_str}): {ach.description}")

        return "\n".join(lines)

    def _format_goals(self, goals: List) -> str:
        """Format goals for context"""
        if not goals:
            return "Ready to set some goals..."

        lines = []
        for goal in goals:
            progress_bar = "█" * (goal.progress // 10) + "░" * (10 - goal.progress // 10)
            lines.append(f"🎯 {goal.title} [{progress_bar}] {goal.progress}%")

        return "\n".join(lines)

    def _suggest_actions(self, mood: MoodType, response: str) -> List[Action]:
        """Suggest actions based on emotional state"""
        actions = []

        # Suggest reaching out to relationships if stressed or sad
        if mood in [MoodType.STRESSED, MoodType.SAD, MoodType.FRUSTRATED]:
            if 'reach out' in response.lower() or 'connect' in response.lower():
                actions.append(Action(
                    type=ActionType.CONTACT,
                    status=ActionStatus.PENDING,
                    details={
                        'type': 'suggest_contact',
                        'reason': 'emotional_support'
                    }
                ))

        # Suggest reminders for self-care
        if 'break' in response.lower() or 'rest' in response.lower():
            actions.append(Action(
                type=ActionType.REMINDER,
                status=ActionStatus.PENDING,
                details={
                    'type': 'self_care_reminder',
                    'activity': 'take a break'
                }
            ))

        return actions


emotional_agent = EmotionalAgent()
