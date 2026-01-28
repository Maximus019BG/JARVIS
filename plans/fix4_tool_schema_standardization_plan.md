# Fix 4 Plan — Standardize tool schema definitions in `hardware/tools/`

## Goal
Standardize tool schema definitions to use a single mechanism: override [`schema_parameters()`](hardware/tools/create_blueprint_tool.py:85) (preferred) and avoid per-tool overrides of [`get_schema()`](hardware/tools/apply_theme_tool.py:97) where not needed.

Scope is strictly:
- tool schema standardization
- tests verifying schema generation

## Compatibility constraints (must keep working)
- Tool schemas are consumed via [`BaseTool.get_schema()`](hardware/core/base_tool.py:157), which wraps [`ToolSchema.to_ollama_schema()`](hardware/core/base_tool.py:112).
- Registry exposes schemas via [`ToolRegistry.get_tool_schemas()`](hardware/core/tool_registry.py:104), calling each tool’s [`get_schema()`](hardware/core/base_tool.py:157).
- Tool runner argument validation (optional flag) pulls parameter schema via [`tool.schema_parameters()`](hardware/core/tool_execution.py:66) (not via `get_schema`). Therefore:
  - Moving definitions into `schema_parameters()` is fully compatible.
  - Keeping `schema_parameters()` accurate is required for validation.
  - Overriding `get_schema()` is rarely necessary and risks drifting from `schema_parameters()`.

## (1) Tools to change (list)
### Remove/replace per-tool `get_schema()` overrides with `schema_parameters()`
- [`hardware/tools/apply_theme_tool.py`](hardware/tools/apply_theme_tool.py:1)
- [`hardware/tools/edit_profile_tool.py`](hardware/tools/edit_profile_tool.py:1)
- [`hardware/tools/load_blueprint_tool.py`](hardware/tools/load_blueprint_tool.py:1)
- [`hardware/tools/save_profile_tool.py`](hardware/tools/save_profile_tool.py:1)

### Remove trivial `get_schema()` overrides that simply call `super()`
These provide no behavior and can be deleted for consistency.
- [`hardware/tools/live_assistance_tool.py`](hardware/tools/live_assistance_tool.py:1)
- [`hardware/tools/quit_tool.py`](hardware/tools/quit_tool.py:1)
- [`hardware/tools/smart_mode_tool.py`](hardware/tools/smart_mode_tool.py:1)
- [`hardware/tools/view_stats_tool.py`](hardware/tools/view_stats_tool.py:1)

### Leave as-is (already standard)
- [`hardware/tools/create_blueprint_tool.py`](hardware/tools/create_blueprint_tool.py:1) already defines [`schema_parameters()`](hardware/tools/create_blueprint_tool.py:85).

## (2) Exact edits per tool

### A) [`ApplyThemeTool`](hardware/tools/apply_theme_tool.py:30)
**Current:** overrides [`get_schema()`](hardware/tools/apply_theme_tool.py:97) to mutate the schema’s `properties` and `required`.

**Edit:**
1. Delete the entire method [`ApplyThemeTool.get_schema()`](hardware/tools/apply_theme_tool.py:97).
2. Add a new override:
   - Implement [`ApplyThemeTool.schema_parameters()`](hardware/tools/apply_theme_tool.py:30) returning:
     - `type: object`
     - `properties.primary`, `properties.secondary`, `properties.background` with same descriptions as current override
     - `required: []`
   - (Optional but recommended for stricter validation) set `additionalProperties: False`.

**Result:** `BaseTool.get_schema()` will incorporate these parameters without any per-tool mutation.

### B) [`EditProfileTool`](hardware/tools/edit_profile_tool.py:11)
**Current:** overrides [`get_schema()`](hardware/tools/edit_profile_tool.py:53) and sets `properties` and `required`.

**Edit:**
1. Delete [`EditProfileTool.get_schema()`](hardware/tools/edit_profile_tool.py:53).
2. Add override [`EditProfileTool.schema_parameters()`](hardware/tools/edit_profile_tool.py:11) returning:
   - `type: object`
   - `properties.name` and `properties.email` with same descriptions
   - `required: []`
   - (Optional) `additionalProperties: False`

### C) [`LoadBlueprintTool`](hardware/tools/load_blueprint_tool.py:15)
**Current:** overrides [`get_schema()`](hardware/tools/load_blueprint_tool.py:77) to require `blueprint_name`.

**Edit:**
1. Delete [`LoadBlueprintTool.get_schema()`](hardware/tools/load_blueprint_tool.py:77).
2. Add override [`LoadBlueprintTool.schema_parameters()`](hardware/tools/load_blueprint_tool.py:15) returning:
   - `type: object`
   - `properties.blueprint_name` (string, same description)
   - `required: [blueprint_name]`
   - (Optional) `additionalProperties: False`

### D) [`SaveProfileTool`](hardware/tools/save_profile_tool.py:11)
**Current:** overrides [`get_schema()`](hardware/tools/save_profile_tool.py:43).

**Edit:**
1. Delete [`SaveProfileTool.get_schema()`](hardware/tools/save_profile_tool.py:43).
2. Add override [`SaveProfileTool.schema_parameters()`](hardware/tools/save_profile_tool.py:11) returning:
   - `type: object`
   - `properties.name`, `properties.email`
   - `required: []`
   - (Optional) `additionalProperties: False`

### E) Remove trivial `get_schema()` overrides
For each of these, delete the method body entirely; no replacement needed because [`BaseTool.get_schema()`](hardware/core/base_tool.py:157) already provides the same behavior.
- [`LiveAssistanceTool.get_schema()`](hardware/tools/live_assistance_tool.py:35)
- [`QuitTool.get_schema()`](hardware/tools/quit_tool.py:25)
- [`SmartModeTool.get_schema()`](hardware/tools/smart_mode_tool.py:27)
- [`ViewStatsTool.get_schema()`](hardware/tools/view_stats_tool.py:92)

## (3) Ensure compatibility with tool execution/registry

### Registry compatibility
- Registry uses [`ToolRegistry.get_tool_schemas()`](hardware/core/tool_registry.py:104) → `tool.get_schema()`.
- After changes, tools will fall back to [`BaseTool.get_schema()`](hardware/core/base_tool.py:157), which uses the tool’s `name`, `description`, and [`schema_parameters()`](hardware/core/base_tool.py:149).

### Tool execution compatibility
- Execution does not use `get_schema()`.
- Optional arg validation uses [`_get_tool_schema()`](hardware/core/tool_execution.py:66), which calls `tool.schema_parameters()`.
- Moving schema definitions into `schema_parameters()` improves correctness: the runner and schema share a single source.

### Behavioral equivalence requirement
For each modified tool, the resulting output of `tool.get_schema()` must remain equivalent to current behavior (same parameter names/types/descriptions/required).

## (4) Tests to add/adjust (pytest)

### Add new test file
Create [`hardware/tests/test_tool_schemas.py`](hardware/tests/test_tool_schemas.py) covering:

1. **Representative tool that formerly overrode `get_schema()`**
   - Use [`ApplyThemeTool`](hardware/tools/apply_theme_tool.py:30) (or another from the list) as the representative.
   - Assert `ApplyThemeTool().get_schema()` has:
     - `type == function`
     - `function.name == apply_theme`
     - `function.parameters.type == object`
     - `function.parameters.properties` contains `primary`, `secondary`, `background`
     - `function.parameters.required == []`

2. **Tool with required field (schema_parameters-driven)**
   - Use [`LoadBlueprintTool`](hardware/tools/load_blueprint_tool.py:15).
   - Assert required list includes `blueprint_name`.

3. **Tool already standard (baseline)**
   - Use [`CreateBlueprintTool`](hardware/tools/create_blueprint_tool.py:13).
   - Assert required includes `blueprint_name` and `theme`/`profile` are objects.

4. **Registry integration: schemas are stable and come from `get_schema()`**
   - Instantiate [`ToolRegistry`](hardware/core/tool_registry.py:26), register tools, and verify:
     - `registry.get_tool_schemas()` returns list of dicts
     - each dict includes `function.parameters.properties` keys expected
     - ordering is deterministic (alphabetical by tool name) per [`get_tool_schemas()`](hardware/core/tool_registry.py:104)

### Optional: runner validation alignment (small targeted test)
If there is already a pattern for enabling `TOOL_ARG_VALIDATION_ENABLED`, add a test that:
- sets env var true,
- invokes [`ToolCallExecutor.execute_tool_call()`](hardware/core/tool_execution.py:235) with an invalid type for one schema field,
- asserts it fails with `ValidationError`.

This is optional because Fix 4 scope is schema standardization; only include if test suite patterns exist and it’s low-risk.

## (5) Pytest commands
Run from repo root (workspace `d:/Code/JARVIS`).

- Full hardware test suite:
  - `python -m pytest -q`

- Only schema tests:
  - `python -m pytest -q hardware/tests/test_tool_schemas.py`

- Only tests referencing tool registry + schema behavior:
  - `python -m pytest -q -k schema`

## Execution checklist
- Update each tool per above edits.
- Add/adjust tests.
- Run pytest commands.
- Confirm no schema drift: compare old vs new schema key sets and required fields.
