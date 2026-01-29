from __future__ import annotations

from types import SimpleNamespace

import pytest


def _make_stack_stub(call_log: list[str]):
    security = object()
    http_client = object()
    device_token = "token-123"
    device_id = "device-abc"
    sync_manager = object()

    stack = SimpleNamespace(
        security=security,
        http_client=http_client,
        device_token=device_token,
        device_id=device_id,
        sync_manager=sync_manager,
    )

    def _stub_build_sync_stack():
        call_log.append("called")
        return stack

    return stack, _stub_build_sync_stack


@pytest.mark.parametrize(
    "module_path, tool_cls_name",
    [
        ("hardware.tools.sync_tool", "SyncTool"),
        ("hardware.tools.send_blueprint_tool", "SendBlueprintTool"),
        ("hardware.tools.update_blueprint_tool", "UpdateBlueprintTool"),
        ("hardware.tools.resolve_conflict_tool", "ResolveConflictTool"),
    ],
)
def test_tools_use_build_sync_stack(monkeypatch, module_path: str, tool_cls_name: str):
    call_log: list[str] = []
    stack, stub = _make_stack_stub(call_log)

    mod = __import__(module_path, fromlist=[tool_cls_name])
    monkeypatch.setattr(mod, "build_sync_stack", stub)

    tool_cls = getattr(mod, tool_cls_name)
    tool = tool_cls()

    assert call_log == ["called"]
    assert tool.security is stack.security
    assert tool.http_client is stack.http_client
    assert tool.device_token == stack.device_token
    assert tool.device_id == stack.device_id
    assert tool.sync_manager is stack.sync_manager


def test_sync_queue_tool_uses_build_sync_stack_and_keeps_queue(monkeypatch):
    call_log: list[str] = []
    stack, stub = _make_stack_stub(call_log)

    import hardware.tools.sync_queue_tool as mod

    monkeypatch.setattr(mod, "build_sync_stack", stub)

    tool = mod.SyncQueueTool()

    assert call_log == ["called"]
    assert tool.security is stack.security
    assert tool.http_client is stack.http_client
    assert tool.device_token == stack.device_token
    assert tool.device_id == stack.device_id
    assert tool.sync_manager is stack.sync_manager

    # Tool-specific initialization should remain intact.
    assert hasattr(tool, "queue")


def test_sync_tool_execute_behavior_preserved_with_stubbed_sync_manager(monkeypatch):
    import hardware.tools.sync_tool as mod

    async def _sync_to_server():
        return []

    # Return a stack whose sync_manager has the awaited API.
    stack = SimpleNamespace(
        security=object(),
        http_client=object(),
        device_token="token-123",
        device_id="device-abc",
        sync_manager=SimpleNamespace(sync_to_server=_sync_to_server),
    )

    def _stub_build_sync_stack():
        return stack

    monkeypatch.setattr(mod, "build_sync_stack", _stub_build_sync_stack)

    tool = mod.SyncTool()
    res = tool.execute()

    assert res.ok is True
    assert "Synced 0 blueprints" in res.content
