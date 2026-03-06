"""Tests for ChatHandler."""

import asyncio
from unittest.mock import Mock

import pytest

from core.base_tool import ToolResult
from core.chat_handler import ChatHandler
from core.tool_registry import ToolRegistry
from tests.mock_llm import MockGemmaWrapper


class TestChatHandler:
    """Test cases for ChatHandler."""

    def test_tool_schema_cache_reused_when_registry_version_unchanged(
        self, chat_handler
    ):
        first = chat_handler._get_cached_tool_schemas()
        second = chat_handler._get_cached_tool_schemas()
        assert first is second

    def test_tool_schema_cache_invalidates_when_registry_version_changes(
        self, tool_registry, mock_llm
    ):
        handler = ChatHandler(tool_registry, llm=mock_llm)

        first = handler._get_cached_tool_schemas()

        # Mutate registry -> version bump
        new_tool = Mock()
        new_tool.name = "another_tool"
        new_tool.description = "Another tool"
        new_tool.execute.return_value = ToolResult.ok_result("ok")
        new_tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "another_tool",
                "description": "Another tool",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
        tool_registry.register_tool(new_tool)

        second = handler._get_cached_tool_schemas()

        assert second is not first
        assert any(schema["function"]["name"] == "another_tool" for schema in second)

    @pytest.fixture
    def mock_llm(self):
        """Mock LLM wrapper."""
        return MockGemmaWrapper()

    @pytest.fixture
    def tool_registry(self):
        """Tool registry with mock tools."""
        registry = ToolRegistry()

        # Add a mock tool
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "Test tool"
        mock_tool.execute.return_value = ToolResult.ok_result("Tool executed")
        mock_tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "test_tool",
                "description": "Test tool",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
        registry.register_tool(mock_tool)

        return registry

    @pytest.fixture
    def chat_handler(self, tool_registry, mock_llm):
        """Chat handler instance."""
        handler = ChatHandler(tool_registry, llm=mock_llm)
        return handler

    def test_process_message_no_tools(self, chat_handler):
        """Test processing message without tool calls."""
        response = asyncio.run(chat_handler.process_message("Hello"))
        assert response == "Mock response"
        assert len(chat_handler.memory.get_history()) == 2  # user + assistant

    def test_process_message_with_tools(self, chat_handler):
        """Test processing message with tool calls."""
        response = asyncio.run(chat_handler.process_message("Please help"))
        assert "Tool result processed" in response

    def test_execute_tool_call_success(self, chat_handler, tool_registry):
        """Test successful tool execution."""
        tool_call = {
            "id": "call_1",
            "function": {"name": "test_tool", "arguments": "{}"},
        }
        result = chat_handler.execute_tool_call(tool_call)
        assert result.ok is True
        assert result.content == "Tool executed"

    def test_execute_tool_call_error(self, chat_handler):
        """Test tool execution with error."""
        tool_call = {
            "id": "call_1",
            "function": {"name": "nonexistent_tool", "arguments": "{}"},
        }
        result = chat_handler.execute_tool_call(tool_call)
        assert result.ok is False
        assert "Error executing tool" in result.content
        assert result.error_type == "ToolNotFound"


# ---------------------------------------------------------------------------
# _message_needs_tools static heuristic
# ---------------------------------------------------------------------------

class TestMessageNeedsTools:
    """Tests for ChatHandler._message_needs_tools regex heuristic."""

    @pytest.mark.parametrize(
        "msg",
        [
            "read the file",
            "write a blueprint",
            "save this data",
            "create a new project",
            "run a shell command",
            "search for articles",
            "remember this fact",
            "recall the previous context",
            "send the update",
            "fetch the web page",
            "summarize the document",
            "execute the script",
            "sync my blueprints",
            "load the config",
            "resolve the conflict",
        ],
    )
    def test_needs_tools_true(self, msg: str) -> None:
        assert ChatHandler._message_needs_tools(msg) is True

    @pytest.mark.parametrize(
        "msg",
        [
            "what is python",
            "tell me a joke",
            "how are you today",
            "hi",
            "explain monads",
        ],
    )
    def test_needs_tools_false(self, msg: str) -> None:
        assert ChatHandler._message_needs_tools(msg) is False


# ---------------------------------------------------------------------------
# _clear_context
# ---------------------------------------------------------------------------

class TestClearContext:
    def test_clear_resets_memory(self) -> None:
        registry = ToolRegistry()
        handler = ChatHandler(registry, llm=MockGemmaWrapper())
        handler.memory.add_message("user", "hello")
        handler.memory.add_message("assistant", "hi")
        handler._clear_context()
        assert handler.memory.get_history() == []


# ---------------------------------------------------------------------------
# Additional ChatHandler coverage
# ---------------------------------------------------------------------------

class TestChatHandlerExtra:
    @pytest.fixture()
    def handler(self):
        registry = ToolRegistry()
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "Test tool"
        mock_tool.execute.return_value = ToolResult.ok_result("done")
        mock_tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "test_tool",
                "description": "Test tool",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }
        registry.register_tool(mock_tool)
        return ChatHandler(registry, llm=MockGemmaWrapper())

    def test_llm_lazy_load(self, handler):
        """llm property returns the mock we gave it."""
        assert handler.llm is not None

    def test_tts_property_none_when_disabled(self, handler):
        handler._enable_tts = False
        assert handler.tts is None

    def test_get_cached_tool_schemas_fresh(self, handler):
        schemas = handler._get_cached_tool_schemas()
        assert isinstance(schemas, list)
        assert len(schemas) >= 1

    def test_process_message_error_handling(self, handler):
        """process_message catches exceptions and returns error string."""
        from unittest.mock import AsyncMock
        handler._llm = Mock()
        handler._llm.chat_with_tools = AsyncMock(side_effect=RuntimeError("boom"))
        result = asyncio.run(handler.process_message("run test"))
        assert "Error" in result

    def test_show_help_no_crash(self, handler, capsys):
        handler._show_help()
        out = capsys.readouterr().out
        assert "Commands" in out

    def test_show_status_no_orchestrator(self, handler, capsys):
        handler._orchestrator = None
        handler._show_status()
        out = capsys.readouterr().out
        assert "Status" in out

    def test_show_status_with_orchestrator(self, handler, capsys):
        orch = Mock()
        orch.get_registered_agents.return_value = ["coder", "planner"]
        handler._orchestrator = orch
        handler._show_status()
        out = capsys.readouterr().out
        assert "coder" in out

    def test_show_status_with_memory_manager(self, handler, capsys):
        mm = Mock()
        mm.get_stats.return_value = {
            "semantic": {"total_memories": 5},
            "episodic": {"total_episodes": 3},
            "conversation": {"message_count": 10},
        }
        handler._memory_manager = mm
        handler._show_status()
        out = capsys.readouterr().out
        assert "Memory" in out

    def test_show_reflection_no_memory(self, handler, capsys):
        handler._memory_manager = None
        handler._show_reflection()
        out = capsys.readouterr().out
        assert "not available" in out

    def test_show_reflection_with_memory(self, handler, capsys):
        mm = Mock()
        mm.reflect.return_value = "reflection text"
        mm.get_insights.return_value = ["insight1"]
        handler._memory_manager = mm
        handler._show_reflection()
        out = capsys.readouterr().out
        assert "reflection" in out

    def test_speak_sync_disabled(self, handler):
        handler._enable_tts = False
        handler._speak_sync("hello")  # no-op, no crash

    def test_clear_context_with_memory_manager(self, handler):
        mm = Mock()
        handler._memory_manager = mm
        handler.memory.add_message("user", "hi")
        handler._clear_context()
        mm.clear_working_memory.assert_called_once()

    def test_handle_quit_with_session(self, handler, capsys):
        mm = Mock()
        handler._memory_manager = mm
        handler._session_started = True
        handler._message_count = 5
        handler._enable_tts = False
        handler._handle_quit()
        mm.end_session.assert_called_once()
        out = capsys.readouterr().out
        assert "Goodbye" in out

    def test_handle_quit_no_session(self, handler, capsys):
        handler._memory_manager = None
        handler._session_started = False
        handler._enable_tts = False
        handler._handle_quit()
        out = capsys.readouterr().out
        assert "Goodbye" in out
