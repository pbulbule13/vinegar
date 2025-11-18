from typing import Optional
import aiohttp
import base64
from src.utils.config import settings
from src.utils.logger import logger


class VoiceService:
    """Service for voice synthesis using ElevenLabs"""

    def __init__(self):
        self.api_key = settings.ELEVENLABS_API_KEY
        self.voice_id = settings.ELEVENLABS_VOICE_ID
        self.base_url = "https://api.elevenlabs.io/v1"

    async def text_to_speech(
        self,
        text: str,
        voice_id: Optional[str] = None,
        stability: float = 0.5,
        similarity_boost: float = 0.75
    ) -> Optional[bytes]:
        """Convert text to speech using ElevenLabs"""
        if not self.api_key:
            logger.warning("ElevenLabs API key not configured")
            return None

        voice = voice_id or self.voice_id
        url = f"{self.base_url}/text-to-speech/{voice}"

        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": self.api_key
        }

        data = {
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost
            }
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=data) as response:
                    if response.status == 200:
                        audio_data = await response.read()
                        logger.info(f"Generated speech for text: {text[:50]}...")
                        return audio_data
                    else:
                        error = await response.text()
                        logger.error(f"ElevenLabs API error: {error}")
                        return None

        except Exception as e:
            logger.error(f"Error in text-to-speech: {e}")
            return None

    async def get_voices(self) -> list:
        """Get available voices from ElevenLabs"""
        if not self.api_key:
            logger.warning("ElevenLabs API key not configured")
            return []

        url = f"{self.base_url}/voices"
        headers = {"xi-api-key": self.api_key}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get('voices', [])
                    else:
                        logger.error(f"Error fetching voices: {response.status}")
                        return []

        except Exception as e:
            logger.error(f"Error getting voices: {e}")
            return []

    def audio_to_base64(self, audio_bytes: bytes) -> str:
        """Convert audio bytes to base64 for transmission"""
        return base64.b64encode(audio_bytes).decode('utf-8')


voice_service = VoiceService()
