from typing import Optional, Dict, Any, List
from google.cloud import firestore
from datetime import datetime
from src.utils.config import settings
from src.utils.logger import logger
from src.models.types import UserProfile, EmotionalState, MoodType, UserPreferences, WorkingHours


class FirestoreService:
    """Service for managing Firestore operations"""

    def __init__(self):
        self.db = firestore.Client(project=settings.GOOGLE_CLOUD_PROJECT)
        self.users_ref = self.db.collection(settings.USERS_COLLECTION)
        self.sessions_ref = self.db.collection(settings.SESSIONS_COLLECTION)
        self.knowledge_ref = self.db.collection(settings.KNOWLEDGE_COLLECTION)
        self.actions_ref = self.db.collection(settings.ACTIONS_COLLECTION)

    async def get_user_profile(self, user_id: str) -> Optional[UserProfile]:
        """Get user profile from Firestore"""
        try:
            doc = self.users_ref.document(user_id).get()
            if doc.exists:
                data = doc.to_dict()
                return UserProfile(**data)
            else:
                # Return default user profile for Prashil
                return self._get_default_profile()
        except Exception as e:
            logger.error(f"Error getting user profile: {e}")
            return self._get_default_profile()

    def _get_default_profile(self) -> UserProfile:
        """Get default profile for Prashil Bulbule (AIML Agent Guy)"""
        return UserProfile(
            id=settings.DEFAULT_USER_ID,
            name=settings.DEFAULT_USER_NAME,
            email=settings.DEFAULT_USER_EMAIL,
            preferences=UserPreferences(
                wake_word="VINEGAR",
                voice_id=settings.ELEVENLABS_VOICE_ID,
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

    async def save_user_profile(self, profile: UserProfile) -> bool:
        """Save user profile to Firestore"""
        try:
            self.users_ref.document(profile.id).set(profile.model_dump(mode='json'))
            logger.info(f"Saved profile for user {profile.id}")
            return True
        except Exception as e:
            logger.error(f"Error saving user profile: {e}")
            return False

    async def save_session(self, session_id: str, data: Dict[str, Any]) -> bool:
        """Save conversation session"""
        try:
            data['timestamp'] = datetime.utcnow()
            self.sessions_ref.document(session_id).set(data)
            return True
        except Exception as e:
            logger.error(f"Error saving session: {e}")
            return False

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get conversation session"""
        try:
            doc = self.sessions_ref.document(session_id).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:
            logger.error(f"Error getting session: {e}")
            return None

    async def save_knowledge(self, node_id: str, data: Dict[str, Any]) -> bool:
        """Save knowledge node"""
        try:
            data['timestamp'] = datetime.utcnow()
            self.knowledge_ref.document(node_id).set(data)
            return True
        except Exception as e:
            logger.error(f"Error saving knowledge: {e}")
            return False

    async def query_knowledge(
        self,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Query knowledge base"""
        try:
            query = self.knowledge_ref.where('user_id', '==', user_id)
            if category:
                query = query.where('category', '==', category)
            query = query.limit(limit)

            docs = query.stream()
            return [doc.to_dict() for doc in docs]
        except Exception as e:
            logger.error(f"Error querying knowledge: {e}")
            return []

    async def save_action(self, action_id: str, data: Dict[str, Any]) -> bool:
        """Save action"""
        try:
            data['timestamp'] = datetime.utcnow()
            self.actions_ref.document(action_id).set(data)
            return True
        except Exception as e:
            logger.error(f"Error saving action: {e}")
            return False


firestore_service = FirestoreService()
