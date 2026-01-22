"""External tool connector for loading plugins and external tools.

Provides a flexible system for connecting external tools via:
- Python plugin files
- Dynamic module loading
- Security validation
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool
from core.security import SecurityManager, get_security_manager

if TYPE_CHECKING:
    from core.tool_registry import ToolRegistry

logger = get_logger(__name__)


class PluginError(Exception):
    """Raised when plugin loading fails."""

    def __init__(self, message: str, errors: list[tuple[str, str]] | None = None) -> None:
        """Initialize the plugin error.

        Args:
            message: The error message.
            errors: Optional list of (tool_name, error_message) tuples.
        """
        super().__init__(message)
        self.errors = errors or []

    def __str__(self) -> str:
        """Return a detailed error message."""
        if not self.errors:
            return super().__str__()

        error_details = "\n".join(f"  - {name}: {msg}" for name, msg in self.errors)
        return f"{super().__str__()}\nFailed tools:\n{error_details}"


class ExternalToolConnector:
    """Connector for loading and managing external tool plugins.

    Plugins are Python modules that export a TOOLS list containing
    BaseTool subclasses.

    Example plugin structure:
    ```python
    # my_plugin.py
    from hardware.core.base_tool import BaseTool

    class MyCustomTool(BaseTool):
        @property
        def name(self) -> str:
            return "my_custom_tool"

        @property
        def description(self) -> str:
            return "Does something custom"

        def execute(self, **kwargs) -> str:
            return "Custom result"

    # Export tools
    TOOLS = [MyCustomTool]
    ```
    """

    def __init__(
        self,
        registry: ToolRegistry,
        security_manager: SecurityManager | None = None,
    ) -> None:
        self.registry = registry
        self.security = security_manager or get_security_manager()
        self.connected_tools: dict[str, BaseTool] = {}
        self._loaded_plugins: dict[str, Any] = {}

    def connect_plugin(self, plugin_path: str | Path) -> list[str]:
        """Load and register tools from a plugin file.

        Args:
            plugin_path: Path to the plugin Python file.

        Returns:
            List of tool names that were registered.

        Raises:
            PluginError: If the plugin cannot be loaded.
        """
        path = Path(plugin_path).resolve()

        # Security: Validate plugin path
        try:
            self.security.validate_file_access(path)
        except Exception as e:
            raise PluginError(f"Plugin path not allowed: {e}") from e

        if not path.exists():
            raise PluginError(f"Plugin file not found: {path}")

        if not path.suffix == ".py":
            raise PluginError(f"Plugin must be a Python file: {path}")

        # Security: Verify plugin signature if high security
        if not self.security.verify_plugin_signature(path):
            raise PluginError(f"Plugin signature verification failed: {path}")

        # Load the plugin module
        try:
            plugin_module = self._load_module(path)
        except Exception as e:
            raise PluginError(f"Failed to load plugin: {e}") from e

        # Get and validate TOOLS export
        if not hasattr(plugin_module, "TOOLS"):
            raise PluginError(
                f"Plugin must export a TOOLS list: {path}"
            )

        tools_list = plugin_module.TOOLS
        if not isinstance(tools_list, (list, tuple)):
            raise PluginError(
                f"TOOLS must be a list or tuple: {path}"
            )

        # Register tools, collecting any errors
        registered_names: list[str] = []
        registration_errors: list[tuple[str, str]] = []

        for tool_class in tools_list:
            try:
                tool_instance = self._instantiate_tool(tool_class)
                self._register_tool(tool_instance)
                registered_names.append(tool_instance.name)
            except Exception as e:
                tool_name = getattr(tool_class, "__name__", str(tool_class))
                error_msg = f"{type(e).__name__}: {e}"
                registration_errors.append((tool_name, error_msg))
                logger.error(
                    "Failed to register tool %s from %s: %s",
                    tool_name,
                    path,
                    e,
                )

        # If there were registration errors, raise a summary exception
        if registration_errors:
            # Rollback: unregister any tools that were successfully registered
            for name in registered_names:
                try:
                    self.registry.unregister_tool(name)
                    if name in self.connected_tools:
                        del self.connected_tools[name]
                except Exception as e:
                    logger.warning("Failed to rollback tool %s: %s", name, e)

            error = PluginError(
                f"Failed to load plugin {path}: {len(registration_errors)} tool(s) failed to register",
                registration_errors,
            )
            self.security.audit_log(
                "plugin_loading_failed",
                {
                    "path": str(path),
                    "errors": registration_errors,
                },
            )
            raise error

        # Track loaded plugin
        self._loaded_plugins[str(path)] = plugin_module

        # Audit log
        self.security.audit_log(
            "plugin_loaded",
            {
                "path": str(path),
                "tools": registered_names,
            },
        )

        logger.info(
            "Loaded plugin %s with %d tools: %s",
            path.name,
            len(registered_names),
            registered_names,
        )

        return registered_names

    def _load_module(self, path: Path) -> Any:
        """Dynamically load a Python module from a file path."""
        module_name = f"plugin_{path.stem}"

        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise PluginError(f"Cannot create module spec for: {path}")

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        return module

    def _instantiate_tool(self, tool_class: type) -> BaseTool:
        """Instantiate a tool class, validating it's a proper BaseTool."""
        if not isinstance(tool_class, type):
            raise PluginError(f"TOOLS must contain classes, got: {type(tool_class)}")

        if not issubclass(tool_class, BaseTool):
            raise PluginError(
                f"Tool class must inherit from BaseTool: {tool_class}"
            )

        # Try to instantiate
        try:
            return tool_class()
        except TypeError:
            # Tool might require arguments, try with security manager
            try:
                return tool_class(security_manager=self.security)
            except TypeError:
                raise PluginError(
                    f"Cannot instantiate tool class: {tool_class}"
                )

    def _register_tool(self, tool: BaseTool) -> None:
        """Register a tool with the registry and track it."""
        self.registry.register_tool(tool)
        self.connected_tools[tool.name] = tool

    def disconnect_plugin(self, plugin_path: str | Path) -> list[str]:
        """Unload a plugin and remove its tools.

        Args:
            plugin_path: Path to the plugin file.

        Returns:
            List of tool names that were removed.
        """
        path = str(Path(plugin_path).resolve())

        if path not in self._loaded_plugins:
            logger.warning("Plugin not loaded: %s", path)
            return []

        # Find and remove tools from this plugin
        removed_names: list[str] = []
        tools_to_remove = []

        for name, tool in self.connected_tools.items():
            # Check if tool came from this plugin
            tool_module = getattr(tool.__class__, "__module__", "")
            if f"plugin_{Path(path).stem}" in tool_module:
                tools_to_remove.append(name)

        for name in tools_to_remove:
            del self.connected_tools[name]
            removed_names.append(name)
            logger.debug("Removed tool: %s", name)

        # Remove plugin
        del self._loaded_plugins[path]

        self.security.audit_log(
            "plugin_unloaded",
            {
                "path": path,
                "tools_removed": removed_names,
            },
        )

        logger.info("Unloaded plugin: %s", path)
        return removed_names

    def load_plugins_from_directory(
        self, directory: str | Path, fail_fast: bool = False
    ) -> dict[str, list[str]]:
        """Load all plugin files from a directory.

        Args:
            directory: Directory containing plugin files.
            fail_fast: If True, stop on first error. If False, continue loading
                      other plugins and collect all errors.

        Returns:
            Dict mapping plugin paths to lists of registered tool names.

        Raises:
            PluginError: If any plugins failed to load (with details about all failures).
        """
        dir_path = Path(directory)

        if not dir_path.is_dir():
            raise PluginError(f"Not a directory: {directory}")

        results: dict[str, list[str]] = {}
        all_errors: list[tuple[str, str]] = []

        for plugin_file in dir_path.glob("*.py"):
            # Skip files starting with underscore
            if plugin_file.name.startswith("_"):
                continue

            try:
                tools = self.connect_plugin(plugin_file)
                results[str(plugin_file)] = tools
            except PluginError as e:
                error_msg = f"{type(e).__name__}: {e}"
                all_errors.append((str(plugin_file), error_msg))
                logger.error("Failed to load plugin %s: %s", plugin_file, e)
                results[str(plugin_file)] = []

                if fail_fast:
                    break

        # If there were any errors and fail_fast is False, raise a summary
        if all_errors and not fail_fast:
            raise PluginError(
                f"Failed to load {len(all_errors)} plugin(s) from {directory}",
                all_errors,
            )

        return results

    def get_connected_tools(self) -> list[str]:
        """Get names of all connected external tools."""
        return list(self.connected_tools.keys())

    def get_loaded_plugins(self) -> list[str]:
        """Get paths of all loaded plugins."""
        return list(self._loaded_plugins.keys())
