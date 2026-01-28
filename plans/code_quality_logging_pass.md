# Critique #10 plan: minor code quality quick hits + professional logging pass (`hardware/`)

Scope: `hardware/` Python package (core + tools + config). This pass is **mechanical + low risk**: improve logging consistency, remove obvious lint issues, and clean up types. **No behavior changes unless clearly a bugfix** (and any bugfix must be narrowly scoped with a test update).

---

## Goals

1. Remove unused imports / unused locals that are safe to remove.
2. Standardize logger initialization to:

   - Use [`get_logger()`](hardware/app_logging/logger.py) everywhere (no `logging.getLogger` in package modules).
   - Module-level pattern:

     ```py
     from app_logging.logger import get_logger

     logger = get_logger(__name__)
     ```

3. Use **lazy formatting** in logging calls (no f-strings in `logger.*(...)`):

   - ✅ `logger.info("Saved blueprint: %s", path)`
   - ❌ `logger.info(f"Saved blueprint: {path}")`

4. Consistent exception logging:

   - Use `logger.exception("...")` inside `except Exception:` blocks when you want traceback.
   - Otherwise use `logger.error("...: %s", exc, exc_info=True)` for non-exception helper contexts.
   - Do not swallow exceptions silently; if code returns a failure `ToolResult`, log at `warning` (expected) vs `exception` (unexpected).

5. Type hints cleanup:

   - Remove unused typing imports (`Any`, `Dict`, `Optional`, `TYPE_CHECKING`, etc. if unused).
   - Prefer built-in generics (`dict[str, Any]`, `list[str]`) consistently.
   - Ensure public APIs have reasonably accurate return types.

6. Remove obvious dead code:

   - Unused helper functions/classes.
   - Unreachable branches.
   - Debug `print` calls in library code (CLI prints may remain in entrypoints).

---

## Non-goals (explicit)

- No refactors that change control flow, persistence format, security posture, routing/scoring behavior, tool semantics, or API surface.
- No large renames or module re-organization.
- No logging config changes (keep [`configure_logging()`](hardware/app_logging/logger.py) behavior unless broken).
- No new dependencies.

---

## Repo logging standards for this pass (what “good” looks like)

### Logger creation

- At top of each module that logs:

  - `from app_logging.logger import get_logger`
  - `logger = get_logger(__name__)`

- Avoid creating loggers inside hot-path functions unless necessary.

### Levels

- `debug`: detailed internal state (routing scores, counts, timings, cache hits).
- `info`: major lifecycle events (startup, successful completion, notable state changes).
- `warning`: recoverable failures / fallbacks / blocked user actions.
- `error`: failed operation returned to caller, no traceback.
- `exception`: unexpected failure where traceback is helpful.

### Formatting and payload

- Use %-style formatting to let logging defer string interpolation.
- Keep log messages stable and structured; when extra context matters, include it via:

  - placeholders: `logger.info("... path=%s size=%d", path, size)`
  - optional `extra={...}` only where already used (avoid widening scope).

### Exception patterns

- Prefer:

  - `except Exception as exc: logger.exception("...")` then re-raise
  - or `logger.exception("...", exc_info=exc)` is **not needed** (exception uses current context)

- For code paths that *return* an error string/ToolResult:

  - `logger.warning("...: %s", exc)` for expected errors
  - `logger.exception("...",)` for unexpected ones

---

## Mechanical transformations checklist (applies throughout)

- [ ] Replace any `logger.<level>(f"...")` with lazy formatting.
- [ ] Replace `logger.error(f"... {e}")` with `logger.error("...: %s", e)`.
- [ ] For exceptions that should include traceback, replace `logger.error(...%s...)` with `logger.exception(...)`.
- [ ] Replace any module-level `logging.getLogger(__name__)` with [`get_logger(__name__)`](hardware/app_logging/logger.py).
- [ ] Remove unused imports (standard library, typing, local modules).
- [ ] Remove unused locals (only if clearly unused and not side-effectful).
- [ ] Run formatter/linter (ruff) and ensure no new warnings.

---

## File touch list (safe targets) + what to look for

This is a **checklist**; only touch a file if it actually contains issues. Prioritize files already showing mixed styles in search results.

### Logging utility

- [`hardware/app_logging/logger.py`](hardware/app_logging/logger.py)
  - What to check: docstring link correctness, typing imports, ensure `get_logger` docs are correct.
  - Expected changes: likely none (already good).

### Core (`hardware/core/`)

- [`hardware/core/data_utils.py`](hardware/core/data_utils.py)
  - Issues spotted: uses `logging.getLogger(__name__)` instead of `get_logger`.
  - What to check: ensure `extra={...}` usage remains valid; keep behavior identical.

- [`hardware/core/chat_handler.py`](hardware/core/chat_handler.py)
  - Issues spotted: multiple f-string logger calls; some exception paths use f-strings.
  - What to check: do not change user-facing prints; focus on logger calls.

- [`hardware/core/orchestration.py`](hardware/core/orchestration.py)
  - Issues spotted: uses f-strings for LLM prompt building (fine); exception logging uses `.error("... %s", exc)` without traceback.
  - What to check: runner exception should likely use `logger.exception` to preserve traceback (safe, no behavior change).

- [`hardware/core/agents/base_agent.py`](hardware/core/agents/base_agent.py)
  - Issues spotted: f-string logger calls.
  - What to check: replace f-strings; ensure no expensive formatting performed in hot loop.

- [`hardware/core/agents/orchestrator_agent.py`](hardware/core/agents/orchestrator_agent.py)
  - Issues spotted: heavy use of f-string logger calls.
  - What to check: keep message content identical; ensure `subtask` and `task` truncations remain.

- [`hardware/core/agents/blueprint_agent.py`](hardware/core/agents/blueprint_agent.py)
  - Issues spotted: f-string logger calls.
  - What to check: file IO paths and encoding unchanged.

- [`hardware/core/agents/memory_agent.py`](hardware/core/agents/memory_agent.py)
  - Issues spotted: f-string logger calls.

- [`hardware/core/agents/research_agent.py`](hardware/core/agents/research_agent.py)
  - Issues spotted: f-string logger call.

- [`hardware/core/memory/memory_manager.py`](hardware/core/memory/memory_manager.py)
  - Issues spotted: f-string logger calls.

- [`hardware/core/memory/memory_store.py`](hardware/core/memory/memory_store.py)
  - Issues spotted: many f-string logger calls.
  - What to check: ensure high-frequency logs remain `debug` (avoid spamming `info`). Keep levels as-is unless clearly wrong.

- [`hardware/core/memory/episodic_memory.py`](hardware/core/memory/episodic_memory.py)
  - Issues spotted: f-string logger calls.

- [`hardware/core/security/secure_storage.py`](hardware/core/security/secure_storage.py)
  - Issues spotted: uses `print` inside exception handlers.
  - What to check: replace prints with standard logger usage; keep return values identical.

- [`hardware/core/sync/sync_manager.py`](hardware/core/sync/sync_manager.py)
  - Issues spotted: several `except Exception as e:` blocks; likely no logger usage.
  - What to check: add `logger = get_logger(__name__)` and add minimal logging around fallback-to-offline-queue without changing behavior.

### Tools (`hardware/tools/`)

- [`hardware/tools/execute_code_tool.py`](hardware/tools/execute_code_tool.py)
  - Issues spotted: many f-string logger calls; at least one `logger.error(f"File execution failed: {e}")`.
  - What to check: keep returned strings identical (public tool contract); adjust logs only.

- [`hardware/tools/shell_tool.py`](hardware/tools/shell_tool.py)
  - Issues spotted: many f-string logger calls.
  - What to check: do not change command validation rules; just logging.

- [`hardware/tools/web_search_tool.py`](hardware/tools/web_search_tool.py)
  - Issues spotted: f-string logger calls.

- [`hardware/tools/summarize_tool.py`](hardware/tools/summarize_tool.py)
  - Issues spotted: f-string logger calls.

- [`hardware/tools/memory_tools.py`](hardware/tools/memory_tools.py)
  - Issues spotted: f-string logger calls.

- [`hardware/tools/read_file_tool.py`](hardware/tools/read_file_tool.py)
  - Already uses `logger.exception` correctly; check for any f-strings or unused imports.

- [`hardware/tools/write_file_tool.py`](hardware/tools/write_file_tool.py)
  - Already uses `logger.exception` correctly; check for any f-strings or unused imports.

- [`hardware/tools/send_blueprint_tool.py`](hardware/tools/send_blueprint_tool.py)
- [`hardware/tools/resolve_conflict_tool.py`](hardware/tools/resolve_conflict_tool.py)
- [`hardware/tools/sync_tool.py`](hardware/tools/sync_tool.py)
- [`hardware/tools/sync_queue_tool.py`](hardware/tools/sync_queue_tool.py)
- [`hardware/tools/update_blueprint_tool.py`](hardware/tools/update_blueprint_tool.py)
  - Issues spotted: exception handling returns `ToolResult.fail(f"...{e}")` (this is user-facing formatting, not logging).
  - What to check: add logging if missing, but keep returned messages unchanged.

### Config (`hardware/config/`)

- [`hardware/config/config.py`](hardware/config/config.py)
  - Probably minimal logging; focus on unused imports and type hints.
  - What to check: ensure config validation error messages remain exactly as tests expect.

- [`hardware/config/sync_config.py`](hardware/config/sync_config.py)
  - What to check: logging style + type hints.

### Entry point (only if needed)

- [`hardware/app.py`](hardware/app.py)
  - Contains `print` statements (acceptable for CLI). Only touch logger calls (remove f-strings) if present.

---

## Execution plan (step-by-step)

1. **Baseline checks**
   - Run ruff lint/format and pytest to capture current baseline.

2. **Automated scan + prioritize**
   - Use ripgrep/ruff output to list:
     - f-strings inside `logger.*`
     - `logging.getLogger(` usage
     - `print(` usage outside CLI/entrypoints
     - broad `except Exception` without `logger.exception`

3. **Mechanical edits (file-by-file)**
   - For each touched module:
     - fix imports
     - standardize logger init
     - convert logger f-strings to lazy formatting
     - adjust exception logging consistency
     - remove dead code if obvious and safe

4. **Type hint cleanup**
   - Remove unused typing imports.
   - Normalize return types to modern generics.

5. **Verification**
   - Run ruff + pytest.
   - Ensure no snapshot/string-based tests changed unexpectedly.

---

## Verification commands (Windows-friendly)

Run from repo root:

- Lint:
  - `python -m ruff check hardware`
- Format:
  - `python -m ruff format hardware`
- Tests:
  - `python -m pytest hardware/tests`

---

## Acceptance criteria

- No f-strings in any `logger.<level>(...)` calls under `hardware/`.
- No remaining `logging.getLogger(__name__)` usages inside `hardware/` modules (except inside the logging utility itself if needed).
- `except Exception` blocks either:
  - log with `logger.exception(...)` and re-raise, or
  - log at appropriate level and return a failure result without swallowing silently.
- Ruff and pytest pass.
- No behavior changes (verified by tests + careful review of only mechanical edits).
