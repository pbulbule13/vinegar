from typing import List, Optional, Dict, Any, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class GoalCategory(str, Enum):
    CAREER = "career"
    PERSONAL = "personal"
    HEALTH = "health"
    FAMILY = "family"


class RelationType(str, Enum):
    FAMILY = "family"
    FRIEND = "friend"
    COLLEAGUE = "colleague"
    MENTOR = "mentor"


class MoodType(str, Enum):
    HAPPY = "happy"
    NEUTRAL = "neutral"
    FRUSTRATED = "frustrated"
    SAD = "sad"
    EXCITED = "excited"
    STRESSED = "stressed"


class AgentType(str, Enum):
    EXECUTIVE = "executive"
    EMOTIONAL = "emotional"
    PRIORITIZATION = "prioritization"
    ORCHESTRATOR = "orchestrator"


class ActionType(str, Enum):
    EMAIL = "email"
    CALENDAR = "calendar"
    REMINDER = "reminder"
    RESEARCH = "research"
    CONTACT = "contact"


class ActionStatus(str, Enum):
    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


class Goal(BaseModel):
    id: str
    title: str
    description: str
    priority: int = Field(ge=1, le=10)
    deadline: Optional[datetime] = None
    progress: int = Field(ge=0, le=100, default=0)
    category: GoalCategory


class Relationship(BaseModel):
    id: str
    name: str
    type: RelationType
    last_contact: Optional[datetime] = None
    notes: str = ""
    importance: int = Field(ge=1, le=10)


class Achievement(BaseModel):
    id: str
    title: str
    description: str
    date: datetime
    category: str


class EmotionalState(BaseModel):
    current_mood: MoodType
    confidence: float = Field(ge=0.0, le=1.0)
    timestamp: datetime
    context: Optional[str] = None


class KnowledgeNode(BaseModel):
    id: str
    content: str
    embedding: List[float]
    category: str
    timestamp: datetime
    metadata: Dict[str, Any] = Field(default_factory=dict)


class WorkingHours(BaseModel):
    start: str  # Format: "09:00"
    end: str    # Format: "18:00"


class UserPreferences(BaseModel):
    wake_word: str = "VINEGAR"
    voice_id: str = "EXAVITQu4vr4xnSDxMaL"
    timezone: str = "America/Los_Angeles"
    working_hours: WorkingHours = Field(default_factory=lambda: WorkingHours(start="09:00", end="18:00"))


class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    preferences: UserPreferences
    goals: List[Goal] = Field(default_factory=list)
    relationships: List[Relationship] = Field(default_factory=list)
    achievements: List[Achievement] = Field(default_factory=list)
    emotional_state: EmotionalState
    knowledge_graph: List[KnowledgeNode] = Field(default_factory=list)


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: datetime
    agent_type: Optional[AgentType] = None


class ConversationContext(BaseModel):
    session_id: str
    history: List[Message] = Field(default_factory=list)
    user_profile: UserProfile
    current_location: Optional[str] = None
    time_of_day: str


class AgentRequest(BaseModel):
    id: str
    user_id: str
    type: Literal["voice", "text"]
    input: str
    context: ConversationContext
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class Action(BaseModel):
    type: ActionType
    status: ActionStatus = ActionStatus.PENDING
    details: Dict[str, Any]
    result: Optional[Any] = None


class AgentResponse(BaseModel):
    id: str
    agent_type: AgentType
    content: str
    actions: List[Action] = Field(default_factory=list)
    should_speak: bool = True
    audio_url: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: Optional[str] = None


class EmailSummary(BaseModel):
    id: str
    from_email: str = Field(alias="from")
    subject: str
    snippet: str
    importance: int = Field(ge=1, le=10)
    action_required: bool
    suggested_response: Optional[str] = None
    timestamp: datetime

    class Config:
        populate_by_name = True


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    attendees: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    travel_time: Optional[int] = None  # minutes


class VectorSearchResult(BaseModel):
    content: str
    similarity: float
    metadata: Dict[str, Any]


class SystemMetrics(BaseModel):
    active_agents: int
    response_latency: float
    tokens_used: int
    uptime: float
    request_count: int
    error_rate: float
