#!/usr/bin/env python3
"""JARVIS - Agentic Hardware Assistant.

A chat-driven application that uses a multi-agent system to handle complex tasks.

Features:
- Multi-agent orchestration (Coder, Planner, Blueprint, Critic, Researcher, Memory)
- Parallel task execution with dependency management
- Advanced memory system (semantic search, episodic memory, conversation history)
- Tool calling for file operations, blueprints, and more
- Text-to-Speech output
- Google AI (Gemini) and Ollama LLM providers

Configuration via environment variables:
- AI_PROVIDER: google | ollama (default: ollama)
- OLLAMA_MODEL: Model name for Ollama (default: gemma3:1b)
- TTS_ENGINE: pyttsx3 | gtts | disabled (default: disabled)
- See .env.example for full configuration options
"""

from __future__ import annotations

# Standard library imports
import asyncio
import sys
from pathlib import Path
from typing import TYPE_CHECKING

# Local application imports
from app_logging.logger import configure_logging, get_logger
from config.config import get_config
from core.chat_handler import ChatHandler
from core.security import SecurityManager, set_security_manager
from core.tool_registry import ToolRegistry

# Import agent tools
from tools import AGENT_TOOLS

# Import tools
from tools.apply_theme_tool import ApplyThemeTool
from tools.blueprint_edit_tool import BlueprintEditTool
from tools.create_blueprint_tool import CreateBlueprintTool
from tools.delete_blueprint_tool import DeleteBlueprintTool
from tools.edit_profile_tool import EditProfileTool
from tools.help_tool import HelpTool
from tools.import_blueprint_tool import ImportBlueprintTool
from tools.list_blueprints_tool import ListBlueprintsTool
from tools.live_assistance_tool import LiveAssistanceTool
from tools.load_blueprint_tool import LoadBlueprintTool
from tools.quit_tool import QuitTool
from tools.read_file_tool import ReadFileTool
from tools.save_profile_tool import SaveProfileTool
from tools.smart_mode_tool import SmartModeTool
from tools.view_stats_tool import ViewStatsTool
from tools.write_file_tool import WriteFileTool

if TYPE_CHECKING:
    from core.agents import OrchestratorAgent


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
    registry.register_tool(ListBlueprintsTool())
    registry.register_tool(LoadBlueprintTool())
    registry.register_tool(CreateBlueprintTool())
    registry.register_tool(BlueprintEditTool())
    registry.register_tool(DeleteBlueprintTool())
    registry.register_tool(ImportBlueprintTool())

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

    # Agent tools (code execution, web search, memory, etc.)
    for tool in AGENT_TOOLS:
        try:
            registry.register_tool(tool)
        except Exception as e:
            logger = get_logger(__name__)
            logger.warning(f"Failed to register tool {tool.name}: {e}")
    registry.register_tool(ReadFileTool(security_manager))
    registry.register_tool(WriteFileTool(security_manager))


def load_external_plugins(
    registry: ToolRegistry, security_manager: SecurityManager
) -> None:
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


def setup_agents(model_name: str | None = None) -> OrchestratorAgent:
    """Set up the multi-agent system.

    Args:
        model_name: Ollama model to use for agents.

    Returns:
        Configured OrchestratorAgent with all specialized agents.
    """
    from core.agents import create_agent_team

    orchestrator = create_agent_team(model_name)
    return orchestrator


def setup_advanced_memory() -> None:
    """Set up the advanced memory system.

    Returns:
        Configured UnifiedMemoryManager.
    """
    from core.memory import UnifiedMemoryManager

    memory_manager = UnifiedMemoryManager(
        storage_path="data/memory",
        max_conversation_messages=200,
        max_semantic_memories=10000,
        max_episodes=5000,
    )

    return memory_manager


def main() -> None:
    """Main entry point for JARVIS."""
    configure_logging()
    logger = get_logger(__name__)

    # Load configuration
    config = get_config()
    logger.info("Starting %s", config.app_name)

    print("\n" + "=" * 60)
    print("  🤖 JARVIS - Agentic Hardware Assistant")
    print("=" * 60)

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

    # Setup multi-agent system
    try:
        model_name = (
            config.ai.ollama_model if hasattr(config.ai, "ollama_model") else None
        )
        orchestrator = setup_agents(model_name)
        agent_names = orchestrator.get_registered_agents()
        logger.info("Agent system initialized with %d agents", len(agent_names))
        print(f"  ✓ Agents: {', '.join(agent_names)}")
    except Exception as e:
        logger.warning("Failed to initialize agent system: %s", e)
        orchestrator = None
        print("  ⚠ Agent system not available")

    # Setup advanced memory
    try:
        memory_manager = setup_advanced_memory()
        logger.info("Advanced memory system initialized")
        print("  ✓ Advanced memory system active")
    except Exception as e:
        logger.warning("Failed to initialize advanced memory: %s", e)
        memory_manager = None
        print("  ⚠ Using basic memory")

    # Create chat handler
    enable_tts = config.tts.engine.value != "disabled"
    chat_handler = ChatHandler(
        tool_registry=registry,
        llm=llm,
        tts_engine=tts,
        enable_tts=enable_tts,
        orchestrator=orchestrator,
        memory_manager=memory_manager,
    )

    print("=" * 60 + "\n")

    # Launch TUI
    logger.info("Launching TUI")
    from core.tui.app import JarvisTUI

    agent_names_list = (
        orchestrator.get_registered_agents() if orchestrator else []
    )
    tui = JarvisTUI(
        chat_handler=chat_handler,
        orchestrator=orchestrator,
        agent_names=agent_names_list,
        tool_count=len(registry.get_all_tools()),
        memory_active=memory_manager is not None,
    )
    tui.run()


if __name__ == "__main__":
    main()
