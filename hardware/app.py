#!/usr/bin/env python3
"""Chat-driven Hardware App.

Entry point that wires [`hardware.core.chat_handler.ChatHandler`](hardware/core/chat_handler.py)
with [`hardware.core.tool_registry.ToolRegistry`](hardware/core/tool_registry.py) and the
tools under [`hardware.tools`](hardware/tools/__init__.py).

This module is intentionally import-stable when executed from different working
directories.
"""

from __future__ import annotations

from hardware.app_logging.logger import configure_logging, get_logger
from hardware.core.chat_handler import ChatHandler
from hardware.core.tool_registry import ToolRegistry
from hardware.tools.apply_theme_tool import ApplyThemeTool
from hardware.tools.create_blueprint_tool import CreateBlueprintTool
from hardware.tools.edit_profile_tool import EditProfileTool
from hardware.tools.help_tool import HelpTool
from hardware.tools.live_assistance_tool import LiveAssistanceTool
from hardware.tools.load_blueprint_tool import LoadBlueprintTool
from hardware.tools.quit_tool import QuitTool
from hardware.tools.save_profile_tool import SaveProfileTool
from hardware.tools.smart_mode_tool import SmartModeTool
from hardware.tools.view_stats_tool import ViewStatsTool


def main() -> None:
    configure_logging()
    logger = get_logger(__name__)

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

    logger.info("Starting chat")
    ChatHandler(registry).start_chat()


if __name__ == "__main__":
    main()
