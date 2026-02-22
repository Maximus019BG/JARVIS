"""Tests for tool_execution module — arg validation, timeouts, executor."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from core.base_tool import BaseTool, ToolError, ToolResult
from core.tool_execution import (
    ToolCallExecutor,
    _env_bool,
    _env_float,
    _is_instance_of_json_type,
    _json_loads_maybe_orjson,
    _run_with_timeout,
    _validate_args_against_schema,
    _get_tool_schema,
    _timeout_seconds_for_tool,
)
from core.tool_registry import ToolRegistry


# ── Helper fixtures ──────────────────────────────────────────────────


class DummyTool(BaseTool):
    """A minimal tool for testing."""

    @property
    def name(self) -> str:
        return "dummy"

    @property
    def description(self) -> str:
        return "A dummy tool"

    def execute(self, **kwargs) -> ToolResult:
        return ToolResult.ok_result(f"got {kwargs}")

    def schema_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "count": {"type": "integer"},
            },
            "required": ["text"],
        }


class SlowTool(BaseTool):
    @property
    def name(self) -> str:
        return "slow"

    @property
    def description(self) -> str:
        return "Slow tool"

    timeout_seconds = 0.01

    def execute(self, **kwargs) -> ToolResult:
        import time
        time.sleep(1)
        return ToolResult.ok_result("done")


class ErrorTool(BaseTool):
    @property
    def name(self) -> str:
        return "error_tool"

    @property
    def description(self) -> str:
        return "Raises ToolError"

    def execute(self, **kwargs) -> ToolResult:
        raise ToolError("intentional error")


class BadReturnTool(BaseTool):
    @property
    def name(self) -> str:
        return "bad_return"

    @property
    def description(self) -> str:
        return "Returns wrong type"

    def execute(self, **kwargs):
        return "not a ToolResult"


class TypeErrorTool(BaseTool):
    @property
    def name(self) -> str:
        return "type_err"

    @property
    def description(self) -> str:
        return "Raises TypeError"

    def execute(self, **kwargs) -> ToolResult:
        raise TypeError("bad args")


# ── Env helpers ──────────────────────────────────────────────────────


class TestEnvBool:
    def test_default(self) -> None:
        assert _env_bool("__TEST_MISSING__", True) is True
        assert _env_bool("__TEST_MISSING__", False) is False

    @patch.dict(os.environ, {"__TB": "1"})
    def test_truthy(self) -> None:
        assert _env_bool("__TB", False) is True

    @patch.dict(os.environ, {"__TB": "false"})
    def test_falsy(self) -> None:
        assert _env_bool("__TB", True) is False

    @patch.dict(os.environ, {"__TB": "yes"})
    def test_yes(self) -> None:
        assert _env_bool("__TB", False) is True


class TestEnvFloat:
    def test_missing(self) -> None:
        assert _env_float("__MISSING__") is None

    @patch.dict(os.environ, {"__TF": "3.14"})
    def test_valid(self) -> None:
        assert _env_float("__TF") == 3.14

    @patch.dict(os.environ, {"__TF": ""})
    def test_empty(self) -> None:
        assert _env_float("__TF") is None

    @patch.dict(os.environ, {"__TF": "not_a_number"})
    def test_invalid(self) -> None:
        assert _env_float("__TF") is None


# ── JSON loading ─────────────────────────────────────────────────────


class TestJsonLoadsMaybeOrjson:
    def test_valid_json(self) -> None:
        assert _json_loads_maybe_orjson('{"a": 1}') == {"a": 1}

    def test_empty_string(self) -> None:
        assert _json_loads_maybe_orjson("") == {}


# ── Schema helpers ───────────────────────────────────────────────────


class TestIsInstanceOfJsonType:
    def test_string(self) -> None:
        assert _is_instance_of_json_type("hello", "string")
        assert not _is_instance_of_json_type(42, "string")

    def test_number(self) -> None:
        assert _is_instance_of_json_type(3.14, "number")
        assert _is_instance_of_json_type(42, "number")
        assert not _is_instance_of_json_type(True, "number")

    def test_integer(self) -> None:
        assert _is_instance_of_json_type(42, "integer")
        assert not _is_instance_of_json_type(3.14, "integer")
        assert not _is_instance_of_json_type(True, "integer")

    def test_boolean(self) -> None:
        assert _is_instance_of_json_type(True, "boolean")
        assert not _is_instance_of_json_type(1, "boolean")

    def test_array(self) -> None:
        assert _is_instance_of_json_type([1, 2], "array")
        assert not _is_instance_of_json_type("not", "array")

    def test_object(self) -> None:
        assert _is_instance_of_json_type({}, "object")
        assert not _is_instance_of_json_type([], "object")

    def test_null(self) -> None:
        assert _is_instance_of_json_type(None, "null")

    def test_unknown(self) -> None:
        assert _is_instance_of_json_type("anything", "custom")


class TestValidateArgsAgainstSchema:
    def test_missing_required(self) -> None:
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        errors = _validate_args_against_schema({}, schema)
        assert any("name" in e for e in errors)

    def test_type_mismatch(self) -> None:
        schema = {
            "type": "object",
            "properties": {"age": {"type": "integer"}},
        }
        errors = _validate_args_against_schema({"age": "not_int"}, schema)
        assert len(errors) == 1

    def test_enum_violation(self) -> None:
        schema = {
            "type": "object",
            "properties": {"color": {"type": "string", "enum": ["red", "blue"]}},
        }
        errors = _validate_args_against_schema({"color": "green"}, schema)
        assert len(errors) == 1

    def test_additional_properties_false(self) -> None:
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "additionalProperties": False,
        }
        errors = _validate_args_against_schema({"name": "ok", "extra": 1}, schema)
        assert any("extra" in e for e in errors)

    def test_array_item_type(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "tags": {"type": "array", "items": {"type": "string"}},
            },
        }
        errors = _validate_args_against_schema({"tags": ["ok", 42]}, schema)
        assert len(errors) == 1

    def test_union_type(self) -> None:
        schema = {
            "type": "object",
            "properties": {"val": {"type": ["string", "null"]}},
        }
        assert _validate_args_against_schema({"val": None}, schema) == []
        assert _validate_args_against_schema({"val": "hello"}, schema) == []
        errors = _validate_args_against_schema({"val": 42}, schema)
        assert len(errors) == 1

    def test_non_object_schema(self) -> None:
        assert _validate_args_against_schema({}, {"type": "array"}) == []

    def test_non_dict_schema(self) -> None:
        assert _validate_args_against_schema({}, "not a dict") == []

    def test_valid_args(self) -> None:
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        assert _validate_args_against_schema({"name": "ok"}, schema) == []


class TestGetToolSchema:
    def test_with_schema(self) -> None:
        tool = DummyTool()
        schema = _get_tool_schema(tool)
        assert schema is not None
        assert schema["type"] == "object"

    def test_without_schema(self) -> None:
        obj = MagicMock(spec=[])  # no schema_parameters
        assert _get_tool_schema(obj) is None


class TestTimeoutSecondsForTool:
    def test_from_attribute(self) -> None:
        tool = SlowTool()
        assert _timeout_seconds_for_tool(tool, None) == 0.01

    def test_from_method(self) -> None:
        tool = MagicMock()
        tool.get_timeout_seconds.return_value = 5.0
        assert _timeout_seconds_for_tool(tool, None) == 5.0

    def test_default(self) -> None:
        tool = MagicMock(spec=[])
        assert _timeout_seconds_for_tool(tool, 10.0) == 10.0

    def test_none_default(self) -> None:
        tool = MagicMock(spec=[])
        assert _timeout_seconds_for_tool(tool, None) is None


class TestRunWithTimeout:
    def test_completes(self) -> None:
        result = _run_with_timeout(lambda: 42, 5.0)
        assert result == 42

    def test_timeout(self) -> None:
        import time
        from concurrent.futures import TimeoutError as FTE
        with pytest.raises(FTE):
            _run_with_timeout(lambda: time.sleep(10), 0.01)


# ── ToolCallExecutor ─────────────────────────────────────────────────


class TestToolCallExecutor:
    @pytest.fixture()
    def registry(self) -> ToolRegistry:
        reg = ToolRegistry()
        reg.register_tool(DummyTool())
        reg.register_tool(ErrorTool())
        reg.register_tool(BadReturnTool())
        reg.register_tool(TypeErrorTool())
        return reg

    @pytest.fixture()
    def executor(self, registry: ToolRegistry) -> ToolCallExecutor:
        return ToolCallExecutor(registry)

    def test_successful_call(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "id": "call_1",
            "function": {"name": "dummy", "arguments": '{"text": "hello"}'},
        })
        assert result.ok
        assert result.tool == "dummy"
        assert result.call_id == "call_1"

    def test_missing_function_name(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({"function": {}})
        assert not result.ok
        assert result.error_type == "MissingFunctionName"

    def test_invalid_json_args(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "dummy", "arguments": "not json"},
        })
        assert not result.ok
        assert result.error_type == "InvalidJSONArguments"

    def test_args_not_object(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "dummy", "arguments": '"just a string"'},
        })
        assert not result.ok
        assert result.error_type == "ArgumentsNotObject"

    def test_tool_not_found(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "nonexistent", "arguments": "{}"},
        })
        assert not result.ok
        assert result.error_type == "ToolNotFound"

    def test_tool_error(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "error_tool", "arguments": "{}"},
        })
        assert not result.ok
        assert result.error_type == "ToolError"

    def test_bad_return_type(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "bad_return", "arguments": "{}"},
        })
        assert not result.ok
        assert result.error_type == "InvalidToolReturnType"

    def test_type_error_from_tool(self, executor: ToolCallExecutor) -> None:
        result = executor.execute_tool_call({
            "function": {"name": "type_err", "arguments": "{}"},
        })
        assert not result.ok
        assert result.error_type == "TypeError"

    def test_timeout(self) -> None:
        reg = ToolRegistry()
        reg.register_tool(SlowTool())
        executor = ToolCallExecutor(reg)
        result = executor.execute_tool_call({
            "function": {"name": "slow", "arguments": "{}"},
        })
        assert not result.ok
        assert result.error_type == "Timeout"

    def test_fills_missing_metadata(self, executor: ToolCallExecutor) -> None:
        """ToolResult without tool/call_id gets them filled."""
        result = executor.execute_tool_call({
            "id": "cid",
            "function": {"name": "dummy", "arguments": '{"text": "x"}'},
        })
        assert result.tool == "dummy"
        assert result.call_id == "cid"
        assert result.duration_ms is not None

    @patch.dict(os.environ, {"TOOL_ARG_VALIDATION_ENABLED": "true"})
    def test_arg_validation_enabled(self) -> None:
        reg = ToolRegistry()
        reg.register_tool(DummyTool())
        executor = ToolCallExecutor(reg)
        # Missing required 'text'
        result = executor.execute_tool_call({
            "function": {"name": "dummy", "arguments": '{"count": 1}'},
        })
        assert not result.ok
        assert result.error_type == "ValidationError"
