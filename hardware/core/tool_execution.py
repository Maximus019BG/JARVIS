"""Tool-call parsing and execution helpers.

This module exists to keep `ChatHandler` focused on coordination.
Behavior is intentionally kept compatible with prior `ChatHandler.execute_tool_call`.

Enhancements (behavior-compatible):
- Internal structured result object for logging/metrics.
- Optional argument validation against a tool's JSON schema.
- Optional execution timeouts.

Public surface remains unchanged:
- [`ToolCallExecutor.execute_tool_call()`](hardware/core/tool_execution.py:1) still returns a string.
"""

from __future__ import annotations

import dataclasses
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any, Callable

from app_logging.logger import get_logger
from core.base_tool import ToolError
from core.tool_registry import ToolNotFoundError, ToolRegistry

logger = get_logger(__name__)


@dataclasses.dataclass(frozen=True, slots=True)
class _ToolExecutionResult:
    ok: bool
    tool: str
    call_id: str | None
    content: str
    error_type: str | None = None
    error_details: dict[str, Any] | None = None
    duration_ms: int | None = None


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip().lower()
    return raw in {"1", "true", "yes", "y", "on"}


def _env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    raw = raw.strip()
    if raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _json_loads_maybe_orjson(raw_args: str) -> Any:
    """Parse JSON using orjson if available, otherwise stdlib json."""

    try:
        import orjson  # type: ignore

        return orjson.loads(raw_args) if raw_args else {}
    except ImportError:
        return json.loads(raw_args) if raw_args else {}


def _get_tool_schema(tool: Any) -> dict[str, Any] | None:
    """Best-effort retrieval of a JSON schema for tool parameters.

    Supports common conventions in this repo:
    - tool.schema_parameters() -> dict

    Returns None when schema is absent or malformed.
    """

    schema: Any = None
    if hasattr(tool, "schema_parameters") and callable(getattr(tool, "schema_parameters")):
        try:
            schema = tool.schema_parameters()
        except Exception:
            return None

    if isinstance(schema, dict):
        return schema
    return None


def _is_instance_of_json_type(value: Any, schema_type: str) -> bool:
    if schema_type == "string":
        return isinstance(value, str)
    if schema_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if schema_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if schema_type == "boolean":
        return isinstance(value, bool)
    if schema_type == "array":
        return isinstance(value, list)
    if schema_type == "object":
        return isinstance(value, dict)
    if schema_type == "null":
        return value is None
    return True  # Unknown type keyword => don't fail.


def _validate_args_against_schema(args: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    """Lightweight schema validation.

    Intentionally partial: only enforces common constructs used by our tool schemas.
    If schema is unsupported, validation becomes a no-op.
    """

    if not isinstance(schema, dict):
        return []

    if schema.get("type") not in (None, "object"):
        # Unexpected top-level schema, skip.
        return []

    properties = schema.get("properties")
    required = schema.get("required")
    additional = schema.get("additionalProperties")

    if properties is not None and not isinstance(properties, dict):
        return []
    if required is not None and not isinstance(required, list):
        return []

    errors: list[str] = []

    if isinstance(required, list):
        for key in required:
            if isinstance(key, str) and key not in args:
                errors.append(f"missing required field '{key}'")

    if additional is False and isinstance(properties, dict):
        allowed = set(properties.keys())
        for key in args.keys():
            if key not in allowed:
                errors.append(f"unexpected field '{key}'")

    if isinstance(properties, dict):
        for key, value in args.items():
            prop = properties.get(key)
            if not isinstance(prop, dict):
                continue

            if "enum" in prop and isinstance(prop["enum"], list):
                if value not in prop["enum"]:
                    errors.append(f"field '{key}' must be one of {prop['enum']}")
                    continue

            schema_type = prop.get("type")
            if isinstance(schema_type, str):
                if not _is_instance_of_json_type(value, schema_type):
                    errors.append(f"field '{key}' must be of type {schema_type}")
                    continue

            if isinstance(schema_type, list):
                # Support union types like ["string", "null"]
                if not any(
                    isinstance(t, str) and _is_instance_of_json_type(value, t)
                    for t in schema_type
                ):
                    errors.append(f"field '{key}' must match one of types {schema_type}")
                    continue

            if prop.get("type") == "array" and isinstance(value, list):
                items = prop.get("items")
                if isinstance(items, dict) and isinstance(items.get("type"), str):
                    item_type = items["type"]
                    for idx, item in enumerate(value):
                        if not _is_instance_of_json_type(item, item_type):
                            errors.append(
                                f"field '{key}[{idx}]' must be of type {item_type}"
                            )
                            break

    return errors


def _timeout_seconds_for_tool(tool: Any, default: float | None) -> float | None:
    """Return timeout seconds for a tool (optional)."""

    if hasattr(tool, "get_timeout_seconds") and callable(getattr(tool, "get_timeout_seconds")):
        try:
            v = tool.get_timeout_seconds()
            if isinstance(v, (int, float)):
                return float(v)
        except Exception:
            pass

    v = getattr(tool, "timeout_seconds", None)
    if isinstance(v, (int, float)):
        return float(v)

    return default


def _run_with_timeout(fn: Callable[[], Any], timeout_seconds: float) -> Any:
    """Run a callable with a timeout using a worker thread.

    Note: The worker thread cannot be force-killed safely. We use a context-managed
    executor to avoid leaking threads when the call completes.
    """

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="tool_exec") as ex:
        future = ex.submit(fn)
        return future.result(timeout=timeout_seconds)


class ToolCallExecutor:
    """Executes a single tool call payload returned by the LLM."""

    def __init__(self, registry: ToolRegistry, logger_override=None) -> None:
        self._registry = registry
        self._logger = logger_override or logger

        # Feature flags (default to safe/off for backwards compatibility)
        self._arg_validation_enabled = _env_bool("TOOL_ARG_VALIDATION_ENABLED", False)

        # Default: disabled (None). Set positive seconds to enable.
        default_timeout = _env_float("TOOL_EXECUTION_TIMEOUT_SECONDS_DEFAULT")
        self._default_timeout_seconds = (
            float(default_timeout) if default_timeout and default_timeout > 0 else None
        )

    def execute_tool_call(self, tool_call: dict[str, Any]) -> str:
        """Execute a tool call from the LLM.

        Args:
            tool_call: Tool call payload, e.g. {"function": {"name": str, "arguments": str}}.

        Returns:
            Tool result string or a behavior-compatible error string.
        """

        started = time.time()
        function_name: str | None = None
        call_id: str | None = None

        def finalize(result: _ToolExecutionResult) -> str:
            # Logging only; do not change return strings.
            try:
                self._logger.debug(
                    "Tool call result: %s",
                    {
                        "ok": result.ok,
                        "tool": result.tool,
                        "call_id": result.call_id,
                        "error_type": result.error_type,
                        "duration_ms": result.duration_ms,
                    },
                )
            except Exception:
                # Never allow logging failures to affect behavior.
                pass
            return result.content

        try:
            fn = tool_call.get("function") or {}
            function_name = fn.get("name")
            call_id = tool_call.get("id")
            if not function_name:
                duration_ms = int((time.time() - started) * 1000)
                return finalize(
                    _ToolExecutionResult(
                        ok=False,
                        tool="",
                        call_id=call_id,
                        content="Error executing tool: missing function name",
                        error_type="MissingFunctionName",
                        duration_ms=duration_ms,
                    )
                )

            raw_args = fn.get("arguments", "{}")
            try:
                arguments = _json_loads_maybe_orjson(raw_args) if raw_args else {}
            except (json.JSONDecodeError, Exception):
                duration_ms = int((time.time() - started) * 1000)
                return finalize(
                    _ToolExecutionResult(
                        ok=False,
                        tool=function_name,
                        call_id=call_id,
                        content=f"Error executing tool {function_name}: invalid JSON arguments",
                        error_type="InvalidJSONArguments",
                        duration_ms=duration_ms,
                    )
                )

            if not isinstance(arguments, dict):
                duration_ms = int((time.time() - started) * 1000)
                return finalize(
                    _ToolExecutionResult(
                        ok=False,
                        tool=function_name,
                        call_id=call_id,
                        content=f"Error executing tool {function_name}: arguments must be an object",
                        error_type="ArgumentsNotObject",
                        duration_ms=duration_ms,
                    )
                )

            tool = self._registry.get_tool(function_name)

            # Optional schema validation (default off)
            if self._arg_validation_enabled:
                schema = _get_tool_schema(tool)
                if schema is not None:
                    validation_errors = _validate_args_against_schema(arguments, schema)
                    if validation_errors:
                        duration_ms = int((time.time() - started) * 1000)
                        msg = "; ".join(validation_errors)
                        return finalize(
                            _ToolExecutionResult(
                                ok=False,
                                tool=function_name,
                                call_id=call_id,
                                content=(
                                    f"Error executing tool {function_name}: validation failed: {msg}"
                                ),
                                error_type="ValidationError",
                                error_details={"errors": validation_errors},
                                duration_ms=duration_ms,
                            )
                        )

            timeout_seconds = _timeout_seconds_for_tool(tool, self._default_timeout_seconds)

            def invoke() -> Any:
                # Keep baseline calling convention: execute(**kwargs)
                return tool.execute(**arguments)

            if timeout_seconds is not None:
                try:
                    result = _run_with_timeout(invoke, timeout_seconds)
                except FutureTimeoutError:
                    duration_ms = int((time.time() - started) * 1000)
                    return finalize(
                        _ToolExecutionResult(
                            ok=False,
                            tool=function_name,
                            call_id=call_id,
                            content=(
                                f"Error executing tool {function_name}: timed out after {timeout_seconds}s"
                            ),
                            error_type="Timeout",
                            error_details={"timeout_seconds": timeout_seconds},
                            duration_ms=duration_ms,
                        )
                    )
            else:
                result = invoke()

            # Preserve existing behavior: tool returns a string.
            duration_ms = int((time.time() - started) * 1000)
            return finalize(
                _ToolExecutionResult(
                    ok=True,
                    tool=function_name,
                    call_id=call_id,
                    content=str(result),
                    duration_ms=duration_ms,
                )
            )

        except ToolNotFoundError:
            duration_ms = int((time.time() - started) * 1000)
            return finalize(
                _ToolExecutionResult(
                    ok=False,
                    tool=function_name or "",
                    call_id=call_id,
                    content=f"Error executing tool {function_name}: unknown tool",
                    error_type="ToolNotFound",
                    duration_ms=duration_ms,
                )
            )
        except ToolError as exc:
            duration_ms = int((time.time() - started) * 1000)
            return finalize(
                _ToolExecutionResult(
                    ok=False,
                    tool=function_name or "",
                    call_id=call_id,
                    content=f"Error executing tool {function_name}: {exc}",
                    error_type="ToolError",
                    error_details={"message": str(exc)},
                    duration_ms=duration_ms,
                )
            )
        except TypeError as exc:
            # Most common failure: unexpected kwargs.
            duration_ms = int((time.time() - started) * 1000)
            return finalize(
                _ToolExecutionResult(
                    ok=False,
                    tool=function_name or "",
                    call_id=call_id,
                    content=f"Error executing tool {function_name}: {exc}",
                    error_type="TypeError",
                    error_details={"message": str(exc)},
                    duration_ms=duration_ms,
                )
            )
        except Exception as exc:
            self._logger.exception("Unexpected tool execution error")
            duration_ms = int((time.time() - started) * 1000)
            return finalize(
                _ToolExecutionResult(
                    ok=False,
                    tool=function_name or "",
                    call_id=call_id,
                    content=f"Error executing tool {function_name}: {exc}",
                    error_type="Exception",
                    error_details={"message": str(exc)},
                    duration_ms=duration_ms,
                )
            )
