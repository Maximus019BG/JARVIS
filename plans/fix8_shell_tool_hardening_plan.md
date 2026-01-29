# Fix 8 Plan — ShellTool hardening

Target: harden [`ShellCommandTool`](hardware/tools/shell_tool.py:24) in [`hardware/tools/shell_tool.py`](hardware/tools/shell_tool.py:1).

Scope constraints:
- Planning only (no code edits in this task).
- Keep scope strictly to ShellTool hardening.
- Explicitly out of scope: any ViewStatsTool cross-platform work.

Repo patterns to align with:
- Central authorization via [`SecurityManager`](hardware/core/security/security_manager.py:96) (via [`get_security_manager()`](hardware/core/security/security_manager.py:556)).
- Tool schemas via [`schema_parameters()`](hardware/tools/shell_tool.py:133).
- Structured results via `ToolResult` helpers already used in ShellTool, e.g. [`ToolResult.fail()`](hardware/tools/shell_tool.py:222).

---

## 1) Current behavior summary (baseline)

`ShellCommandTool` today:
- Accepts a single string parameter `command` and optional `working_dir` via [`schema_parameters()`](hardware/tools/shell_tool.py:133).
- Parses `command` with `shlex.split(command, posix=os.name != 'nt')` in [`_parse_and_validate_command()`](hardware/tools/shell_tool.py:149).
- Enforces:
  - blocklist first ([`BLOCKED_COMMANDS`](hardware/tools/shell_tool.py:72)), then allowlist ([`ALLOWED_COMMANDS`](hardware/tools/shell_tool.py:31)).
  - rejects shell metachar / expansions: backticks, `$(`, `${`, `&&`, `||`, `;`, newlines in [`_parse_and_validate_command()`](hardware/tools/shell_tool.py:183).
  - rejects pipes/redirection `|`, `>`, `<` in [`_parse_and_validate_command()`](hardware/tools/shell_tool.py:196).
  - blocks a few sensitive tokens as raw substrings (`/dev/`, `/proc/`, `/sys/`, `/etc/passwd`, `/etc/shadow`) in [`_parse_and_validate_command()`](hardware/tools/shell_tool.py:200).
- Validates `working_dir` with `SecurityManager.validate_path(...)` in [`execute()`](hardware/tools/shell_tool.py:207) (note: the actual method in SecurityManager appears to be [`validate_file_access()`](hardware/core/security/security_manager.py:221), so there is a likely API mismatch to resolve during implementation).
- Executes with `subprocess.run(argv, shell=False, capture_output=True, text=True, timeout=..., cwd=working_dir)` in [`execute()`](hardware/tools/shell_tool.py:245).

Hardening opportunity areas:
- The tool still accepts a raw command string, which invites ambiguous parsing (especially on Windows) and makes it hard to validate/attribute file path arguments.
- There is no explicit “sandbox cwd root” (only a validation call on `working_dir`).
- There is no SecurityManager-mediated validation for file path *arguments* (only cwd).
- No explicit controls around environment variables or executable resolution.
- Allowlist includes many commands that are not “read-only” depending on flags (e.g., `tee`, `xargs`, `awk`/`sed` can write if redirected, though redirection is blocked; still, e.g. `tee` can write to files without redirection).

---

## 2) Threat model (what we are defending against)

### 2.1 Command injection
Risks:
- Chaining and control tokens: `;`, `&&`, `||`, newlines.
- Shell expansion/substitution: `$()`, backticks, `${...}`.
- Pipe + redirection enabling hidden side effects.
- Windows-specific metacharacters and parsing quirks: `&`, `|`, `^`, `%VAR%`, `!VAR!` (delayed expansion), `\r\n`.

Goal:
- Preserve the invariant: **ShellTool never invokes a shell** (no `shell=True`, no `cmd /c`, no `bash -c`).
- Avoid interpretation contexts where metacharacters take effect.

### 2.2 Data exfiltration
Risks:
- Commands that can read arbitrary files and print them (e.g. `cat`, `head`, `tail`, `stat`, `file`).
- Commands that can enumerate environment or system info (`env`, `printenv`, `whoami`, `hostname`).
- Potential network utilities if they ever slip into allowlist (currently blocked: `curl`, `wget`, `ssh`, etc.).

Goal:
- Bound file reads to a sandbox (project directories / configured allow paths).
- Keep network-capable binaries blocked.

### 2.3 Destructive operations
Risks:
- File mutation/deletion: `rm`, `mv`, `cp`, `chmod`, `chown` etc. (currently blocked).
- Less obvious mutations: `tee` can write files; `xargs` can execute other allowed commands repeatedly; `awk`/`sed` can write to files with flags on some platforms.

Goal:
- Treat “write-capable” tools as high risk even if they appear read-only.
- Prefer a minimal allowlist for the tool’s intended use cases (diagnostics, listing, content viewing), while remaining compatible.

### 2.4 Persistence / lateral movement
Risks:
- Invoking interpreters/shells or process spawners (e.g. `sh`, `bash`, `cmd`, `powershell`, `python`, `node`).
- Writing to startup locations (Windows Startup folder, scheduled tasks), or installing services.

Goal:
- Explicitly block shells and script runtimes (even if present).
- Keep cwd and file arguments restricted to the project sandbox.

---

## 3) Proposed policy: allowlist + guardrails (Windows vs POSIX)

### 3.1 Policy stance
- Keep the current allowlist cross-OS. If an allowed command is absent on the OS, it may fail naturally.
- Maintain **allowlist-first** model; blocklist remains defense-in-depth.

### 3.2 Strengthen allowlist semantics
Add *capability tiers* (policy concept) even if represented in code as simple sets:

- Tier A (safe read-only, low risk): `ls/dir`, `pwd`, `echo`, `whoami`, `date`, `uname`, `hostname`, `which/where`.
- Tier B (reads files): `cat`, `head`, `tail`, `wc`, `stat`, `file`, `md5sum`, `sha256sum`, `diff`, `comm`, `sort`, `uniq`, `cut`, `tr`, `grep`, `find`, `tree`.
- Tier C (risky due to indirect effects): `xargs`, `tee`, `awk`, `sed`.

Recommendation:
- Default policy should allow Tier A+B.
- Tier C should be either:
  - removed from `ALLOWED_COMMANDS`, or
  - allowed only with strict argument rules (see 3.3) and preferably behind a config toggle.

### 3.3 Argument-level validation (critical hardening)
Even with `shell=False`, arguments can be used to:
- escape the sandbox by referencing sensitive paths,
- cause network access (if a tool supports it),
- cause writes (if a tool supports it).

Rules to enforce at argument level:
- Reject any arg containing control characters (`\n`, `\r`, `\0`).
- Reject shell control tokens even inside args (defense-in-depth): `;`, `&&`, `||`, `|`, `>`, `<`, backticks, `$(`, `${`.
- Reject Windows variable expansion forms if present in args (defense-in-depth): `%...%` and `!...!`.
- Reject attempts to pass `-c` or equivalent “execute string” flags for known interpreters (even if interpreter is blocked, this avoids future allowlist mistakes).

Path-typed args (see section 4) must be validated through SecurityManager.

### 3.4 Windows vs POSIX considerations
- Parsing: `shlex.split(..., posix=False)` on Windows is heuristic and differs from `cmd.exe` parsing; therefore the plan is to **stop relying on parsing a raw command string** as the primary interface.
- Command resolution:
  - Prefer resolving executable via `shutil.which(program)` during validation and block if it resolves outside expected locations (optional; see 4.4).
- Built-ins:
  - `dir` is a cmd built-in and cannot be executed without a shell; today it would fail under `subprocess.run(['dir'], shell=False)`.
  - Plan should document this and keep behavior deterministic: either accept that built-ins fail, or implement a safe built-in emulation layer. To keep scope small, accept that built-ins fail; avoid routing through `cmd /c`.

---

## 4) Integrate `SecurityManager` (sandboxing + path validation)

### 4.1 Fix/standardize SecurityManager API usage
In implementation, reconcile the apparent mismatch:
- ShellTool calls `self._security.validate_path(...)` in [`ShellCommandTool.execute()`](hardware/tools/shell_tool.py:236).
- SecurityManager exposes [`validate_file_access()`](hardware/core/security/security_manager.py:221) (and not `validate_path`).

Plan:
- Use `SecurityManager.validate_file_access(...)` consistently for filesystem paths (cwd and file args).
- If a `validate_path` convenience exists elsewhere (e.g. wrapper), route through that; otherwise update ShellTool to call the correct method.

### 4.2 Restrict working directory (cwd)
Goal: ensure commands execute only inside a sandbox.

Policy:
- If `cwd`/`working_dir` is provided: validate it via `validate_file_access()`; also ensure it is a directory.
- If not provided: default to project root (workspace) or a configured sandbox dir.

Implementation approach options:
1) Strict sandbox: force cwd to workspace root and ignore user-provided cwd unless explicitly allowed.
2) Configured sandbox: allow cwd within SecurityConfig allowed paths.

Recommendation:
- Use configured allow paths as the canonical boundary (SecurityManager already enforces it).
- Also add an explicit “project sandbox” check: require cwd to be within `Path.cwd()` (or a passed-in root) unless config is empty.

### 4.3 Validate file path arguments
Most exfiltration/destruction happens through file path args to otherwise safe tools (`cat secrets`, `grep -R /etc`).

Plan:
- Introduce a mechanism to identify which argv elements should be treated as file paths.
  - For example, for `cat/head/tail/stat/file/md5sum/sha256sum/diff/comm`: treat any arg that does not start with `-` as a candidate path.
  - For `find`: treat its start directory arg(s) as paths.
  - For `grep`: treat file operands as paths, but skip patterns.

Then:
- For each candidate path operand:
  - normalize and resolve relative to cwd,
  - validate through `validate_file_access()`.

This does not need to be perfect to be useful; it should be conservative:
- If an arg looks like a path and is outside allowed roots, block.
- If unsure, block or require explicit opt-in (prefer block for security).

### 4.4 Optional: executable path validation
To reduce risk of a user invoking a “safe-named” malicious executable from within the repo (e.g., `ls.exe` dropped in cwd):
- Resolve `argv[0]` via `shutil.which` using a restricted PATH (see 4.5) and/or by temporarily setting `env={'PATH': system_path_only}`.
- Block if resolved executable is inside the project workspace (common persistence technique).

This is optional but valuable; decide based on false-positive risk.

### 4.5 Environment restrictions
To limit leakage:
- Run subprocess with a sanitized environment:
  - start from a minimal allowlist of env vars (`PATH`, maybe `SYSTEMROOT` on Windows).
  - optionally strip secrets (`OPENAI_API_KEY`, etc.) if present.

Keep scope modest: implement a minimal env scrub and document it.

---

## 5) Schema/interface changes (safe parameterization)

### 5.1 New recommended schema (safe-by-construction)
Add new parameters while keeping legacy compatibility:

Proposed schema additions in [`ShellCommandTool.schema_parameters()`](hardware/tools/shell_tool.py:133):
- `program: string` — executable name (no spaces).
- `args: array[string]` — arguments list.
- `cwd: string` — replaces/aliases `working_dir` (keep `working_dir` as legacy alias).
- `timeout_seconds: integer` — optional per-call timeout bounded to a max.
- `max_output: integer` — optional per-call output truncation bounded to a max.

Contract:
- Exactly one of:
  - `(program + args)` OR
  - `command` (legacy)

### 5.2 Backward compatibility and deprecation
- Keep accepting `command` for now to avoid breaking callers.
- Mark `command` as deprecated in the schema description.
- In execution:
  - If `program` is provided, ignore `command`.
  - If only `command` is provided, parse it as today but apply the *same* argument validation and path validation as `(program,args)`.

Migration guidance:
- Update documentation: callers should prefer `(program,args)`.

### 5.3 Additional schema tightening
- Set `additionalProperties: False` to reduce injection via unexpected fields.
- Constrain string lengths (e.g. max 2k for args total) if schema system supports it.

---

## 6) Execution behavior changes (implementation notes)

### 6.1 Ensure no shell invocation
- Maintain `shell=False` always.
- Do not add `cmd /c` or `bash -c` wrappers.

### 6.2 Output handling
- Keep current truncation behavior in [`execute()`](hardware/tools/shell_tool.py:255).
- Consider splitting stdout/stderr into structured fields in ToolResult `error_details` later, but keep scope limited.

### 6.3 Audit logging hooks
Where feasible, add SecurityManager audit calls:
- on blocked command (policy violation)
- on blocked path arg
- on execution success/failure (without leaking stdout content into audit logs)

---

## 7) Tests strategy (pytest, deterministic)

Principles:
- Do not rely on actual OS commands existing.
- Use monkeypatch to stub subprocess calls.

### 7.1 Unit tests for validation
Create new test module (suggested): [`hardware/tests/test_shell_tool_hardening.py`](hardware/tests/test_shell_tool_hardening.py:1).

Test categories:

1) Blocks forbidden control tokens (legacy `command` path)
- Input: `echo hi && whoami` → blocked.
- Input: `echo $(whoami)` → blocked.
- Input: `echo hi | grep h` → blocked.

2) Blocks blocked commands
- Input: `rm -rf .` → blocked (and error_type ValidationError).

3) Allows allowlisted command with safe args
- Input: `echo hello` → calls `subprocess.run` with `shell=False` and argv `['echo','hello']`.

4) Validates cwd through SecurityManager
- Provide `working_dir` and monkeypatch SecurityManager to deny; assert tool returns AccessDenied and never calls subprocess.

5) Validates path arguments through SecurityManager
- Example: `cat ../../secrets.txt` should trigger validate_file_access and be denied.
- Monkeypatch validate_file_access to raise SecurityError / return deny response depending on API, and assert tool blocks.

6) Program/args interface (new schema)
- When `program='echo', args=['hi']`, it should not call `shlex.split` and should behave deterministically.

### 7.2 Subprocess monkeypatching details
- Monkeypatch `subprocess.run` to return a `subprocess.CompletedProcess(args=..., returncode=0, stdout='ok', stderr='')`.
- Add a test for timeouts: raise `subprocess.TimeoutExpired` and assert `ToolResult.fail(..., error_type='Timeout')`.

### 7.3 Regression tests
- Ensure `shell=False` is always used.
- Ensure `cwd` passed to `subprocess.run` matches validated cwd.

---

## 8) Acceptance criteria

- ShellTool rejects command-injection primitives, both in legacy `command` and new `(program,args)` forms.
- ShellTool validates cwd via [`SecurityManager.validate_file_access()`](hardware/core/security/security_manager.py:221) (or the repo’s canonical equivalent).
- ShellTool validates file/path-like arguments for the core read-oriented commands.
- ShellTool never uses `shell=True` nor wraps through `cmd.exe`/`bash`.
- Tests are deterministic and do not rely on OS command availability.

---

## 9) Implementation checklist (handoff to Code mode)

- Update [`ShellCommandTool.schema_parameters()`](hardware/tools/shell_tool.py:133) to support `program`, `args`, `cwd`, `timeout_seconds`, keep `command` and `working_dir` as deprecated aliases.
- Implement argv construction path:
  - prefer `program/args`.
  - otherwise parse legacy `command`.
- Add argument-level sanitization and a per-command path-operand validator routing through [`SecurityManager`](hardware/core/security/security_manager.py:96).
- Ensure cwd is validated and defaulted to sandbox root.
- Add/adjust tests in [`hardware/tests/test_shell_tool_hardening.py`](hardware/tests/test_shell_tool_hardening.py:1) with subprocess monkeypatch.
