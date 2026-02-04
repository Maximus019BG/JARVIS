# Plan: Structured tool results (Critique #7)

Goal: Breaking/clean migration where [`BaseTool.execute()`](hardware/core/base_tool.py:54) returns a structured `ToolResult` only (no raw strings), then the execution plumbing ([`ToolCallExecutor.execute_tool_call()`](hardware/core/tool_execution.py:235)), chat coordination ([`ChatHandler.process_message()`](hardware/core/chat_handler.py:360)), and LLM provider integration ([`LLMProvider`](hardware/core/llm/provider_factory.py:19), [`LlamaWrapper.continue_conversation()`](hardware/core/llm/llama_wrapper.py:57)) are updated to consume and emit that structure. Finally, update all tool implementations and tests.

This plan intentionally **does not include code changes**; it enumerates concrete edits + migration order.

---

## 1) Define the new structured return contract

### 1.1 Create `ToolResult` model (single source of truth)

Edit/add:
- Add `ToolResult` and helpers in [`hardware/core/base_tool.py`](hardware/core/base_tool.py:1) (preferred, minimal churn) **or** add a new module and re-export.
  - If adding a new module, create [`hardware/core/tool_result.py`](hardware/core/tool_result.py) and import it from [`hardware/core/base_tool.py`](hardware/core/base_tool.py:1).

Proposed contract (JSON-serializable, stable, explicit):

- `ToolResult` is a frozen dataclass (or TypedDict) with only JSON-safe field types.
- Required fields:
  - `ok: bool`
  - `content: str` (human-readable payload; must always be present even on errors)
- Optional fields:
  - `tool: str | None` (tool name at the point of execution; useful for logs)
  - `call_id: str | None` (LLM call id)
  - `error_type: str | None` (e.g., ToolNotFound, ValidationError, Timeout, ToolError, TypeError, Exception)
  - `error_details: dict[str, Any] | None` (must remain JSON-serializable)
  - `duration_ms: int | None`

Helper constructors:
- `ToolResult.ok(content: str, *, tool: str | None = None, call_id: str | None = None, duration_ms: int | None = None, **meta)`
- `ToolResult.fail(content: str, *, tool: str | None = None, call_id: str | None = None, error_type: str | None = None, error_details: dict[str, Any] | None = None, duration_ms: int | None = None)`

Serialization helpers:
- `ToolResult.to_message_content()` -> string sent to LLM (default: `content` only; keep provider-message minimal)
- `ToolResult.to_dict()` -> dict for logs/tests

Compatibility stance:
- This is a breaking change by design: no tool should return a raw string.
- Keep raising [`ToolError`](hardware/core/base_tool.py:17) for controlled failures **only if** you want exceptions to remain flow-control inside executor; otherwise tools can return `ToolResult.fail(...)` and avoid exceptions. The plan assumes we keep exceptions for “unexpected” errors and optionally for controlled ones.

### 1.2 Decide error strategy (clean approach)

Pick one consistent approach:

A) “Exception-based failures” (minimal tool churn):
- Tools return `ToolResult.ok(...)` on success.
- Tools raise [`ToolError`](hardware/core/base_tool.py:17) for expected failures.
- Executor catches and converts to `ToolResult.fail(...)`.

B) “Return-based failures” (cleaner, more explicit):
- Tools never raise `ToolError` for normal failures; they return `ToolResult.fail(...)`.
- Executor treats exceptions as bugs/unexpected and wraps them.

Recommendation for this repo given existing tests: start with A (smaller diff) then optionally migrate tools to B later.

---

## 2) Change the core tool interface

Edit:
- [`BaseTool.execute()`](hardware/core/base_tool.py:54)

Actions:
- Update signature/typing from returning `str` to returning `ToolResult`.
- Update docstring to reflect structured output.
- Optionally add a default `format_for_llm(result: ToolResult) -> str` helper on base class or module-level to centralize how results are rendered back into tool messages.

Repo-wide follow-ups:
- Any tool subclass implementations must be updated to match return type.

---

## 3) Update tool execution plumbing to use `ToolResult` end-to-end

### 3.1 Replace internal `_ToolExecutionResult` with `ToolResult`

Edit:
- [`hardware/core/tool_execution.py`](hardware/core/tool_execution.py:1)

Actions:
- Remove (or keep private only temporarily) `_ToolExecutionResult` and have `ToolCallExecutor` produce and return `ToolResult`.
- Change public contract:
  - [`ToolCallExecutor.execute_tool_call()`](hardware/core/tool_execution.py:235) returns `ToolResult` (not `str`).
- Keep existing validation/timeout behavior, but return `ToolResult.fail(...)` instead of error strings.
- When invoking tool:
  - Expect `tool.execute(**arguments)` to return `ToolResult`.
  - If it returns anything else, treat it as programmer error and wrap into `ToolResult.fail(error_type='InvalidToolReturnType', ...)`.
- Ensure duration is set on both success and failure.

### 3.2 Update chat orchestration to pass structured results to provider

Edit:
- [`ChatHandler.process_message()`](hardware/core/chat_handler.py:360)
- [`ChatHandler.execute_tool_call()`](hardware/core/chat_handler.py:428)

Actions:
- `execute_tool_call` returns `ToolResult`.
- In the tool-call loop, build a list of structured results instead of `{"content": str, "call_id": ...}`.
  - Suggested shape for downstream provider: list of dict messages:
    - `{"tool_call_id": call_id, "content": tool_result.to_message_content(), "raw": tool_result.to_dict()}`
  - Whether `raw` is included depends on provider support; see section 4.

---

## 4) Update LLM provider integration expectations

### 4.1 Update the provider protocol

Edit:
- [`LLMProvider.continue_conversation()`](hardware/core/llm/provider_factory.py:32)

Actions:
- Change `tool_results` type to reflect new structure.
- Decide one of:
  - Option 1 (keep provider generic): `tool_results: list[dict[str, Any]]` but document the required keys precisely.
  - Option 2 (typed): introduce `ToolResultMessage` TypedDict in core (preferably near `ToolResult`).

Required keys in each entry:
- `tool_call_id: str` (rename from `call_id` to align with Ollama/OpenAI tool message conventions)
- `content: str` (string message content sent to model)

Optional keys:
- `raw: dict[str, Any]` (full structured ToolResult for logs/debug; not sent to model unless provider supports it)

### 4.2 Update `LlamaWrapper.continue_conversation` to consume new keys

Edit:
- [`hardware/core/llm/llama_wrapper.py`](hardware/core/llm/llama_wrapper.py:57)

Actions:
- Update the loop that appends tool messages:
  - Use `tool_call_id` key (and/or support both during transition if you choose).
  - Use `content` as a string.
- Ensure that any structured metadata is not accidentally injected into `content` unless intentionally formatted.

### 4.3 Update test mock provider

Edit:
- [`hardware/tests/mock_llm.py`](hardware/tests/mock_llm.py:1)

Actions:
- Update `continue_conversation` to read `tool_results[0]['content']` unchanged, but ensure the test harness produces the new keys.

---

## 5) Update all tool implementations to return `ToolResult`

Concrete files to edit (all tools under `hardware/tools/` that implement `execute`):

- [`hardware/tools/help_tool.py`](hardware/tools/help_tool.py:1)
- [`hardware/tools/read_file_tool.py`](hardware/tools/read_file_tool.py:1)
- [`hardware/tools/write_file_tool.py`](hardware/tools/write_file_tool.py:1)
- [`hardware/tools/execute_code_tool.py`](hardware/tools/execute_code_tool.py:1) (and `AnalyzeCodeTool` inside this file)
- [`hardware/tools/shell_tool.py`](hardware/tools/shell_tool.py:1) (both `ShellCommandTool` and `ListDirectoryTool`)

Additional tools to inspect/update (not fully enumerated in reads above, but present in tree):
- [`hardware/tools/apply_theme_tool.py`](hardware/tools/apply_theme_tool.py)
- [`hardware/tools/create_blueprint_tool.py`](hardware/tools/create_blueprint_tool.py)
- [`hardware/tools/edit_profile_tool.py`](hardware/tools/edit_profile_tool.py)
- [`hardware/tools/live_assistance_tool.py`](hardware/tools/live_assistance_tool.py)
- [`hardware/tools/load_blueprint_tool.py`](hardware/tools/load_blueprint_tool.py)
- [`hardware/tools/memory_tools.py`](hardware/tools/memory_tools.py)
- [`hardware/tools/quit_tool.py`](hardware/tools/quit_tool.py)
- [`hardware/tools/resolve_conflict_tool.py`](hardware/tools/resolve_conflict_tool.py)
- [`hardware/tools/save_profile_tool.py`](hardware/tools/save_profile_tool.py)
- [`hardware/tools/send_blueprint_tool.py`](hardware/tools/send_blueprint_tool.py)
- [`hardware/tools/smart_mode_tool.py`](hardware/tools/smart_mode_tool.py)
- [`hardware/tools/summarize_tool.py`](hardware/tools/summarize_tool.py)
- [`hardware/tools/sync_config_tool.py`](hardware/tools/sync_config_tool.py)
- [`hardware/tools/sync_queue_tool.py`](hardware/tools/sync_queue_tool.py)
- [`hardware/tools/sync_status_tool.py`](hardware/tools/sync_status_tool.py)
- [`hardware/tools/sync_tool.py`](hardware/tools/sync_tool.py)
- [`hardware/tools/update_blueprint_tool.py`](hardware/tools/update_blueprint_tool.py)
- [`hardware/tools/view_stats_tool.py`](hardware/tools/view_stats_tool.py)
- [`hardware/tools/web_search_tool.py`](hardware/tools/web_search_tool.py)

Update guidance for each tool:
- Replace `return "..."` with `return ToolResult.ok("...")`.
- For branches currently returning user-facing error strings (common in execution tools), decide whether to treat as `ok=False` or keep as `ok=True` with explanatory text. Recommendation:
  - If the tool did not perform requested action due to validation/security policy, return `ToolResult.fail(...)`.
  - If the tool performed the action but the outcome is “no-op” (e.g., empty directory listing), keep `ok=True` with content describing it.
- Preserve raising `ToolError` for exceptional conditions if adopting strategy A.

---

## 6) Update tests to assert against `ToolResult`

### 6.1 File tool tests

Edit:
- [`hardware/tests/test_file_tools.py`](hardware/tests/test_file_tools.py:1)

Actions:
- Update assertions:
  - `result = tool.execute(...)` now yields `ToolResult`.
  - Replace `assert result == ...` with `assert result.ok is True` and `assert ... in result.content` etc.
- Update error tests:
  - If tools still raise `ToolError` for missing files, keep `pytest.raises(ToolError)`.
  - If tools switch to return-based failures, update to `result.ok is False` and match `result.error_type/content`.

### 6.2 Chat handler tests

Edit:
- [`hardware/tests/test_chat_handler.py`](hardware/tests/test_chat_handler.py:1)

Actions:
- Update mock tool setup:
  - `mock_tool.execute.return_value` should be a `ToolResult.ok(...)`.
- Update `test_execute_tool_call_success` to assert:
  - `result.ok is True` and `result.content == "Tool executed"`.
- Update `test_execute_tool_call_error`:
  - expect `ToolResult.ok is False` and `error_type == 'ToolNotFound'` (or whatever you standardize on).
- Ensure tool results passed into `continue_conversation` match new key names (`tool_call_id`).

### 6.3 Tool registry tests (likely unaffected)

- [`hardware/tests/test_tool_registry.py`](hardware/tests/test_tool_registry.py:1) should remain mostly unchanged because it tests schema retrieval.
- Only update if any mocks need to satisfy updated `BaseTool` typing (in type-checking contexts).

### 6.4 Any additional tests / e2e

Inspect and update if they rely on string tool results:
- [`hardware/test_e2e.py`](hardware/test_e2e.py)
- Any tests referencing `execute_tool_call` output directly.

---

## 7) Migration order (clean + low-risk)

1) Introduce `ToolResult` model and helpers in core
   - [`hardware/core/base_tool.py`](hardware/core/base_tool.py:1) (and optional [`hardware/core/tool_result.py`](hardware/core/tool_result.py))

2) Change base interface typing
   - [`BaseTool.execute()`](hardware/core/base_tool.py:54)

3) Update execution plumbing to return `ToolResult`
   - [`ToolCallExecutor.execute_tool_call()`](hardware/core/tool_execution.py:235)

4) Update chat handler plumbing to pass tool results forward
   - [`hardware/core/chat_handler.py`](hardware/core/chat_handler.py:360)

5) Update provider protocol + implementations
   - [`hardware/core/llm/provider_factory.py`](hardware/core/llm/provider_factory.py:19)
   - [`hardware/core/llm/llama_wrapper.py`](hardware/core/llm/llama_wrapper.py:57)

6) Update test mocks for providers
   - [`hardware/tests/mock_llm.py`](hardware/tests/mock_llm.py:1)

7) Update tool implementations (convert one-by-one, keep tests green as you go)
   - Start with core tools used in tests: [`hardware/tools/read_file_tool.py`](hardware/tools/read_file_tool.py:1), [`hardware/tools/write_file_tool.py`](hardware/tools/write_file_tool.py:1), [`hardware/tools/help_tool.py`](hardware/tools/help_tool.py:1)
   - Then convert the rest in [`hardware/tools/`](hardware/tools/__init__.py:1)

8) Update unit tests
   - [`hardware/tests/test_file_tools.py`](hardware/tests/test_file_tools.py:1)
   - [`hardware/tests/test_chat_handler.py`](hardware/tests/test_chat_handler.py:1)
   - Scan remaining tests for string assumptions

9) Optional: add a one-release compatibility shim (if desired)
   - If you need a gradual migration, allow executor to accept string returns and wrap them; but critique #7 asked for breaking/clean, so default is to fail fast.

---

## 8) Acceptance checks (what should be true at the end)

- All `BaseTool` subclasses return `ToolResult`.
- [`ToolCallExecutor`](hardware/core/tool_execution.py:219) returns `ToolResult` and never returns raw error strings.
- Provider layer receives tool messages with `tool_call_id` and `content`.
- Tests updated to validate `ToolResult.ok`, `ToolResult.content`, and error metadata.
- No string comparisons remain for direct tool returns except where formatting is explicitly tested.
