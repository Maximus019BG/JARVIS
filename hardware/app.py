#!/usr/bin/env python3
"""Chat-driven Hardware App.

Entry point that wires [`hardware.core.chat_handler.ChatHandler`](hardware/core/chat_handler.py)
with [`hardware.core.tool_registry.ToolRegistry`](hardware/core/tool_registry.py) and the
tools under [`hardware.tools`](hardware/tools/__init__.py).

Supports:
- Google AI (Gemini) and Ollama LLM providers
- Text-to-Speech output
- File access tools with security
- External plugin loading

Configuration via environment variables:
- AI_PROVIDER: google | ollama (default: google)
- GOOGLE_AI_API_KEY: Your Google AI Studio API key
- TTS_ENGINE: pyttsx3 | gtts | disabled (default: pyttsx3)
- See .env.example for full configuration options
"""

from __future__ import annotations

# Standard library imports
from pathlib import Path
import sys

# Local application imports
from app_logging.logger import configure_logging, get_logger
from config.config import get_config
from core.chat_handler import ChatHandler
from core.security import SecurityManager, set_security_manager
from core.tool_registry import ToolRegistry

# Import tools
from tools.apply_theme_tool import ApplyThemeTool
from tools.create_blueprint_tool import CreateBlueprintTool
from tools.edit_profile_tool import EditProfileTool
from tools.help_tool import HelpTool
from tools.live_assistance_tool import LiveAssistanceTool
from tools.load_blueprint_tool import LoadBlueprintTool
from tools.quit_tool import QuitTool
from tools.read_file_tool import ReadFileTool
from tools.save_profile_tool import SaveProfileTool
from tools.smart_mode_tool import SmartModeTool
from tools.view_stats_tool import ViewStatsTool
from tools.write_file_tool import WriteFileTool


def setup_security() -> SecurityManager:
    """Initialize and configure the security manager."""
    config = get_config()
    security_manager = SecurityManager(config.security)
    set_security_manager(security_manager)
    return security_manager


def setup_llm():
    """Create LLM provider based on configuration."""
    from core.llm.provider_factory import LLMProviderFactory

    config = get_config()

    try:
        config.ai.validate_provider()
    except ValueError as e:
        print(f"Warning: {e}")
        print("Falling back to Ollama...")

    return LLMProviderFactory.create_with_fallback(config.ai)


def setup_tts():
    """Create TTS engine based on configuration."""
    from core.tts.engine import TTSEngineFactory

    config = get_config()
    return TTSEngineFactory.create(config.tts)


def register_tools(registry: ToolRegistry, security_manager: SecurityManager) -> None:
    """Register all available tools."""
    # Core tools
    registry.register_tool(HelpTool(registry))
    registry.register_tool(QuitTool())

    # Blueprint tools
    registry.register_tool(LoadBlueprintTool())
    registry.register_tool(CreateBlueprintTool())

    # Assistance tools
    registry.register_tool(LiveAssistanceTool())
    registry.register_tool(SmartModeTool())

    # Profile/Theme tools
    registry.register_tool(ApplyThemeTool())
    registry.register_tool(ViewStatsTool())
    registry.register_tool(EditProfileTool())
    registry.register_tool(SaveProfileTool())

    # File access tools (with security)
    registry.register_tool(ReadFileTool(security_manager))
    registry.register_tool(WriteFileTool(security_manager))


def load_external_plugins(registry: ToolRegistry, security_manager: SecurityManager) -> None:
    """Load external plugins from the plugins directory if it exists."""
    from core.external_tools import ExternalToolConnector

    plugins_dir = Path("./plugins")
    if not plugins_dir.exists():
        return

    connector = ExternalToolConnector(registry, security_manager)

    try:
        results = connector.load_plugins_from_directory(plugins_dir)
        for plugin_path, tools in results.items():
            if tools:
                print(f"Loaded plugin: {Path(plugin_path).name} ({len(tools)} tools)")
    except Exception as e:
        print(f"Warning: Failed to load plugins: {e}")


def main() -> None:
    """Main entry point for the hardware app."""
    configure_logging()
    logger = get_logger(__name__)

    # Load configuration
    config = get_config()
    logger.info("Starting %s", config.app_name)

    # Setup security
    security_manager = setup_security()
    logger.info("Security level: %s", config.security.level.value)

    # Setup LLM provider
    try:
        llm = setup_llm()
        logger.info("LLM provider initialized")
    except Exception as e:
        logger.error("Failed to initialize LLM provider: %s", e)
        print(f"Error: Could not initialize AI provider: {e}")
        print("Please check your configuration and API keys.")
        sys.exit(1)

    # Setup TTS
    try:
        tts = setup_tts()
        logger.info("TTS engine: %s", tts.name if tts else "disabled")
    except Exception as e:
        logger.warning("TTS initialization failed: %s", e)
        tts = None

    # Setup tool registry
    registry = ToolRegistry()
    register_tools(registry, security_manager)
    logger.info("Registered %d tools", len(registry.get_all_tools()))

    # Load external plugins
    load_external_plugins(registry, security_manager)

    # Create chat handler and start
    enable_tts = config.tts.engine.value != "disabled"
    chat_handler = ChatHandler(
        tool_registry=registry,
        llm=llm,
        tts_engine=tts,
        enable_tts=enable_tts,
    )

    logger.info("Starting chat")
    chat_handler.start_chat()


if __name__ == "__main__":
    main()
