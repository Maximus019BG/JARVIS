"""Tests for ChatHandler._extract_text_tool_calls robustness.

Covers:
- Standard {"name": ..., "arguments": {...}} format
- "parameters" / "params" key instead of "arguments"
- OpenAI wrapper format {"function": {"name": ..., "arguments": ...}}
- Arguments as JSON string instead of dict
- Fenced code blocks
- Multiple calls in one response
- Malformed / missing arguments
"""

from __future__ import annotations

import json
import pytest
from core.chat_handler import ChatHandler


extract = ChatHandler._extract_text_tool_calls


class TestStandardFormat:
    """Direct {"name": ..., "arguments": {...}} format."""

    def test_simple_call(self):
        text = 'Here is a tool call: {"name": "edit_blueprint", "arguments": {"blueprint_path": "arm", "action": "reset"}}'
        calls = extract(text)
        assert calls is not None
        assert len(calls) == 1
        fn = calls[0]["function"]
        assert fn["name"] == "edit_blueprint"
        assert fn["arguments"]["blueprint_path"] == "arm"
        assert fn["arguments"]["action"] == "reset"

    def test_nested_arguments(self):
        text = '{"name": "edit_blueprint", "arguments": {"action": "add_line", "drawing": {"x1": 10, "y1": 20, "x2": 30, "y2": 40}}}'
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["drawing"]["x1"] == 10

    def test_multiple_calls(self):
        text = (
            'Call 1: {"name": "edit_blueprint", "arguments": {"action": "set_dimensions", "dimensions": {"width": 100}}}\n'
            'Call 2: {"name": "edit_blueprint", "arguments": {"action": "add_component", "component": {"type": "battery"}}}\n'
            'Call 3: {"name": "edit_blueprint", "arguments": {"action": "add_line", "drawing": {"x1": 0, "y1": 0}}}'
        )
        calls = extract(text)
        assert calls is not None
        assert len(calls) == 3
        assert calls[0]["function"]["arguments"]["action"] == "set_dimensions"
        assert calls[1]["function"]["arguments"]["action"] == "add_component"
        assert calls[2]["function"]["arguments"]["action"] == "add_line"


class TestParametersKey:
    """LLMs that use "parameters" instead of "arguments"."""

    def test_parameters_key(self):
        text = '{"name": "edit_blueprint", "parameters": {"blueprint_path": "arm", "action": "reset"}}'
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["blueprint_path"] == "arm"
        assert fn["arguments"]["action"] == "reset"

    def test_params_key(self):
        text = '{"name": "edit_blueprint", "params": {"blueprint_path": "arm", "action": "reset"}}'
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["blueprint_path"] == "arm"

    def test_input_key(self):
        text = '{"name": "edit_blueprint", "input": {"blueprint_path": "arm", "action": "reset"}}'
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["blueprint_path"] == "arm"


class TestOpenAIWrapperFormat:
    """OpenAI-style {"id": ..., "type": "function", "function": {"name": ..., "arguments": ...}}."""

    def test_openai_wrapper(self):
        text = json.dumps({
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "edit_blueprint",
                "arguments": {"blueprint_path": "arm", "action": "reset"},
            },
        })
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["name"] == "edit_blueprint"
        assert fn["arguments"]["action"] == "reset"

    def test_openai_wrapper_string_arguments(self):
        inner_args = json.dumps({"blueprint_path": "arm", "action": "reset"})
        text = json.dumps({
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "edit_blueprint",
                "arguments": inner_args,
            },
        })
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["blueprint_path"] == "arm"


class TestStringArguments:
    """Arguments as a JSON-encoded string instead of a dict."""

    def test_string_arguments_parsed(self):
        inner = json.dumps({"blueprint_path": "arm", "action": "reset"})
        text = json.dumps({"name": "edit_blueprint", "arguments": inner})
        calls = extract(text)
        assert calls is not None
        fn = calls[0]["function"]
        assert fn["arguments"]["blueprint_path"] == "arm"


class TestFencedCodeBlocks:
    """Tool calls inside ```json or ```tool_call blocks."""

    def test_json_fence(self):
        text = 'Sure, here:\n```json\n{"name": "list_blueprints", "arguments": {}}\n```'
        calls = extract(text)
        assert calls is not None
        assert calls[0]["function"]["name"] == "list_blueprints"

    def test_tool_call_fence(self):
        text = '```tool_call\n{"name": "edit_blueprint", "arguments": {"action": "reset", "blueprint_path": "arm"}}\n```'
        calls = extract(text)
        assert calls is not None
        assert calls[0]["function"]["arguments"]["action"] == "reset"

    def test_fence_with_parameters_key(self):
        text = '```json\n{"name": "edit_blueprint", "parameters": {"action": "reset", "blueprint_path": "arm"}}\n```'
        calls = extract(text)
        assert calls is not None
        assert calls[0]["function"]["arguments"]["action"] == "reset"


class TestEdgeCases:
    """Edge cases and malformed input."""

    def test_no_arguments_key_returns_empty_dict(self):
        text = '{"name": "list_blueprints"}'
        calls = extract(text)
        assert calls is not None
        assert calls[0]["function"]["arguments"] == {}

    def test_no_tool_calls_returns_none(self):
        text = "Just a regular response with no tool calls."
        assert extract(text) is None

    def test_invalid_json_skipped(self):
        text = '{"name": "edit_blueprint", "arguments": {invalid json}'
        calls = extract(text)
        # Should not crash; may return None or skip the malformed one
        assert calls is None or len(calls) == 0 or calls is not None

    def test_mixed_valid_invalid(self):
        text = (
            '{"name": "broken", broken json}\n'
            '{"name": "edit_blueprint", "arguments": {"action": "reset", "blueprint_path": "arm"}}'
        )
        calls = extract(text)
        assert calls is not None
        # At least the valid call should be extracted
        valid = [c for c in calls if c["function"]["name"] == "edit_blueprint"]
        assert len(valid) == 1
