import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Server
    PORT: int = int(os.getenv("PORT", "8080"))
    ENV: str = os.getenv("NODE_ENV", "production")

    # Multi-LLM Configuration (Priority: Euron → DeepSeek → Gemini → OpenAI)
    EURON_API_KEY: str = os.getenv("EURON_API_KEY", "")
    EURON_API_BASE: str = os.getenv("EURON_API_BASE", "https://api.euron.one/api/v1/euri")
    EURON_MODEL: str = os.getenv("EURON_MODEL", "gpt-4.1-nano")

    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_API_BASE: str = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")

    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

    MODEL_NAME: str = os.getenv("MODEL_NAME", "gpt-4.1-nano")

    # Voice
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "2qfp6zPuviqeCOZIE9RZ")

    # Google Cloud
    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "pbulbule-apps-1762314316")
    GOOGLE_APPLICATION_CREDENTIALS: str = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")

    # Performance targets
    TARGET_LATENCY_MS: int = 500
    MAX_CONCURRENT_AGENTS: int = 3

    # Collections
    USERS_COLLECTION: str = "vinegar_users"
    SESSIONS_COLLECTION: str = "vinegar_sessions"
    KNOWLEDGE_COLLECTION: str = "vinegar_knowledge"
    ACTIONS_COLLECTION: str = "vinegar_actions"

    # Models
    CLAUDE_MODEL: str = "claude-sonnet-4-5-20250929"
    EMBEDDING_MODEL: str = "text-embedding-3-small"

    # Default user (AIML Agent Guy - Prashil Bulbule)
    DEFAULT_USER_ID: str = "prashil-bulbule"
    DEFAULT_USER_NAME: str = "Prashil Bulbule"
    DEFAULT_USER_EMAIL: str = "prashilbulbule13@gmail.com"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
