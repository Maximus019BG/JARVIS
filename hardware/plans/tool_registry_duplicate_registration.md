# Plan: Explicit duplicate tool registration (Issue #6)

## Goal
Make duplicate tool registration explicit by:

- Emitting a warning when a tool is registered under a name that already exists.
- Overwriting the existing registration (last write wins), preserving the existing behavior.
- Ensuring registry versioning (`_version`) behavior stays correct (still bumps on any registration, including overwrites).

Scope is limited to behavior around [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:40) and its unit tests.

## Current behavior (baseline)
- [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:40) silently overwrites any existing entry in `self._tools[tool.name]`.
- It increments `self._version` on each call (including overwrites), per comment in [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:46).
- Logging style in this repo uses stdlib logging via [`get_logger()`](hardware/app_logging/logger.py:59) with per-module `logger = get_logger(__name__)` (examples: [`ToolCallExecutor`](hardware/core/tool_execution.py:28), [`ChatHandler`](hardware/core/chat_handler.py:32)).

## Proposed behavior change
### 1) Detect duplicates and warn
In [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:40):

- Before assignment, check if `tool.name` is already in `self._tools`.
- If present, emit a warning and then overwrite (keep existing overwrite semantics).

Warning should include:
- `tool.name`
- old tool class (and ideally module)
- new tool class (and ideally module)

Recommended message shape (avoid f-strings in logger calls; use `%s` formatting like other modules):

- `logger.warning("Duplicate tool registration for '%s': overwriting %s with %s", name, old_qualname, new_qualname)`

Where `old_qualname` and `new_qualname` are built as:
- `f"{tool.__class__.__module__}.{tool.__class__.__qualname__}"`

This keeps the warning actionable during debugging (especially for plugin loading and repeated registrations).

### 2) Keep overwrite + version semantics
Do **not** change the overwrite behavior: the new tool should replace the old one.

Versioning interaction:
- Keep bumping `self._version` on every `register_tool()` call, regardless of whether it was a first-time registration or an overwrite.
- Rationale: an overwrite can change schema/behavior, and callers like [`ChatHandler._get_cached_tool_schemas()`](hardware/core/chat_handler.py:337) already rely on `get_version()` to invalidate caches.

### 3) Where logging lives
Add a module-level logger in [`core.tool_registry`](hardware/core/tool_registry.py:1) using the existing logging utilities:

- `from app_logging.logger import get_logger`
- `logger = get_logger(__name__)`

This matches the established pattern (see [`hardware/core/tool_execution.py`](hardware/core/tool_execution.py:24) and [`hardware/core/chat_handler.py`](hardware/core/chat_handler.py:19)).

## Tests to add/update
Update the unit tests in [`hardware/tests/test_tool_registry.py`](hardware/tests/test_tool_registry.py:1).

### A) New test: duplicate registration warns + overwrites
Add a test that:

1. Creates a registry.
2. Registers a tool with a fixed name.
3. Registers another tool instance with the **same** name.
4. Asserts:
   - A warning was logged.
   - `registry.get_tool(name)` returns the **second** tool.
   - `registry.get_version()` incremented twice (ends at 2).

Implementation details for logging assertion:
- Use pytest’s `caplog` fixture.
- Set capture level to WARNING for the `core.tool_registry` logger name (or more generally for root during the test).
- Assert at least one record contains:
  - `"Duplicate tool registration"`
  - the tool name

To make overwriting easy to verify, use two distinct `Mock()` tool objects with:
- same `name`
- different identities

### B) Ensure existing tests remain correct
Existing tests already cover version increments and retrieval; they should still pass.

Potentially update/add one assertion in [`TestToolRegistry.test_version_increments_on_register`](hardware/tests/test_tool_registry.py:47) or keep it as-is.

## Edge cases / notes
- This change will surface existing duplicate registrations. There is already an obvious duplicate in [`register_tools()`](hardware/app.py:88) (re-registering `ReadFileTool` / `WriteFileTool`), and possibly duplicates in `AGENT_TOOLS`. The warning will help identify and clean these up later, but this issue explicitly wants warn + overwrite, not prevention.
- Keep warning emission lightweight and safe; avoid calling any tool methods beyond inspecting `__class__` metadata.

## Acceptance criteria
- Duplicate registration produces a WARNING log from `core.tool_registry`.
- The registry still overwrites the tool under that name.
- Registry `_version` still increments on duplicate registrations.
- Unit tests cover warning + overwrite + version bump.

## Implementation checklist (for Code mode)
- [ ] Add `logger = get_logger(__name__)` to [`hardware/core/tool_registry.py`](hardware/core/tool_registry.py:1)
- [ ] Update [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:40) to warn when `tool.name` already exists, then overwrite
- [ ] Add test using `caplog` in [`hardware/tests/test_tool_registry.py`](hardware/tests/test_tool_registry.py:1)
