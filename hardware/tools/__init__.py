# Tools package for hardware app functionalities

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .connection_info_tool import ConnectionInfoTool
    from .list_devices_tool import ListDevicesTool
    from .register_device_tool import RegisterDeviceTool
    from .execute_code_tool import ExecuteCodeTool
    from .memory_tools import ForgetTool, MemoryStatsTool, RecallTool, RememberTool
    from .resolve_conflict_tool import ResolveConflictTool
    from .send_blueprint_tool import SendBlueprintTool
    from .shell_tool import ListDirectoryTool, ShellCommandTool
    from .summarize_tool import ExtractKeyPointsTool, SummarizeTool
    from .sync_config_tool import SyncConfigTool
    from .sync_queue_tool import SyncQueueTool
    from .sync_status_tool import SyncStatusTool
    from .sync_tool import SyncTool
    from .update_blueprint_tool import UpdateBlueprintTool
    from .web_search_tool import FetchWebpageTool, WebSearchTool

__all__ = [
    # Sync tools
    "SyncTool",
    "SendBlueprintTool",
    "UpdateBlueprintTool",
    "SyncConfigTool",
    "SyncQueueTool",
    "SyncStatusTool",
    "ResolveConflictTool",
    "ConnectionInfoTool",
    "ListDevicesTool",
    "RegisterDeviceTool",
    # Code execution
    "ExecuteCodeTool",
    # Web tools
    "WebSearchTool",
    "FetchWebpageTool",
    # Text tools
    "SummarizeTool",
    "ExtractKeyPointsTool",
    # Shell tools
    "ShellCommandTool",
    "ListDirectoryTool",
    # Memory tools
    "RememberTool",
    "RecallTool",
    "ForgetTool",
    "MemoryStatsTool",
    # Lazy loading functions
    "get_sync_tools",
    "get_agent_tools",
    "get_all_tools",
]


class LazyToolRegistry:
    """Lazy-loading registry for tools.

    Performance improvement: Tools are only instantiated when first accessed,
    reducing startup time and memory footprint.
    """

    def __init__(self) -> None:
        self._sync_tools: list[object] | None = None
        self._agent_tools: list[object] | None = None
        self._tool_factories: dict[str, Callable[[], object]] = {}
        self._instances: dict[str, object] = {}

    def register_factory(self, name: str, factory: Callable[[], object]) -> None:
        """Register a factory function for lazy instantiation.

        Args:
            name: Name/identifier for the tool.
            factory: Function that creates the tool instance.
        """
        self._tool_factories[name] = factory

    def get_tool(self, name: str) -> object:
        """Get a tool instance, creating it lazily if needed.

        Args:
            name: Name of the tool to retrieve.

        Returns:
            The tool instance.
        """
        if name not in self._instances:
            if name not in self._tool_factories:
                raise KeyError(f"Tool '{name}' not registered")
            self._instances[name] = self._tool_factories[name]()
        return self._instances[name]

    def get_sync_tools(self) -> list[object]:
        """Get all sync tools, creating them lazily if needed.

        Returns:
            List of sync tool instances.
        """
        if self._sync_tools is None:
            self._sync_tools = [
                self.get_tool("SyncTool"),
                self.get_tool("SendBlueprintTool"),
                self.get_tool("UpdateBlueprintTool"),
                self.get_tool("SyncConfigTool"),
                self.get_tool("SyncQueueTool"),
                self.get_tool("SyncStatusTool"),
                self.get_tool("ResolveConflictTool"),
                self.get_tool("ConnectionInfoTool"),
                self.get_tool("ListDevicesTool"),
                self.get_tool("RegisterDeviceTool"),
            ]
        return self._sync_tools

    def get_agent_tools(self) -> list[object]:
        """Get all agent tools, creating them lazily if needed.

        Returns:
            List of agent tool instances.
        """
        if self._agent_tools is None:
            self._agent_tools = [
                self.get_tool("ExecuteCodeTool"),
                self.get_tool("WebSearchTool"),
                self.get_tool("FetchWebpageTool"),
                self.get_tool("SummarizeTool"),
                self.get_tool("ExtractKeyPointsTool"),
                self.get_tool("ShellCommandTool"),
                self.get_tool("ListDirectoryTool"),
                self.get_tool("RememberTool"),
                self.get_tool("RecallTool"),
                self.get_tool("ForgetTool"),
                self.get_tool("MemoryStatsTool"),
            ]
        return self._agent_tools

    def get_all_tools(self) -> list[object]:
        """Get all tools, creating them lazily if needed.

        Returns:
            List of all tool instances.
        """
        return self.get_sync_tools() + self.get_agent_tools()

    def clear_cache(self) -> None:
        """Clear cached tool instances, forcing re-creation on next access.

        Useful for testing or when tool state needs to be reset.
        """
        self._instances.clear()
        self._sync_tools = None
        self._agent_tools = None


# Global lazy tool registry instance
_tool_registry: LazyToolRegistry | None = None


def _get_tool_registry() -> LazyToolRegistry:
    """Get the global tool registry instance."""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = LazyToolRegistry()
        # Register tool factories for lazy loading
        _tool_registry.register_factory(
            "SyncTool", lambda: _import_and_create("sync_tool", "SyncTool")
        )
        _tool_registry.register_factory(
            "SendBlueprintTool",
            lambda: _import_and_create("send_blueprint_tool", "SendBlueprintTool"),
        )
        _tool_registry.register_factory(
            "UpdateBlueprintTool",
            lambda: _import_and_create("update_blueprint_tool", "UpdateBlueprintTool"),
        )
        _tool_registry.register_factory(
            "SyncConfigTool",
            lambda: _import_and_create("sync_config_tool", "SyncConfigTool"),
        )
        _tool_registry.register_factory(
            "SyncQueueTool",
            lambda: _import_and_create("sync_queue_tool", "SyncQueueTool"),
        )
        _tool_registry.register_factory(
            "SyncStatusTool",
            lambda: _import_and_create("sync_status_tool", "SyncStatusTool"),
        )
        _tool_registry.register_factory(
            "ResolveConflictTool",
            lambda: _import_and_create("resolve_conflict_tool", "ResolveConflictTool"),
        )
        _tool_registry.register_factory(
            "ConnectionInfoTool",
            lambda: _import_and_create("connection_info_tool", "ConnectionInfoTool"),
        )
        _tool_registry.register_factory(
            "ListDevicesTool",
            lambda: _import_and_create("list_devices_tool", "ListDevicesTool"),
        )
        _tool_registry.register_factory(
            "RegisterDeviceTool",
            lambda: _import_and_create("register_device_tool", "RegisterDeviceTool"),
        )
        _tool_registry.register_factory(
            "ExecuteCodeTool",
            lambda: _import_and_create("execute_code_tool", "ExecuteCodeTool"),
        )
        _tool_registry.register_factory(
            "WebSearchTool",
            lambda: _import_and_create("web_search_tool", "WebSearchTool"),
        )
        _tool_registry.register_factory(
            "FetchWebpageTool",
            lambda: _import_and_create("web_search_tool", "FetchWebpageTool"),
        )
        _tool_registry.register_factory(
            "SummarizeTool",
            lambda: _import_and_create("summarize_tool", "SummarizeTool"),
        )
        _tool_registry.register_factory(
            "ExtractKeyPointsTool",
            lambda: _import_and_create("summarize_tool", "ExtractKeyPointsTool"),
        )
        _tool_registry.register_factory(
            "ShellCommandTool",
            lambda: _import_and_create("shell_tool", "ShellCommandTool"),
        )
        _tool_registry.register_factory(
            "ListDirectoryTool",
            lambda: _import_and_create("shell_tool", "ListDirectoryTool"),
        )
        _tool_registry.register_factory(
            "RememberTool", lambda: _import_and_create("memory_tools", "RememberTool")
        )
        _tool_registry.register_factory(
            "RecallTool", lambda: _import_and_create("memory_tools", "RecallTool")
        )
        _tool_registry.register_factory(
            "ForgetTool", lambda: _import_and_create("memory_tools", "ForgetTool")
        )
        _tool_registry.register_factory(
            "MemoryStatsTool",
            lambda: _import_and_create("memory_tools", "MemoryStatsTool"),
        )
    return _tool_registry


def _import_and_create(module_name: str, class_name: str) -> object:
    """Import a tool class and create an instance.

    Args:
        module_name: Name of the module to import.
        class_name: Name of the class to instantiate.

    Returns:
        Instance of the tool class.
    """
    module = __import__(f"tools.{module_name}", fromlist=[class_name])
    tool_class = getattr(module, class_name)
    return tool_class()


def get_sync_tools() -> list[object]:
    """Get all sync tools with lazy loading.

    Returns:
        List of sync tool instances.
    """
    return _get_tool_registry().get_sync_tools()


def get_agent_tools() -> list[object]:
    """Get all agent tools with lazy loading.

    Returns:
        List of agent tool instances.
    """
    return _get_tool_registry().get_agent_tools()


def get_all_tools() -> list[object]:
    """Get all tools with lazy loading.

    Returns:
        List of all tool instances.
    """
    return _get_tool_registry().get_all_tools()


# Backward compatibility: Keep old lists for existing code
# These will be replaced with lazy-loaded versions on first access
SYNC_TOOLS: list[object] = []
AGENT_TOOLS: list[object] = []


def _initialize_legacy_lists() -> None:
    """Initialize legacy lists for backward compatibility."""
    global SYNC_TOOLS, AGENT_TOOLS
    if not SYNC_TOOLS:
        SYNC_TOOLS = get_sync_tools()
    if not AGENT_TOOLS:
        AGENT_TOOLS = get_agent_tools()


# Lazy initialization of legacy lists
def __getattr__(name: str) -> object:
    """Lazy attribute access for backward compatibility."""
    if name in ("SYNC_TOOLS", "AGENT_TOOLS"):
        _initialize_legacy_lists()
        return globals()[name]
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
