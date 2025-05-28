"""
Configuration settings for AI vision providers (OpenAI and Gemini).
"""
import os
from dotenv import load_dotenv
from logging_config import logger

# Ensure environment variables are loaded
load_dotenv()

# --- Vision Provider Configuration ---
# Choose 'openai' or 'gemini'
VISION_PROVIDER: str = os.getenv("VISION_PROVIDER", "gemini").lower()

# --- OpenAI Configuration ---
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY")
OPENAI_VISION_MODEL: str = os.getenv("OPENAI_VISION_MODEL", "gpt-4o")

# --- Gemini Configuration ---
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY")
GEMINI_VISION_MODEL: str = os.getenv("GEMINI_VISION_MODEL", "gemini-2.0-flash")

MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "2048"))

logger.info(f"VISION_PROVIDER: {VISION_PROVIDER}")
logger.info(f"OPENAI_VISION_MODEL: {OPENAI_VISION_MODEL}")
logger.info(f"GEMINI_VISION_MODEL: {GEMINI_VISION_MODEL}")
logger.info(f"MAX_IMAGE_DIMENSION: {MAX_IMAGE_DIMENSION}")