# Plan: Fix pytest import paths so `python -m pytest -q hardware/tests` works from repo root

## Problem statement
Running tests from the repo root via:

- [`python -m pytest -q hardware/tests`](hardware/tests/__init__.py)

fails during collection with `ModuleNotFoundError: core/config` because most application code and tests import `core.*` and `config.*` as *top-level* modules (e.g. `from core.chat_handler import ChatHandler`), but those packages actually exist at:

- [`hardware/core/`](hardware/core/__init__.py)
- [`hardware/config/`](hardware/config/__init__.py)

When pytest is invoked from the repo root, `sys.path` typically includes the repo root, not `hardware/`, so Python cannot resolve `core` / `config`.

## Options evaluated

### Option 1) Refactor into a real `hardware` package and update imports to `hardware.core...` / `hardware.config...`
**What it means**
- Ensure `hardware` is installed/importable as a package.
- Update all imports across app + tests from `core.*` → `hardware.core.*` and `config.*` → `hardware.config.*`.

**Pros**
- Clean, explicit import graph; avoids “implicit” path manipulation.
- Works consistently from any CWD once installed.
- Reduces risk of accidentally importing the wrong `core` from elsewhere on the machine.

**Cons / risks**
- Larger refactor: many files import `core.*`/`config.*` (see grep results across [`hardware/core/`](hardware/core/__init__.py) and [`hardware/tools/`](hardware/tools/__init__.py)).
- Higher chance of regressions if any dynamic imports, plugins, or string-based imports exist.
- Requires coordination with runtime entrypoints (e.g. [`hardware/app.py`](hardware/app.py)) and packaging metadata.

**Security implications**
- Positive overall: explicit `hardware.*` reduces module shadowing and import confusion.

**Maintainability**
- Best long-term, but higher short-term cost.

---

### Option 2) Add compatibility shim packages at repo root: `core/` and `config/`
**What it means**
- Create top-level packages:
  - [`core/__init__.py`](core/__init__.py:1)
  - [`config/__init__.py`](config/__init__.py:1)
- Each shim re-exports from `hardware.core` and `hardware.config`.

**Pros**
- Smallest edit surface; no changes needed in most imports.
- Tests will pass from repo root because `core`/`config` become importable.

**Cons / risks**
- Adds “dual import paths” (`core.*` and `hardware.core.*`) which can lead to subtle identity issues (two module objects if imported via different names).
- Can mask packaging problems and makes future refactors harder.
- Encourages continued use of ambiguous top-level names `core` and `config`.

**Security implications**
- Mixed:
  - Positive: avoids `sys.path` hacks.
  - Negative: top-level `core`/`config` names are common; risks accidental shadowing/conflicts if the repo root is on `PYTHONPATH` in other contexts.

**Maintainability**
- Acceptable as a short-term bridge, but technical debt.

---

### Option 3) Adjust pytest configuration to add `hardware/` to `pythonpath`
**What it means**
- Configure pytest so that running from repo root inserts `hardware/` onto `sys.path` at collection time.
- Implementation choices:
  - Prefer config-based: add `pythonpath` in pytest config.
  - Fallback: add a `conftest.py` that prepends `hardware/` to `sys.path`.

**Pros**
- Minimal code change; does not require touching existing imports.
- Keeps runtime imports unchanged; only affects test execution.
- Avoids creating ambiguous root-level packages.

**Cons / risks**
- Requires pytest to honor `pythonpath` (works via `pytest-pythonpath` plugin, or via modern pytest config only if plugin is present; plain pytest does *not* support `pythonpath` without plugin).
- A `conftest.py` sys.path tweak is an implicit hack (but scoped to tests).

**Security implications**
- Config-based approach is relatively safe.
- `sys.path` manipulation can make it easier for malicious/accidental imports if untrusted directories are added; here we only add the trusted local [`hardware/`](hardware/__init__.py) directory.

**Maintainability**
- Good pragmatic middle ground. Keeps the door open for Option 1 later.

## Chosen approach (staged)

### Stage A (now): Option 3 via `hardware/tests/conftest.py` (no external plugins)
Because we cannot assume the presence of `pytest-pythonpath` in CI/dev environments, the most reliable “minimal change” is a `conftest.py` that adds `hardware/` to `sys.path` during test collection.

This directly addresses the failure mode (imports resolve when repo root is CWD) while keeping changes isolated to tests.

### Stage B (later, optional hardening): migrate toward Option 1
Once tests are green and stable, plan a deliberate refactor to `hardware.core.*` / `hardware.config.*` and packaging cleanup.

## Concrete edits required for Stage A

1) Add [`hardware/tests/conftest.py`](hardware/tests/conftest.py:1)
- Purpose: ensure `hardware/` is on `sys.path` when pytest is run from repo root.
- Behavior:
  - Compute absolute path to the `hardware/` directory.
  - Prepend it to `sys.path` (position 0) if not already present.
  - Do not add repo root or any other directories.

Suggested content sketch (for implementation mode later):
- Use `from __future__ import annotations`.
- Use `Path(__file__).resolve()` and `.parents` to locate `hardware/`.

2) (Optional) Document this in [`hardware/README.md`](hardware/README.md:1)
- Add a testing section explaining supported invocations:
  - `python -m pytest -q hardware/tests` (from repo root)
  - `python -m pytest -q` (from inside `hardware/`)

3) (Optional) Add pytest discovery config
- If desired, create repo-root [`pytest.ini`](pytest.ini:1) to standardize options (e.g. `testpaths = hardware/tests`).
- This is not required to fix imports, but improves consistency.

## Verification
Run from repo root:

- `python -m pytest -q hardware/tests`

Expected:
- No import errors during collection.
- Tests execute normally.

## Notes / constraints compliance
- Planning only: no code changes applied in this subtask.
- Must not touch ViewStatsTool: no changes proposed to [`hardware/tools/view_stats_tool.py`](hardware/tools/view_stats_tool.py:1).

## Future refactor outline (Stage B)
If/when migrating to Option 1:

- Update imports across:
  - [`hardware/core/`](hardware/core/__init__.py)
  - [`hardware/tools/`](hardware/tools/__init__.py)
  - [`hardware/tests/`](hardware/tests/__init__.py)
- Ensure package layout is coherent:
  - confirm [`hardware/__init__.py`](hardware/__init__.py) exists (it does).
  - update entrypoints (e.g. [`hardware/app.py`](hardware/app.py)) if needed.
- Add a lint rule to forbid `from core` / `from config` imports.
