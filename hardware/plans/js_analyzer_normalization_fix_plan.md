# Plan: Fix JavaScript analyzer normalization bug + add tests

## 1) Exact code change(s)

Bug: [`analyze_javascript_security()`](hardware/tools/execute_code_tool.py:491) calls `code.lower()` but does not assign the result, so all subsequent substring/regex checks are case-sensitive.

### Minimal patch (single responsibility)

In [`hardware/tools/execute_code_tool.py`](hardware/tools/execute_code_tool.py:1), inside [`analyze_javascript_security()`](hardware/tools/execute_code_tool.py:491), replace:

- [`code.lower()`](hardware/tools/execute_code_tool.py:504)

with:

- [`normalized = code.lower()`](hardware/tools/execute_code_tool.py:504)

Then update all checks in this function to use `normalized` rather than `code`:

- Direct `require(...)` substring checks should search in `normalized`
- All `re.search(...)` calls should use `normalized` as the searched string

Concretely, change each of these to use `normalized`:

- [`if pattern in code:`](hardware/tools/execute_code_tool.py:536) → `if pattern in normalized:`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:540) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:544) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:548) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:551) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:555) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:559) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:563) → `re.search(..., normalized)`
- [`re.search(..., code)`](hardware/tools/execute_code_tool.py:567) → `re.search(..., normalized)`

Notes:
- Keep the rest of the logic intact (no refactors). This is strictly a normalization bugfix.
- Using `normalized` everywhere ensures mixed-case patterns are detected.

## 2) Where to add tests

Add a new test file under `hardware/tests/`:

- [`hardware/tests/test_execute_code_tool_js_security.py`](hardware/tests/test_execute_code_tool_js_security.py)

Rationale: existing tests are organized by tool/module area; this is specific to the JS security analyzer located in [`hardware/tools/execute_code_tool.py`](hardware/tools/execute_code_tool.py:1).

## 3) Test cases to prove the bug and the fix

All tests should import and call the analyzer directly:

- `from tools.execute_code_tool import analyze_javascript_security`

(Imports in tests currently use top-level package paths like `from tools.read_file_tool import ...`, so follow that convention.)

### Core regression tests (mixed-case should be caught)

1) Mixed-case `require` of dangerous module `fs`

- Input: `Require('FS')` (exact example requested)
- Expected: violations list contains at least one entry including `Direct require of dangerous module: fs`
- Why this proves the bug: pre-fix, string patterns are lowercase and compared against original `code`, so `Require('FS')` would not match.

2) Uppercase eval

- Input: `EVAL('2+2')` or `EVAL(` (example requested)
- Expected: violations includes `Use of eval() detected`
- Why this proves the bug: pre-fix, the regex `\beval\s*\(` is case-sensitive and searched in original `code`.

### Additional targeted tests (still within scope)

3) Mixed-case Function constructor

- Input: `new fUnCtIoN('return 1')`
- Expected: violations includes `Use of Function constructor detected`

4) Mixed-case process manipulation

- Input: `Process.exit(1)`
- Expected: violations includes `Process manipulation detected`

### Negative control (ensure benign code stays clean)

5) Safe snippet should not trigger

- Input: `console.log('hello')`
- Expected: `analyze_javascript_security(...) == []`

Test style:
- Use `assert any('...substring...' in v for v in violations)` rather than exact list equality, to keep tests resilient to ordering / other additions.

## 4) How to run tests in this repo (pytest commands)

This repo’s Python package for `hardware` is in the `hardware/` directory, and the dev note in [`hardware/pyproject.toml`](hardware/pyproject.toml:35) says to run tests with `python -m pytest`.

From the workspace root (`d:/Code/JARVIS`), run:

- Run all tests:
  - `python -m pytest`

- Run only the new test file:
  - `python -m pytest hardware/tests/test_execute_code_tool_js_security.py`

- Run only tests matching a keyword (optional convenience):
  - `python -m pytest -k js_security`

If import resolution requires running from the `hardware` package root, use:

- `python -m pytest -c hardware/pyproject.toml hardware/tests`

(Prefer the simplest command first; only use `-c ...` if the environment needs it.)
