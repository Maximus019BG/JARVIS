# Plan: ToolRegistry versioning + ChatHandler tool schema cache invalidation (Error #5)

## Problem statement
[`ChatHandler`](hardware/core/chat_handler.py:38) caches tool schemas in `_tool_schema_cache`, but its invalidation strategy relies on `tool_registry.get_version()` **only if it exists**, otherwise it always uses `0`:

- Cache logic: [`ChatHandler._get_cached_tool_schemas()`](hardware/core/chat_handler.py:337)
- Registry: [`ToolRegistry`](hardware/core/tool_registry.py:23) has no versioning API.

This mismatch causes an architectural inconsistency and can cause stale tool schemas if the tool set changes during runtime. Error #5 calls out that schema caching exists in ChatHandler but ToolRegistry lacks versioning.

## Goals
- Add explicit registry versioning to [`ToolRegistry`](hardware/core/tool_registry.py:23).
- Make [`ChatHandler`](hardware/core/chat_handler.py:38) consume the registry version directly (remove the `hasattr` fallback).
- Add/update tests that prove:
  - ToolRegistry version increments on mutations.
  - ChatHandler’s schema cache invalidates when registry version changes.

Non-goals:
- No functional change to tool execution.
- No changes to the external tool schema format.

---

## Proposed design

### 1) Add a monotonic version counter to ToolRegistry
Add a private integer field, initialized to `0`:
- `self._version: int = 0`

Add public API:
- `def get_version(self) -> int:` returns `self._version`.

Increment `_version` on any operation that can change the set of tools and therefore the schema list:
- [`ToolRegistry.register_tool()`](hardware/core/tool_registry.py:29)
- [`ToolRegistry.unregister_tool()`](hardware/core/tool_registry.py:37)

Also add a registry-wide clearing operation if one exists/should exist; if not present today, consider adding:
- `def clear(self) -> None:` clears `self._tools` and increments `_version`.

Version increment rules:
- Increment when the registry’s externally observable tool set changes.
- Treat “overwrite registration” (registering a tool whose name already exists) as a change as well (schema may have changed).

Why monotonic int:
- Simple, fast, deterministic, and works well for cache invalidation.
- Avoids hashing all tool schemas or deep equality checks.

### 2) Make tool schema ordering deterministic (optional but recommended)
Current schema generation order depends on dict insertion order:
- [`ToolRegistry.get_tool_schemas()`](hardware/core/tool_registry.py:66)

This is typically deterministic within a single run, but tests and downstream clients may be more stable if ordering is explicit.

Recommended approach:
- Generate schemas in sorted name order: `for name in sorted(self._tools)`.

If you adopt deterministic ordering, document that `get_tool_schemas()` is stable across runs for the same tool set.

### 3) Update ChatHandler cache invalidation to rely on registry version
Update [`ChatHandler._get_cached_tool_schemas()`](hardware/core/chat_handler.py:337) to:
- Call `current_version = self.tool_registry.get_version()` unconditionally.
- Remove the compatibility fallback: `hasattr(self.tool_registry, 'get_version')`.

Reasoning:
- Error #5 wants versioning in registry; once it exists, ChatHandler should use it consistently.
- If there are alternate registry implementations, they should conform to the same interface.

Also consider tightening cache type:
- `_tool_schema_cache: list[dict[str, Any]] | None` (currently declared as `dict[str, Any] | None` but assigned a list).

### 4) Ensure version increments when tool set changes via other code paths
Search for any direct access to `ToolRegistry._tools` or patterns that mutate it without going through methods.

If found, refactor callers to use registry APIs to keep versioning correct.

---

## Tests to add/update

### A) ToolRegistry versioning tests
Update [`hardware/tests/test_tool_registry.py`](hardware/tests/test_tool_registry.py:1) with new test cases:

1. `test_version_starts_at_zero`
   - Create registry.
   - Assert `registry.get_version() == 0`.

2. `test_version_increments_on_register`
   - Register `mock_tool`.
   - Assert version == 1.

3. `test_version_increments_on_unregister`
   - Register then unregister.
   - Assert version increments again (e.g., ends at 2).

4. (If adding clear) `test_version_increments_on_clear`
   - Register tool, call `clear()`, assert version increments.

5. (If deterministic ordering adopted) `test_get_tool_schemas_sorted_by_name`
   - Register tools in reverse order.
   - Assert returned schema list is sorted by tool name.

Notes:
- Current tests treat missing tool as `KeyError`; ToolRegistry raises [`ToolNotFoundError`](hardware/core/tool_registry.py:11), which is a subclass of `KeyError`, so existing assertions remain valid.

### B) ChatHandler cache invalidation tests
Update [`hardware/tests/test_chat_handler.py`](hardware/tests/test_chat_handler.py:1) to verify cached tool schemas refresh when registry changes.

Because the caching method is private, we can still test behavior safely by:
- Calling [`ChatHandler._get_cached_tool_schemas()`](hardware/core/chat_handler.py:337) directly (acceptable in unit tests for caching semantics), or
- Triggering it via [`ChatHandler.process_message()`](hardware/core/chat_handler.py:357) and instrumenting the registry/tool schema calls.

Recommended direct approach (less coupled to LLM/tool execution):

1. `test_tool_schema_cache_reused_when_registry_version_unchanged`
   - Create registry with a mock tool.
   - Create chat_handler.
   - Call `_get_cached_tool_schemas()` twice.
   - Assert the same list object is returned (identity), or assert `tool.get_schema` called once.

2. `test_tool_schema_cache_invalidates_when_registry_version_changes`
   - Create registry with tool A.
   - Create chat_handler.
   - Call `_get_cached_tool_schemas()` (caches version N).
   - Register tool B (version N+1).
   - Call `_get_cached_tool_schemas()` again.
   - Assert cache refresh occurred:
     - `toolA.get_schema` called again (depending on implementation), or
     - schemas now include tool B, and the returned list object differs from the first.

Implementation detail for mocks:
- Use `unittest.mock.Mock` for tools and assert `get_schema` call counts.
- If schema ordering becomes sorted, assert presence rather than exact position unless testing ordering explicitly.

---

## Rollout / compatibility considerations
- This is a small API addition (`get_version()`), but it is a behavioral contract change: any alternate registry implementation must provide `get_version()`.
- If backwards compatibility is required for external consumers, keep the `hasattr` fallback temporarily behind a deprecation path. Error #5 suggests aligning implementation, so the plan assumes the fallback is removed once versioning exists.

---

## Acceptance criteria
- [`ToolRegistry`](hardware/core/tool_registry.py:23) exposes `get_version()` and increments version on all mutations.
- [`ChatHandler`](hardware/core/chat_handler.py:38) invalidates tool schema cache solely based on registry version.
- Unit tests cover version increments and cache invalidation.
- All existing tests continue to pass.

---

## Execution checklist (for implementation mode)
- [ ] Add `_version` + `get_version()` to [`ToolRegistry`](hardware/core/tool_registry.py:23)
- [ ] Increment `_version` in `register_tool`, `unregister_tool` (and `clear` if added)
- [ ] (Optional) Make `get_tool_schemas()` deterministic by sorting
- [ ] Update [`ChatHandler._get_cached_tool_schemas()`](hardware/core/chat_handler.py:337) to use `get_version()` unconditionally
- [ ] Fix `_tool_schema_cache` type annotation in [`ChatHandler`](hardware/core/chat_handler.py:85)
- [ ] Update/add tests in [`hardware/tests/test_tool_registry.py`](hardware/tests/test_tool_registry.py:1)
- [ ] Update/add tests in [`hardware/tests/test_chat_handler.py`](hardware/tests/test_chat_handler.py:1)
