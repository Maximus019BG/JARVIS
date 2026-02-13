# Fix 7 Plan: Harden ExecuteCodeTool Python sandbox defaults for unknown verdicts

## Goal
Make Python security classification **fail-closed by default** when the analyzer returns an **unknown/None/unexpected verdict**, while keeping changes minimal and compatible with existing tool/result patterns.

---

## 1) Where the verdict is produced / consumed

### Verdict production (Python analyzer)
- Verdict type is the dataclass [`SecurityAnalysisResult`](hardware/tools/execute_code_tool.py:54) with field `verdict: str  # safe | dangerous | unknown`.
- The analyzer computes verdicts in [`PythonASTSecurityAnalyzer._ai_security_verdict()`](hardware/tools/execute_code_tool.py:297):
  - Returns `safe` if AI returns exactly `SAFE`.
  - Returns `dangerous` if AI returns exactly `DANGEROUS`.
  - Returns `unknown` on unexpected output, timeout, or exceptions.
- Verdict is stored and interpreted in [`PythonASTSecurityAnalyzer.analyze()`](hardware/tools/execute_code_tool.py:353):
  - Cached `dangerous` -> violations.
  - Quick precheck/file-protection -> `dangerous` -> violations.
  - AI verdict:
    - `dangerous` -> violations.
    - **`safe` or `unknown` -> returns `[]` violations** (currently “allow”).

### Verdict consumption (ExecuteCodeTool)
- Python execution path is [`ExecuteCodeTool._execute_python()`](hardware/tools/execute_code_tool.py:1109).
- It instantiates the analyzer and calls `violations = analyzer.analyze(code)`.
- If `violations` is non-empty, execution is blocked with a string starting `Security violation detected:`.
- In top-level [`ExecuteCodeTool.execute()`](hardware/tools/execute_code_tool.py:683), strings starting with `Security violation detected:` are converted to [`ToolResult.fail()`](hardware/tools/execute_code_tool.py:725) with `error_type="SecurityViolation"`.

**Key observation:** the verdict is not directly propagated; the analyzer “consumes its own verdict” and emits only `violations`. Therefore, hardening unknown verdict handling can be done either:
1) inside [`PythonASTSecurityAnalyzer.analyze()`](hardware/tools/execute_code_tool.py:353) (preferred: single source of truth), or
2) by changing the analyzer to optionally expose its last verdict to [`ExecuteCodeTool._execute_python()`](hardware/tools/execute_code_tool.py:1109).

---

## 2) Desired default behavior for unknown/None/unexpected verdict

### Decision
- **Default must be fail-closed:** any analyzer verdict that is `unknown` (or missing/unexpected) should **block execution**.

### Interpretation rules
Treat as **unknown** (therefore block, by default) if:
- Verdict is explicitly `unknown`.
- Verdict is `None`.
- Verdict is not one of `{safe, dangerous, unknown}` (defensive coding).
- AI analysis was skipped due to event loop already running (currently mapped to `unknown`).

### Blocking semantics
- Block using existing failure conventions:
  - Return the same string format currently used by `_execute_python` violations: `Security violation detected:\n  - ...`.
  - Ensure the outer [`ExecuteCodeTool.execute()`](hardware/tools/execute_code_tool.py:723) continues to map that to `ToolResult.fail(..., error_type="SecurityViolation")`.

---

## 3) Backward-compat config flag (optional) and default

### Add a flag to Python analyzer and tool
Introduce an explicit option to keep prior behavior for teams relying on it.

- New flag name (suggested): `fail_closed_on_unknown_verdict: bool`
- Default value: `True` (hardened default)

Placement options:
- Add parameter to [`PythonASTSecurityAnalyzer.__init__()`](hardware/tools/execute_code_tool.py:130) so unit tests can toggle behavior without constructing the full tool.
- Add a matching parameter to [`ExecuteCodeTool.__init__()`](hardware/tools/execute_code_tool.py:596) and pass-through to analyzer.

Compatibility note:
- If the repo has a global config system, wire the default there later; for this fix, keep it local to the tool/analyzer to minimize blast radius.

---

## 4) Test strategy (deterministic; monkeypatch/stubs)

### Testing principles
- No real LLM calls.
- Deterministic outcomes by monkeypatching analyzer methods.
- Tests should validate behavior at the tool boundary: `ExecuteCodeTool.execute()` returns `ToolResult.ok_result` vs `ToolResult.fail` with correct `error_type`.

### Where to add tests
- Create a new test module, e.g. [`hardware/tests/test_execute_code_tool_unknown_verdict.py`](hardware/tests/test_execute_code_tool_unknown_verdict.py:1).
- Use pytest monkeypatch to replace:
  - [`PythonASTSecurityAnalyzer.analyze()`](hardware/tools/execute_code_tool.py:353) if we keep unknown-handling inside the tool, OR
  - [`PythonASTSecurityAnalyzer._ai_security_verdict()`](hardware/tools/execute_code_tool.py:297) if we keep unknown-handling inside the analyzer.

### Scenarios to cover
1) **Unknown verdict blocks execution (default)**
   - Stub AI verdict to `unknown` (or stub analyze to return a special value indicating unknown-handling path).
   - Expect `ToolResult.fail` and `error_type == "SecurityViolation"`.
   - Assert message contains `unknown verdict` (or the chosen reason string).

2) **Known-safe allows execution**
   - Stub AI verdict to `safe` (or stub analyze to return `[]`).
   - Provide minimal benign code: `print(1+1)`.
   - Expect `ToolResult.ok_result` and output contains `2`.

3) **Known-unsafe blocks execution**
   - Use a deterministic dangerous pattern caught by quick precheck, e.g. `eval("2+2")` (matches [`QUICK_DENY_PATTERNS`](hardware/tools/execute_code_tool.py:81)).
   - Expect `ToolResult.fail` with `error_type == "SecurityViolation"`.

4) **Back-compat flag allows unknown verdict (optional, if flag is added)**
   - Instantiate tool/analyzer with `fail_closed_on_unknown_verdict=False`.
   - Stub AI verdict to `unknown`.
   - Expect execution proceeds (likely OK result), confirming the switch works.

### Avoiding prior import pitfalls
- Prior tests hit `ModuleNotFoundError: core` and were fixed via stubbing in one test.
- For these new tests:
  - Prefer importing via the same paths used in existing passing tests under `hardware/tests/`.
  - If `core` is still problematic in test environment, mirror the existing stub approach at the top of the new test file (before importing the tool), rather than changing production code.

---

## 5) Minimal code changes required (and avoiding breakage)

### Minimal-change approach (preferred)
Implement fail-closed semantics **inside the analyzer**, since that is where verdict is interpreted today.

Planned edits:
1) Extend [`PythonASTSecurityAnalyzer.__init__()`](hardware/tools/execute_code_tool.py:130) with `fail_closed_on_unknown_verdict: bool = True`.
2) In [`PythonASTSecurityAnalyzer.analyze()`](hardware/tools/execute_code_tool.py:353), after AI verdict is produced (and also when AI is disabled), apply:
   - If `verdict.verdict == "dangerous"` -> violations (existing)
   - If `verdict.verdict == "safe"` -> allow (existing)
   - Else (unknown/None/unexpected) -> return a single violation string such as:
     - `"Security analysis returned unknown verdict; blocking by default: <reason>"`
   - If `fail_closed_on_unknown_verdict` is False -> treat unknown as allow (preserve old behavior).

3) Update [`ExecuteCodeTool._execute_python()`](hardware/tools/execute_code_tool.py:1109) analyzer construction to pass-through the new flag (default True). Optionally add tool-level init param.

Why this avoids breaking other modules:
- The public contract of `analyze()` remains: `list[str]` violations.
- The outer tool already translates violations into `ToolResult.fail` with existing `error_type` strings.
- No changes required to JS/Bash execution paths.

### Defensive coding notes
- Ensure cached results are handled consistently:
  - If cache stores `unknown`, the new default should block on cache hit as well (otherwise unknown verdict caching could re-enable allow).
  - Therefore, cache-hit logic in [`PythonASTSecurityAnalyzer.analyze()`](hardware/tools/execute_code_tool.py:353) should treat cached `unknown` according to `fail_closed_on_unknown_verdict`.

---

## Implementation checklist (what Code mode should do)
- [ ] Add `fail_closed_on_unknown_verdict` flag to analyzer + tool wiring.
- [ ] Update analyzer cache-hit and AI-verdict handling to fail-closed on unknown by default.
- [ ] Add deterministic pytest coverage for unknown/safe/dangerous (and back-compat flag if included).
- [ ] Ensure failures surface as `ToolResult.fail(..., error_type="SecurityViolation")` without changing other tools.
