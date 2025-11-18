"""
Multi-LLM Client with Fallback Support
Supports: Euron → DeepSeek → Gemini → OpenAI
"""
import os
import asyncio
from typing import List, Dict, Optional
from openai import AsyncOpenAI
import google.generativeai as genai
from src.utils.logger import logger


class MultiLLMClient:
    """
    Multi-provider LLM client with automatic fallback
    Priority: Euron → DeepSeek → Gemini → OpenAI
    """

    def __init__(self):
        # Euron (Primary)
        self.euron_api_key = os.getenv("EURON_API_KEY", "")
        self.euron_base = os.getenv("EURON_API_BASE", "https://api.euron.one/api/v1/euri")
        self.euron_model = os.getenv("EURON_MODEL", "gpt-4.1-nano")

        # DeepSeek (Fallback 1)
        self.deepseek_api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.deepseek_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")

        # Gemini (Fallback 2)
        self.google_api_key = os.getenv("GOOGLE_API_KEY", "")
        if self.google_api_key:
            genai.configure(api_key=self.google_api_key)

        # OpenAI (Fallback 3)
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")

        # Model names
        self.model_name = os.getenv("MODEL_NAME", "gpt-4.1-nano")

        # Initialize clients
        self.euron_client = None
        self.deepseek_client = None
        self.openai_client = None
        self.gemini_model = None

        self._initialize_clients()

    def _initialize_clients(self):
        """Initialize all available LLM clients"""
        # Euron client (OpenAI-compatible)
        if self.euron_api_key:
            try:
                self.euron_client = AsyncOpenAI(
                    api_key=self.euron_api_key,
                    base_url=self.euron_base
                )
                logger.info("Euron client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Euron client: {e}")

        # DeepSeek client
        if self.deepseek_api_key:
            try:
                self.deepseek_client = AsyncOpenAI(
                    api_key=self.deepseek_api_key,
                    base_url=self.deepseek_base
                )
                logger.info("DeepSeek client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize DeepSeek client: {e}")

        # Gemini
        if self.google_api_key:
            try:
                self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
                logger.info("Gemini client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini client: {e}")

        # OpenAI client
        if self.openai_api_key:
            try:
                self.openai_client = AsyncOpenAI(api_key=self.openai_api_key)
                logger.info("OpenAI client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI client: {e}")

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        max_tokens: int = 2000,
        temperature: float = 0.7
    ) -> str:
        """
        Get chat completion with automatic fallback
        Tries providers in order: Euron → DeepSeek → Gemini → OpenAI
        """

        # Prepend system message if provided
        if system_prompt:
            messages = [{"role": "system", "content": system_prompt}] + messages

        # Try Euron (Primary)
        if self.euron_client:
            try:
                logger.info("Trying Euron API...")
                response = await self.euron_client.chat.completions.create(
                    model=self.euron_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
                result = response.choices[0].message.content
                logger.info("✅ Euron API successful")
                return result
            except Exception as e:
                logger.warning(f"Euron API failed: {e}, falling back to DeepSeek...")

        # Try DeepSeek (Fallback 1)
        if self.deepseek_client:
            try:
                logger.info("Trying DeepSeek API...")
                response = await self.deepseek_client.chat.completions.create(
                    model="deepseek-chat",
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
                result = response.choices[0].message.content
                logger.info("✅ DeepSeek API successful")
                return result
            except Exception as e:
                logger.warning(f"DeepSeek API failed: {e}, falling back to Gemini...")

        # Try Gemini (Fallback 2)
        if self.gemini_model:
            try:
                logger.info("Trying Gemini API...")
                # Convert messages to Gemini format
                gemini_prompt = self._format_for_gemini(messages)
                response = await asyncio.to_thread(
                    self.gemini_model.generate_content,
                    gemini_prompt
                )
                result = response.text
                logger.info("✅ Gemini API successful")
                return result
            except Exception as e:
                logger.warning(f"Gemini API failed: {e}, falling back to OpenAI...")

        # Try OpenAI (Fallback 3)
        if self.openai_client:
            try:
                logger.info("Trying OpenAI API...")
                response = await self.openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
                result = response.choices[0].message.content
                logger.info("✅ OpenAI API successful")
                return result
            except Exception as e:
                logger.error(f"OpenAI API failed: {e}")
                raise Exception("All LLM providers failed")

        raise Exception("No LLM providers configured")

    def _format_for_gemini(self, messages: List[Dict[str, str]]) -> str:
        """Format OpenAI-style messages for Gemini"""
        formatted = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "system":
                formatted.append(f"System: {content}")
            elif role == "user":
                formatted.append(f"User: {content}")
            elif role == "assistant":
                formatted.append(f"Assistant: {content}")

        return "\n\n".join(formatted)


# Global instance
llm_client = MultiLLMClient()
