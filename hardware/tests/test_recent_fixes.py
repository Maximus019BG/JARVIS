"""Tests for recent blueprint-engine fixes.

Covers the recent batch of changes:
- Parser metadata compatibility (SyncMetadata / SecurityMetadata aliases)
- Blueprint JSON extraction from agent text responses
- Groq tool_calls sanitisation in _build_messages / continue_conversation
- Chat handler stores tool results in conversation memory
- Orchestrator parallel group uses asyncio.gather (no as_completed bug)
- Blueprint widget rendering with components and connections
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from core.base_tool import ToolResult
from core.blueprint.parser import (
    Blueprint,
    BlueprintParser,
    BlueprintType,
    ComponentSpec,
    Connection,
    Dimension,
    SecurityMetadata,
    SyncMetadata,
)


# ── Parser Metadata Compatibility ────────────────────────────────────


class TestSyncMetadataAliases:
    """SyncMetadata should accept both alias (camelCase) and field name."""

    def test_from_alias_fields(self) -> None:
        """Parse SyncMetadata from CreateBlueprintTool output (camelCase)."""
        data = {
            "status": "local_only",
            "lastSyncedAt": "2026-02-22T10:00:00",
            "serverVersion": 3,
            "conflictState": None,
            "workstationId": "ws-001",
            "deviceId": "dev-42",
        }
        meta = SyncMetadata.model_validate(data)
        assert meta.last_sync == "2026-02-22T10:00:00"
        assert meta.sync_version == 3
        assert meta.device_id == "dev-42"

    def test_from_field_names(self) -> None:
        """Parse SyncMetadata using Python field names."""
        meta = SyncMetadata(
            synced=True,
            last_sync="2026-01-01",
            sync_version=1,
            device_id="rpi5",
        )
        assert meta.synced is True
        assert meta.last_sync == "2026-01-01"
        assert meta.sync_version == 1
        assert meta.device_id == "rpi5"

    def test_extra_fields_allowed(self) -> None:
        """Extra fields should not raise (e.g. 'status' from the tool)."""
        data = {
            "status": "local_only",
            "workstationId": None,
            "some_unknown_field": 42,
        }
        meta = SyncMetadata.model_validate(data)
        assert meta.synced is False  # default


class TestSecurityMetadataAliases:
    """SecurityMetadata should accept both alias and field name."""

    def test_from_alias_fields(self) -> None:
        """Parse SecurityMetadata from CreateBlueprintTool output."""
        data = {
            "classification": "internal",
            "accessLevel": "read_write",
            "allowedDevices": [],
            "signatureRequired": True,
            "signature": None,
            "encryptionAlgorithm": "AES-256",
        }
        meta = SecurityMetadata.model_validate(data)
        assert meta.encryption_algorithm == "AES-256"

    def test_from_field_names(self) -> None:
        """Parse using Python field names."""
        meta = SecurityMetadata(encryption_algorithm="RSA")
        assert meta.encryption_algorithm == "RSA"

    def test_extra_fields_allowed(self) -> None:
        """Extra fields (e.g. signedBy) should not raise."""
        data = {
            "signedBy": "admin",
            "signedAt": "2026-02-22",
            "integrityVerified": True,
        }
        meta = SecurityMetadata.model_validate(data)
        assert meta.signature is None  # default


class TestBlueprintExtraAllowed:
    """Blueprint model should allow extra fields from the tool output."""

    def test_full_create_blueprint_tool_output(self) -> None:
        """Parse the exact JSON written by CreateBlueprintTool."""
        data = {
            "jarvis_version": "1.0",
            "id": "bp_test_abc123",
            "type": "part",
            "name": "Test Widget",
            "description": "A test",
            "created": "2026-02-22T00:00:00Z",
            "author": "JARVIS Blueprint Agent",
            "version": 1,
            "hash": "abc123",
            "sync": {
                "status": "local_only",
                "lastSyncedAt": None,
                "serverVersion": None,
                "conflictState": None,
                "workstationId": None,
                "deviceId": None,
            },
            "security": {
                "classification": "internal",
                "accessLevel": "read_write",
                "allowedDevices": [],
                "signatureRequired": True,
                "signature": None,
                "encryptionAlgorithm": None,
            },
            "dimensions": {"length": 10, "width": 20, "height": 5, "unit": "mm"},
            "materials": [],
            "components": [
                {
                    "id": "part_001",
                    "name": "Motor Mount",
                    "type": "structural",
                    "position": {"x": 0, "y": 0, "z": 0},
                }
            ],
            "connections": [],
            "specifications": {},
            "manufacturing": {},
            "assembly_instructions": [],
            "notes": [],
            "tags": [],
            "revisions": [
                {"version": "1.0", "date": "2026-02-22", "changes": "Initial"}
            ],
        }
        bp = Blueprint.model_validate(data)
        assert bp.name == "Test Widget"
        assert bp.type == BlueprintType.PART
        assert len(bp.components) == 1
        assert bp.components[0].id == "part_001"
        assert bp.components[0].position == (0.0, 0.0, 0.0)

    def test_roundtrip_file_io(self, tmp_path: Path) -> None:
        """Write & reload a .jarvis file with extra fields."""
        data = {
            "jarvis_version": "1.0",
            "id": "bp_roundtrip",
            "type": "assembly",
            "name": "Roundtrip Test",
            "description": "",
            "author": "test",
            "components": [],
            "connections": [],
            "dimensions": {"length": 0, "width": 0, "height": 0, "unit": "mm"},
            "sync": {"status": "local_only", "lastSyncedAt": None},
            "security": {"classification": "internal"},
        }
        path = tmp_path / "roundtrip.jarvis"
        path.write_text(json.dumps(data, indent=2))

        parser = BlueprintParser()
        bp = parser.load(path)
        assert bp.name == "Roundtrip Test"
        assert bp.type == BlueprintType.ASSEMBLY

        # Save back and verify
        parser.save(bp, path)
        reloaded = json.loads(path.read_text())
        assert reloaded["name"] == "Roundtrip Test"


# ── Blueprint JSON Extraction ────────────────────────────────────────


class TestExtractBlueprintJson:
    """Tests for JarvisTUI._extract_blueprint_json (static method)."""

    @staticmethod
    def _extract(text: str) -> dict[str, Any] | None:
        """Helper that calls the static method directly."""
        from core.tui.app import JarvisTUI
        return JarvisTUI._extract_blueprint_json(text)

    def test_fenced_json_block(self) -> None:
        """Extract from a ```json ... ``` fenced block."""
        text = 'Here is your blueprint:\n```json\n{"name": "Motor", "type": "part"}\n```\nDone!'
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "Motor"

    def test_bare_fenced_block(self) -> None:
        """Extract from a ``` ... ``` block without json annotation."""
        text = 'Blueprint:\n```\n{"name": "Arm", "components": []}\n```'
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "Arm"

    def test_bare_json_in_text(self) -> None:
        """Extract bare JSON object from text."""
        text = 'Sure, here is the blueprint: {"name": "Leg", "type": "part"} and that is it.'
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "Leg"

    def test_no_json(self) -> None:
        """Return None when there is no JSON."""
        assert self._extract("Just a normal message.") is None

    def test_json_without_name(self) -> None:
        """Return None for JSON that doesn't have 'name' key."""
        text = '{"temperature": 42, "unit": "C"}'
        assert self._extract(text) is None

    def test_nested_json_objects(self) -> None:
        """Extract the first valid object with 'name'."""
        text = 'Data: {"x": 1} then {"name": "Widget", "type": "part"}'
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "Widget"

    def test_multiline_fenced_block(self) -> None:
        """Extract a multi-line JSON block."""
        bp_json = json.dumps(
            {
                "name": "MultiLine",
                "type": "assembly",
                "components": [
                    {"id": "a", "name": "Part A"},
                    {"id": "b", "name": "Part B"},
                ],
            },
            indent=2,
        )
        text = f"Here is your design:\n```json\n{bp_json}\n```"
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "MultiLine"
        assert len(result["components"]) == 2

    def test_invalid_json_in_fence_skipped(self) -> None:
        """Invalid JSON in a fenced block should be skipped."""
        text = '```json\n{not valid json}\n```\nThen: {"name": "Fallback"}'
        result = self._extract(text)
        assert result is not None
        assert result["name"] == "Fallback"


# ── Groq tool_calls Sanitisation ─────────────────────────────────────


class TestGroqBuildMessagesSanitisation:
    """Tests for GroqWrapper._build_messages sanitising tool_calls."""

    @staticmethod
    def _build(history: list[dict[str, Any]], user_msg: str) -> list[dict[str, Any]]:
        from core.llm.groq_wrapper import GroqWrapper
        return GroqWrapper._build_messages(history, user_msg)

    def test_adds_type_to_tool_calls(self) -> None:
        """tool_calls missing 'type' should get 'function' added."""
        history = [
            {"role": "user", "content": "hello"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "call_1", "function": {"name": "test", "arguments": "{}"}},
                ],
            },
        ]
        messages = self._build(history, "next message")

        assistant_msg = messages[1]
        tc = assistant_msg["tool_calls"][0]
        assert tc["type"] == "function"
        assert tc["id"] == "call_1"

    def test_preserves_existing_type(self) -> None:
        """tool_calls that already have 'type' should keep it."""
        history = [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_2",
                        "type": "function",
                        "function": {"name": "test", "arguments": "{}"},
                    }
                ],
            },
        ]
        messages = self._build(history, "hi")
        tc = messages[0]["tool_calls"][0]
        assert tc["type"] == "function"

    def test_adds_id_when_missing(self) -> None:
        """tool_calls missing 'id' should get a generated one."""
        history = [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"function": {"name": "test", "arguments": "{}"}},
                ],
            },
        ]
        messages = self._build(history, "hi")
        tc = messages[0]["tool_calls"][0]
        assert "id" in tc
        assert tc["type"] == "function"

    def test_does_not_mutate_original(self) -> None:
        """Original history should not be mutated."""
        original_tc = {"function": {"name": "test", "arguments": "{}"}}
        history = [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [original_tc],
            },
        ]
        self._build(history, "hi")
        # The original should NOT have been modified
        assert "type" not in original_tc

    def test_messages_without_tool_calls_pass_through(self) -> None:
        """Messages without tool_calls should be unmodified."""
        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "world"},
        ]
        messages = self._build(history, "next")
        assert len(messages) == 3
        assert messages[0] == {"role": "user", "content": "hello"}
        assert messages[1] == {"role": "assistant", "content": "world"}
        assert messages[2] == {"role": "user", "content": "next"}

    def test_empty_history(self) -> None:
        """Empty or None history should return just the user message."""
        messages = self._build(None, "hi")
        assert len(messages) == 1
        assert messages[0] == {"role": "user", "content": "hi"}

        messages = self._build([], "hi")
        assert len(messages) == 1


# ── Chat Handler: tool results stored in memory ─────────────────────


class TestChatHandlerToolResultsInMemory:
    """Verify that tool results are saved to conversation memory."""

    @pytest.fixture()
    def mock_tool(self) -> Mock:
        """A mock tool for the registry."""
        tool = Mock()
        tool.name = "test_tool"
        tool.description = "A test tool"
        tool.execute.return_value = ToolResult.ok_result("tool output")
        tool.get_schema.return_value = {
            "type": "function",
            "function": {
                "name": "test_tool",
                "description": "A test tool",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        return tool

    @pytest.fixture()
    def mock_llm(self) -> MagicMock:
        """A mock LLM that returns a tool call then a final response."""
        llm = MagicMock()
        # First call: return a tool call
        llm.chat_with_tools = AsyncMock(
            return_value={
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_abc",
                            "type": "function",
                            "function": {
                                "name": "test_tool",
                                "arguments": "{}",
                            },
                        }
                    ],
                }
            }
        )
        # Second call: return the final response
        llm.continue_conversation = AsyncMock(return_value="Final answer")
        return llm

    @pytest.fixture()
    def handler(self, mock_tool: Mock, mock_llm: MagicMock) -> Any:
        """ChatHandler wired with mocks."""
        from core.tool_registry import ToolRegistry
        from core.chat_handler import ChatHandler

        registry = ToolRegistry()
        registry.register_tool(mock_tool)
        return ChatHandler(tool_registry=registry, llm=mock_llm)

    def test_tool_results_stored_in_memory(
        self, handler: Any, mock_llm: MagicMock
    ) -> None:
        """After tool execution, memory should contain tool-role messages."""
        response = asyncio.run(handler.process_message("run test_tool"))

        history = handler.memory.get_history()
        # Should contain: user, assistant (with tool_calls), tool, assistant
        roles = [m["role"] for m in history]
        assert "tool" in roles, f"Expected 'tool' in roles, got: {roles}"

        tool_msg = [m for m in history if m["role"] == "tool"][0]
        assert "tool_call_id" in tool_msg
        assert tool_msg["tool_call_id"] == "call_abc"
        assert "tool output" in tool_msg["content"]

    def test_final_response_returned(
        self, handler: Any, mock_llm: MagicMock
    ) -> None:
        """The final LLM response should be returned."""
        response = asyncio.run(handler.process_message("run test_tool"))
        assert response == "Final answer"


# ── Orchestrator: asyncio.gather parallel group ──────────────────────


class TestOrchestratorParallelGroup:
    """Verify _execute_parallel_group uses asyncio.gather correctly."""

    def test_parallel_group_returns_all_results(self) -> None:
        """All subtasks should have results after execution."""
        from core.agents.base_agent import AgentResponse, AgentRole

        # Create a minimal orchestrator
        from core.agents.orchestrator_agent import (
            OrchestratorAgent,
            Subtask,
            SubtaskStatus,
        )

        orchestrator = OrchestratorAgent.__new__(OrchestratorAgent)
        orchestrator._registered_agents = {}
        orchestrator._execution_semaphore = asyncio.Semaphore(5)
        orchestrator._llm = None

        # Mock _execute_subtask to return canned responses
        async def mock_execute(subtask, context, results):
            return AgentResponse(
                content=f"Result for {subtask.id}",
                agent_role=subtask.agent_role,
                success=True,
            )

        orchestrator._execute_subtask = mock_execute

        subtask_map = {
            "task_a": Subtask(
                id="task_a",
                description="Task A",
                agent_role=AgentRole.CODER,
                dependencies=[],
            ),
            "task_b": Subtask(
                id="task_b",
                description="Task B",
                agent_role=AgentRole.PLANNER,
                dependencies=[],
            ),
        }

        results = asyncio.run(
            orchestrator._execute_parallel_group(
                ["task_a", "task_b"], subtask_map, {}, {}
            )
        )

        assert "task_a" in results
        assert "task_b" in results
        assert results["task_a"].content == "Result for task_a"
        assert results["task_b"].content == "Result for task_b"
        assert results["task_a"].success is True
        assert results["task_b"].success is True

    def test_parallel_group_handles_exceptions(self) -> None:
        """A failing subtask should produce an error response, not crash."""
        from core.agents.base_agent import AgentResponse, AgentRole
        from core.agents.orchestrator_agent import (
            OrchestratorAgent,
            Subtask,
            SubtaskStatus,
        )

        orchestrator = OrchestratorAgent.__new__(OrchestratorAgent)
        orchestrator._registered_agents = {}
        orchestrator._execution_semaphore = asyncio.Semaphore(5)
        orchestrator._llm = None

        async def mock_execute(subtask, context, results):
            if subtask.id == "fail_task":
                raise RuntimeError("kaboom")
            return AgentResponse(
                content="ok",
                agent_role=subtask.agent_role,
                success=True,
            )

        orchestrator._execute_subtask = mock_execute

        subtask_map = {
            "ok_task": Subtask(
                id="ok_task",
                description="OK",
                agent_role=AgentRole.CODER,
                dependencies=[],
            ),
            "fail_task": Subtask(
                id="fail_task",
                description="Fail",
                agent_role=AgentRole.PLANNER,
                dependencies=[],
            ),
        }

        results = asyncio.run(
            orchestrator._execute_parallel_group(
                ["ok_task", "fail_task"], subtask_map, {}, {}
            )
        )

        assert results["ok_task"].success is True
        assert results["fail_task"].success is False
        assert "kaboom" in results["fail_task"].content


# ── Blueprint Widget Rendering ───────────────────────────────────────


class TestBlueprintWidgetRendering:
    """Tests for the grid renderer and render data structures."""

    def test_empty_grid_renders(self) -> None:
        """An empty grid with no components should render without error."""
        from core.tui.blueprint_widget import _render_grid_with_components

        output = _render_grid_with_components(40, 15, [], [])
        assert isinstance(output, str)
        assert len(output.split("\n")) == 15

    def test_too_small_viewport_returns_empty(self) -> None:
        """Tiny viewport should return empty string."""
        from core.tui.blueprint_widget import _render_grid_with_components

        assert _render_grid_with_components(3, 1, [], []) == ""
        assert _render_grid_with_components(2, 5, [], []) == ""

    def test_component_name_rendered(self) -> None:
        """Component names should appear in the rendered output."""
        from core.tui.blueprint_widget import (
            _RenderComponent,
            _render_grid_with_components,
        )

        comps = [
            _RenderComponent(
                id="c1", name="Motor", comp_type="electrical",
                x=0, y=0, w=8, h=3, selected=False,
            ),
        ]
        output = _render_grid_with_components(60, 20, comps, [])
        assert "Motor" in output

    def test_selected_component_uses_selection_style(self) -> None:
        """Selected components should use the selection style markers."""
        from core.tui.blueprint_widget import (
            _RenderComponent,
            _render_grid_with_components,
            _C_SEL,
        )

        comps = [
            _RenderComponent(
                id="c1", name="Sel", comp_type="part",
                x=0, y=0, w=6, h=3, selected=True,
            ),
        ]
        output = _render_grid_with_components(40, 15, comps, [])
        # The selection style should appear in the markup
        assert _C_SEL in output

    def test_connection_rendered(self) -> None:
        """Connections between components should produce line characters."""
        from core.tui.blueprint_widget import (
            _RenderComponent,
            _RenderConnection,
            _render_grid_with_components,
            _C_CONN,
        )

        comps = [
            _RenderComponent(
                id="a", name="A", comp_type="part",
                x=-10, y=0, w=4, h=3, selected=False,
            ),
            _RenderComponent(
                id="b", name="B", comp_type="part",
                x=10, y=0, w=4, h=3, selected=False,
            ),
        ]
        conns = [_RenderConnection(-10, 0, 10, 0)]
        output = _render_grid_with_components(60, 15, comps, conns)
        # Connection style should appear
        assert _C_CONN in output

    def test_multiple_components_rendered(self) -> None:
        """Multiple components should all appear in the output."""
        from core.tui.blueprint_widget import (
            _RenderComponent,
            _render_grid_with_components,
        )

        comps = [
            _RenderComponent(
                id="base", name="Base", comp_type="structural",
                x=0, y=0, w=8, h=3, selected=False,
            ),
            _RenderComponent(
                id="arm", name="Arm", comp_type="mechanical",
                x=0, y=-8, w=5, h=3, selected=False,
            ),
        ]
        output = _render_grid_with_components(60, 25, comps, [])
        assert "Base" in output
        assert "Arm" in output

    def test_component_type_annotation(self) -> None:
        """Components with enough height should show type annotation."""
        from core.tui.blueprint_widget import (
            _RenderComponent,
            _render_grid_with_components,
        )

        comps = [
            _RenderComponent(
                id="x", name="Widget", comp_type="sensor",
                x=0, y=0, w=14, h=5, selected=False,
            ),
        ]
        output = _render_grid_with_components(60, 20, comps, [])
        # Type annotation appears as "(sensor)" when box height >= 4
        assert "sensor" in output

    def test_render_component_data_class(self) -> None:
        """_RenderComponent should carry all data correctly."""
        from core.tui.blueprint_widget import _RenderComponent

        rc = _RenderComponent(
            id="test", name="Test",
            comp_type="mech", x=1.5, y=2.5,
            w=10, h=5, selected=True,
        )
        assert rc.id == "test"
        assert rc.name == "Test"
        assert rc.comp_type == "mech"
        assert rc.x == 1.5
        assert rc.y == 2.5
        assert rc.w == 10
        assert rc.h == 5
        assert rc.selected is True

    def test_render_connection_data_class(self) -> None:
        """_RenderConnection should carry coordinates correctly."""
        from core.tui.blueprint_widget import _RenderConnection

        rc = _RenderConnection(1.0, 2.0, 3.0, 4.0)
        assert rc.from_x == 1.0
        assert rc.from_y == 2.0
        assert rc.to_x == 3.0
        assert rc.to_y == 4.0


# ── Gemma Wrapper: continue_conversation no double-append ────────────


class TestGemmaWrapperContinueConversation:
    """Verify GemmaWrapper.continue_conversation doesn't double-add tool results."""

    def test_does_not_append_tool_results(self) -> None:
        """Tool results should NOT be appended since caller already added them."""
        # We can't instantiate GemmaWrapper without ollama, so we inspect
        # the source code to verify the method body no longer appends.
        import inspect
        from core.llm.gemma_wrapper import GemmaWrapper

        source = inspect.getsource(GemmaWrapper.continue_conversation)
        # The old code had `conversation_history.append(` — ensure it's gone
        assert "conversation_history.append(" not in source


# ── Parser: position/rotation dict coercion ──────────────────────────


class TestComponentPositionCoercion:
    """Components with dict-style positions should be coerced to tuples."""

    def test_dict_position_coerced(self) -> None:
        """Position as {x, y, z} dict should become a tuple."""
        comp = ComponentSpec(
            id="c1",
            name="Test",
            position={"x": 10, "y": 20, "z": 30},  # type: ignore[arg-type]
        )
        assert comp.position == (10.0, 20.0, 30.0)

    def test_dict_rotation_coerced(self) -> None:
        """Rotation as {x, y, z} dict should become a tuple."""
        comp = ComponentSpec(
            id="c1",
            name="Test",
            rotation={"x": 45, "y": 90, "z": 0},  # type: ignore[arg-type]
        )
        assert comp.rotation == (45.0, 90.0, 0.0)

    def test_tuple_position_unchanged(self) -> None:
        """Position as tuple should pass through."""
        comp = ComponentSpec(id="c1", name="Test", position=(1, 2, 3))
        assert comp.position == (1, 2, 3)

    def test_list_position_coerced(self) -> None:
        """Position as list should be accepted too."""
        comp = ComponentSpec(
            id="c1",
            name="Test",
            position=[5, 6, 7],  # type: ignore[arg-type]
        )
        assert comp.position == (5, 6, 7)


# ── Connection alias round-trip ──────────────────────────────────────


class TestConnectionAlias:
    """Connection from/to aliases should round-trip through JSON."""

    def test_from_alias_parsing(self) -> None:
        """Connection JSON with 'from'/'to' should parse correctly."""
        data = {"from": "a", "to": "b", "type": "bolt"}
        conn = Connection.model_validate(data)
        assert conn.from_id == "a"
        assert conn.to_id == "b"

    def test_serialization_uses_alias(self) -> None:
        """model_dump(by_alias=True) should output 'from'/'to'."""
        conn = Connection(from_id="x", to_id="y", type="weld")
        dumped = conn.model_dump(by_alias=True)
        assert "from" in dumped
        assert "to" in dumped
        assert dumped["from"] == "x"
        assert dumped["to"] == "y"

    def test_field_name_parsing(self) -> None:
        """Connection with from_id/to_id should parse via populate_by_name."""
        conn = Connection(from_id="p1", to_id="p2")
        assert conn.from_id == "p1"
        assert conn.to_id == "p2"


# ── Blueprint Engine: load with components ───────────────────────────


class TestBlueprintEngineLoad:
    """Verify the engine loads .jarvis files with components into the scene."""

    def test_load_populates_scene(self, tmp_path: Path) -> None:
        """Loading a blueprint with components should build scene nodes."""
        data = {
            "jarvis_version": "1.0",
            "type": "part",
            "name": "Engine Test",
            "components": [
                {
                    "id": "c1",
                    "name": "Part A",
                    "type": "structural",
                    "position": {"x": 10, "y": 20, "z": 0},
                    "dimensions": {
                        "length": 50,
                        "width": 30,
                        "height": 10,
                        "unit": "mm",
                    },
                },
                {
                    "id": "c2",
                    "name": "Part B",
                    "type": "mechanical",
                    "position": {"x": 100, "y": 0, "z": 0},
                },
            ],
            "connections": [{"from": "c1", "to": "c2", "type": "bolt"}],
        }
        path = tmp_path / "engine_test.jarvis"
        path.write_text(json.dumps(data))

        from core.blueprint.engine import BlueprintEngine

        engine = BlueprintEngine(blueprint_dir=str(tmp_path))
        ok = asyncio.run(engine.load(str(path)))
        assert ok is True
        assert engine.blueprint is not None
        assert len(engine.blueprint.components) == 2
        assert len(engine.blueprint.connections) == 1

        # Scene should have nodes for each component (+ root)
        all_nodes = engine.scene.get_all_nodes()
        assert len(all_nodes) >= 3  # root + 2 components

        # Verify node position
        node = engine.scene.get_node_by_component("c1")
        assert node is not None
        wt = node.get_world_transform()
        assert abs(wt.x - 10) < 0.1
        assert abs(wt.y - 20) < 0.1

    def test_load_empty_blueprint(self, tmp_path: Path) -> None:
        """Loading an empty blueprint should succeed with no components."""
        data = {
            "jarvis_version": "1.0",
            "type": "part",
            "name": "Empty",
            "components": [],
            "connections": [],
        }
        path = tmp_path / "empty.jarvis"
        path.write_text(json.dumps(data))

        from core.blueprint.engine import BlueprintEngine

        engine = BlueprintEngine(blueprint_dir=str(tmp_path))
        ok = asyncio.run(engine.load(str(path)))
        assert ok is True
        assert engine.blueprint.name == "Empty"
        assert len(engine.blueprint.components) == 0


# ── Dimension unit validation ────────────────────────────────────────


class TestDimensionUnitValidation:
    """Dimension unit validator should accept valid units and reject bad ones."""

    @pytest.mark.parametrize("unit", ["mm", "cm", "m", "in", "ft", "px"])
    def test_valid_units(self, unit: str) -> None:
        """All valid units should be accepted."""
        dim = Dimension(length=1, width=1, height=1, unit=unit)
        assert dim.unit == unit

    @pytest.mark.parametrize("unit", ["percent", "em", "rem", "unknown"])
    def test_invalid_units_rejected(self, unit: str) -> None:
        """Invalid units should raise ValidationError."""
        with pytest.raises(Exception):
            Dimension(length=1, width=1, height=1, unit=unit)
