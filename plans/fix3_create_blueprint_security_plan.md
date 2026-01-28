# Fix 3 Plan: Enforce SecurityManager validation in CreateBlueprintTool

Goal: Update [`CreateBlueprintTool.execute()`](hardware/tools/create_blueprint_tool.py:23) so blueprint file creation is validated through the global security policy via [`get_security_manager()`](hardware/core/security/__init__.py:1) and [`SecurityManager.validate_file_access()`](hardware/core/security/security_manager.py:221) **before writing**.

Scope constraints (per request):
- Only modify [`CreateBlueprintTool`](hardware/tools/create_blueprint_tool.py:12)
- Only add/modify tests under `hardware/tests/`

User decision captured: **Permissive sanitization** (proceed using sanitized filename, still validate and write).

---

## 1) Exact code changes in `execute()`

### A) Imports
In [`hardware/tools/create_blueprint_tool.py`](hardware/tools/create_blueprint_tool.py:1) add:
- `from core.security import SecurityError, get_security_manager`

### B) Path construction (sanitized filename component)
Current path build:
- `path = Path("data") / "blueprints" / f"{name}.json"`

Replace with:
1. `name = blueprint_name.strip()` (keep existing)
2. `security = get_security_manager()`
3. `safe_name = security.sanitize_filename(name)` (permissive)
4. `intended_path = Path("data") / "blueprints" / f"{safe_name}.json"`

Notes:
- `sanitize_filename()` removes path separators and dangerous chars, preventing `blueprint_name` from injecting directory traversal.

### C) Validation (before mkdir + before write)
Add:
- `validated_path = security.validate_file_access(intended_path)`

This enforces:
- allowlist/blocklist rules
- traversal protections

### D) Preserve directory creation behavior
Current behavior:
- `path.parent.mkdir(parents=True, exist_ok=True)`

New behavior:
- `validated_path.parent.mkdir(parents=True, exist_ok=True)`

This preserves automatic directory creation while ensuring we only create directories for validated paths.

### E) Write operation (to validated path)
Replace:
- `path.write_text(json.dumps(data, indent=4), encoding="utf-8")`

With:
- `validated_path.write_text(json.dumps(data, indent=4), encoding="utf-8")`

### F) Error handling
Add a new handler before the existing `PermissionError` handler:
- `except SecurityError as exc:` → return `ToolResult.fail(..., error_type="AccessDenied")`

Keep existing handlers unchanged:
- `PermissionError` → `AccessDenied`
- `OSError` → `OSError`
- `TypeError/ValueError` → `ValidationError`
- catch-all `Exception`

### G) Behavioral note (return message)
- Success message should use `safe_name` (the actual created filename base) to avoid claiming a name that differs from what was saved.
  - Example: `Blueprint '<safe_name>' created successfully.`

---

## 2) Directory creation behavior (explicit)

Requirement: keep directory creation behavior.

Implementation:
- After `validated_path = security.validate_file_access(intended_path)` succeeds, run:
  - `validated_path.parent.mkdir(parents=True, exist_ok=True)`

Denied paths:
- No directory creation occurs if validation raises, because `mkdir` is after validation.

---

## 3) Tests to add in `hardware/tests/`

Add new test module:
- [`hardware/tests/test_create_blueprint_tool_security.py`](hardware/tests/test_create_blueprint_tool_security.py)

### Test setup pattern
- Use `tmp_path` fixture to avoid writing into repo.
- Monkeypatch the tool module’s imported symbol `get_security_manager` (patch location matters).
  - After implementation, tool will import it from `core.security`, so patch:
    - [`hardware.tools.create_blueprint_tool.get_security_manager()`](hardware/tools/create_blueprint_tool.py:23)

Provide a fake security manager with:
- `sanitize_filename(name)`
- `validate_file_access(path)`

### Test 1: validation is called and write uses validated path
Name:
- `test_create_blueprint_calls_validate_file_access_and_writes(tmp_path, monkeypatch)`

Fake manager behavior:
- `sanitize_filename` returns `name` unchanged
- `validate_file_access`:
  - records the incoming `path` argument
  - returns `tmp_path / "data" / "blueprints" / "MyBlueprint.json"`

Assertions:
- `validate_file_access` called exactly once
- Called with `Path("data") / "blueprints" / "MyBlueprint.json"` (relative path object)
- Tool result is ok
- File exists at the returned validated path
- File content JSON includes keys `theme` and `profile`

### Test 2: denied path returns ToolResult.fail with AccessDenied (or similar)
Name:
- `test_create_blueprint_denied_path_returns_toolresult_fail(monkeypatch)`

Fake manager behavior:
- `sanitize_filename` returns `name`
- `validate_file_access` raises `SecurityError("Path not in allowed directories")`

Assertions:
- `result.ok is False`
- `result.error_type == "AccessDenied"` (or equivalent field)
- `"not in allowed"` (or the message) present in `result.content`

### Test 3: sanitization is applied (permissive)
Name:
- `test_create_blueprint_uses_sanitized_filename_in_path(tmp_path, monkeypatch)`

Fake manager behavior:
- `sanitize_filename` returns a modified version, e.g. input `"../evil"` → `"evil"`
- `validate_file_access` records the incoming path and returns a tmp_path target

Assertions:
- `validate_file_access` called with a path ending in `evil.json` (not containing `..` or separators)
- Tool writes to the returned validated path successfully

This test directly verifies the “permissive sanitization” decision and ensures traversal attempts are defanged before validation.

---

## 4) Pytest run commands

From repo root:

- Run only the new test module:
  - `python -m pytest hardware/tests/test_create_blueprint_tool_security.py -q`

- Run all hardware tests:
  - `python -m pytest hardware/tests -q`

- Run matching tests while iterating:
  - `python -m pytest hardware/tests -q -k create_blueprint`

---

## Implementation handoff

Once you approve this plan, switch to Code mode to:
- implement the changes in [`CreateBlueprintTool.execute()`](hardware/tools/create_blueprint_tool.py:23)
- add [`hardware/tests/test_create_blueprint_tool_security.py`](hardware/tests/test_create_blueprint_tool_security.py)
- run the pytest commands above.