#!/usr/bin/env python3
"""
Chat-driven Hardware App
Replaces the TUI with a natural language interface using AI and tools.
"""

try:
    from core.chat_handler import ChatHandler
    from core.tool_registry import ToolRegistry
except ImportError as e:
    print(f"Import error: {e}")
    print("Please ensure all dependencies are installed.")
    exit(1)
from tools.apply_theme_tool import ApplyThemeTool
from tools.create_blueprint_tool import CreateBlueprintTool
from tools.edit_profile_tool import EditProfileTool
from tools.help_tool import HelpTool
from tools.live_assistance_tool import LiveAssistanceTool
from tools.load_blueprint_tool import LoadBlueprintTool
from tools.quit_tool import QuitTool
from tools.save_profile_tool import SaveProfileTool
from tools.smart_mode_tool import SmartModeTool
from tools.view_stats_tool import ViewStatsTool


def main():
    # Initialize tool registry
    registry = ToolRegistry()

    # Register tools
    registry.register_tool(HelpTool(registry))
    registry.register_tool(LoadBlueprintTool())
    registry.register_tool(CreateBlueprintTool())
    registry.register_tool(LiveAssistanceTool())
    registry.register_tool(SmartModeTool())
    registry.register_tool(ApplyThemeTool())
    registry.register_tool(ViewStatsTool())
    registry.register_tool(EditProfileTool())
    registry.register_tool(SaveProfileTool())
    registry.register_tool(QuitTool())

    # Initialize chat handler
    chat_handler = ChatHandler(registry)

    # Start chat
    chat_handler.start_chat()


if __name__ == "__main__":
    main()
