"""Execute code tool for running Python and Node.js code safely.

Provides sandboxed code execution with:
- Multi-language support (Python, Node.js)
- Execute inline code or code from files
- Timeout limits
- Output capture
- Error handling
"""

from __future__ import annotations

import ast
import asyncio
import hashlib
import io
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import traceback
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError, ToolResult
from core.llm.provider_factory import LLMProviderFactory

logger = get_logger(__name__)


# File extensions to language mapping
EXTENSION_TO_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".sh": "bash",
    ".bash": "bash",
}


# ============================================================================
# SECURITY: AST-based Python code analyzer for sandbox bypass prevention
# ============================================================================


@dataclass(frozen=True)
class SecurityAnalysisResult:
    """Result of a security analysis."""

    verdict: str  # "safe" | "dangerous" | "unknown"
    reason: str


class PythonASTSecurityAnalyzer(ast.NodeVisitor):
    """Hybrid security analyzer for Python code.

    New approach:
    1) Fast pre-checks for obviously malicious intent (block immediately)
    2) AST feature extraction (what dangerous capabilities are requested)
    3) AI-based decision for ambiguous code (allows legit `os`, `open`, etc.)
    4) Hash-based cache to avoid repeated LLM calls

    Notes:
    - This does *not* remove the runtime sandbox restrictions in [`ExecuteCodeTool._execute_python()`](hardware/tools/execute_code_tool.py:772).
      It only improves the *classification* so benign usage patterns aren't auto-blocked.
    - If AI analysis fails (provider unavailable / timeout / exception), we fall back to conservative blocking
      only when the pre-check indicates obvious maliciousness; otherwise we mark as unknown and allow the
      existing sandbox to enforce runtime restrictions.
    """

    # Quick denylist for code that is almost always malicious in this environment.
    # Keep this small and high-confidence to avoid false positives.
    QUICK_DENY_PATTERNS: tuple[re.Pattern[str], ...] = (
        re.compile(r"\\brm\\s+-rf\\b", re.IGNORECASE),
        re.compile(r"\\bmkfs\\.", re.IGNORECASE),
        re.compile(r"\\bdd\\s+if=", re.IGNORECASE),
        re.compile(r"\\bshutdown\\b", re.IGNORECASE),
        re.compile(r"\\breboot\\b", re.IGNORECASE),
        re.compile(r"\\bos\\.system\\s*\\(", re.IGNORECASE),
        re.compile(
            r"\\bsubprocess\\.(run|popen|call|check_output)\\s*\\(", re.IGNORECASE
        ),
        re.compile(r"\\beval\\s*\\(", re.IGNORECASE),
        re.compile(r"\\bexec\\s*\\(", re.IGNORECASE),
        re.compile(r"__subclasses__\\s*\\(", re.IGNORECASE),
        re.compile(r"__globals__", re.IGNORECASE),
        re.compile(r"__builtins__", re.IGNORECASE),
    )

    # Protected targets for file modifications (project + configs + critical system files).
    # This is used only as a *validation* step; we can't intercept actual OS writes, but we
    # can block code that clearly intends to modify protected paths.
    PROTECTED_SYSTEM_PATH_TOKENS: tuple[str, ...] = (
        "/etc/",
        "/proc/",
        "/sys/",
        "C:\\Windows\\",
        "C:\\Program Files",
        "C:\\Program Files (x86)",
    )

    PROTECTED_CONFIG_FILENAMES: tuple[str, ...] = (
        ".env",
        ".env.local",
        "pyproject.toml",
        "uv.lock",
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "requirements.txt",
        "poetry.lock",
        "docker-compose.yml",
        "Dockerfile",
        "Makefile",
        "next.config.js",
        "tsconfig.json",
        "eslint.config.js",
        "prettier.config.js",
    )

    def __init__(
        self,
        allowed_modules: set[str] | None = None,
        project_root: Path | None = None,
        ai_timeout_seconds: float = 2.5,
        enable_ai: bool = True,
        cache_max_entries: int = 512,
    ):
        self.violations: list[str] = []
        self.allowed_modules = allowed_modules or set()
        self.project_root = (project_root or Path.cwd()).resolve()
        self.ai_timeout_seconds = ai_timeout_seconds
        self.enable_ai = enable_ai

        # Simple in-memory LRU-ish cache using dict insertion order.
        # Key: sha256(code + allowed_modules + analyzer_version)
        self._cache_max_entries = cache_max_entries
        self._analysis_cache: dict[str, SecurityAnalysisResult] = {}

        # These are filled during AST walk
        self._imports: set[str] = set()
        self._calls: set[str] = set()
        self._string_literals: list[str] = []

    # -------------------------
    # AST feature extraction
    # -------------------------

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._imports.add(alias.name.split(".")[0])
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            self._imports.add(node.module.split(".")[0])
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            # e.g. os.system, subprocess.run
            root = None
            if isinstance(node.func.value, ast.Name):
                root = node.func.value.id
            if root:
                name = f"{root}.{node.func.attr}"
        if name:
            self._calls.add(name)
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str) and node.value:
            # Limit literal collection to keep prompts tiny
            if len(self._string_literals) < 30:
                self._string_literals.append(node.value)
        self.generic_visit(node)

    # -------------------------
    # Fast checks / protection
    # -------------------------

    def _hash_key(self, code: str) -> str:
        version = "v2-ai-hybrid"
        allowed = ",".join(sorted(self.allowed_modules))
        payload = f"{version}\\n{allowed}\\n{code}".encode("utf-8", errors="ignore")
        return hashlib.sha256(payload).hexdigest()

    def _cache_get(self, key: str) -> SecurityAnalysisResult | None:
        res = self._analysis_cache.get(key)
        if res is None:
            return None
        # refresh LRU
        self._analysis_cache.pop(key, None)
        self._analysis_cache[key] = res
        return res

    def _cache_set(self, key: str, res: SecurityAnalysisResult) -> None:
        self._analysis_cache[key] = res
        if len(self._analysis_cache) > self._cache_max_entries:
            # pop oldest
            self._analysis_cache.pop(next(iter(self._analysis_cache)))

    def _quick_precheck(self, code: str) -> list[str]:
        normalized = code
        violations: list[str] = []
        for pat in self.QUICK_DENY_PATTERNS:
            if pat.search(normalized):
                violations.append(f"Obvious dangerous pattern: {pat.pattern}")
        return violations

    def _is_protected_path(self, raw: str) -> bool:
        if not raw:
            return False

        # Normalize common path forms
        s = raw.strip().strip("\"'")
        s_norm = s.replace("\\\\", "/")

        # System locations
        for token in self.PROTECTED_SYSTEM_PATH_TOKENS:
            if token.replace("\\\\", "/") in s_norm:
                return True

        # Config filenames anywhere
        base = Path(s).name
        if base in self.PROTECTED_CONFIG_FILENAMES:
            return True

        # Project source protection: any *.py under project root
        try:
            p = Path(s)
            if not p.is_absolute():
                p = (self.project_root / p).resolve()
            else:
                p = p.resolve()

            if p.suffix.lower() == ".py":
                try:
                    p.relative_to(self.project_root)
                    return True
                except ValueError:
                    pass
        except Exception:
            # If path can't be resolved, don't treat it as protected here.
            return False

        return False

    def _file_operation_violations(self) -> list[str]:
        """Detect obvious attempts to modify protected files via string literals.

        This is a best-effort check; attackers can obfuscate paths.
        """
        writey_calls = {
            "open",
            "pathlib.Path.write_text",
            "pathlib.Path.write_bytes",
            "os.remove",
            "os.unlink",
            "os.rmdir",
            "shutil.rmtree",
            "shutil.move",
            "shutil.copy",
            "shutil.copyfile",
            "subprocess.run",
            "subprocess.Popen",
            "os.system",
        }

        if not (self._calls & writey_calls) and not any(
            "open" in c for c in self._calls
        ):
            return []

        violations: list[str] = []
        for lit in self._string_literals:
            if self._is_protected_path(lit):
                violations.append(f"Attempted access to protected path: {lit!r}")
        return violations

    # -------------------------
    # AI analysis
    # -------------------------

    async def _ai_security_verdict(self, code: str) -> SecurityAnalysisResult:
        """Ask the configured LLM to classify code as safe/dangerous.

        The prompt is intentionally lightweight for speed.
        """
        provider = LLMProviderFactory.create_with_fallback()

        # Keep payload small; include only features + full code (bounded)
        code_snippet = (
            code if len(code) <= 4000 else code[:4000] + "\n# ... truncated ..."
        )

        features = {
            "imports": sorted(self._imports),
            "calls": sorted(self._calls)[:30],
            "string_literals_sample": self._string_literals[:10],
        }

        prompt = (
            "You are a security classifier for a sandboxed Python execution tool. "
            "Decide if the user's code is malicious or safe. "
            "Allowed: normal scripting, reading simple files, using os/pathlib for path manipulation. "
            "Dangerous: attempts to execute shell commands, spawn processes, modify project source/config, "
            "exfiltrate data over network, escalate privileges, or evade sandbox (dunder/introspection).\n\n"
            "Return ONLY one line, exactly: SAFE or DANGEROUS.\n\n"
            f"FEATURES: {features}\n\n"
            f"CODE:\n```python\n{code_snippet}\n```\n"
        )

        try:
            resp = await asyncio.wait_for(
                provider.chat_with_tools(prompt, tools=[], conversation_history=None),
                timeout=self.ai_timeout_seconds,
            )
            content = ""
            if isinstance(resp, dict):
                content = resp.get("message", {}).get("content", "").strip()
            verdict = content.splitlines()[0].strip().upper() if content else ""
            if verdict == "SAFE":
                return SecurityAnalysisResult("safe", "AI classified as SAFE")
            if verdict == "DANGEROUS":
                return SecurityAnalysisResult("dangerous", "AI classified as DANGEROUS")
            return SecurityAnalysisResult(
                "unknown", f"AI returned unexpected output: {content!r}"
            )
        except asyncio.TimeoutError:
            return SecurityAnalysisResult("unknown", "AI analysis timed out")
        except Exception as e:
            return SecurityAnalysisResult(
                "unknown", f"AI analysis failed: {type(e).__name__}: {e}"
            )

    # -------------------------
    # Public API
    # -------------------------

    def analyze(self, code: str) -> list[str]:
        """Analyze code and return list of security violations.

        Contract preserved: returns list of human-readable violation strings.
        """
        self.violations = []

        cache_key = self._hash_key(code)
        cached = self._cache_get(cache_key)
        if cached is not None:
            if cached.verdict == "dangerous":
                return [cached.reason]
            return []

        # 1) Quick pre-check
        pre = self._quick_precheck(code)
        if pre:
            res = SecurityAnalysisResult("dangerous", "; ".join(pre))
            self._cache_set(cache_key, res)
            return pre

        # 2) AST parse + feature extraction
        self._imports = set()
        self._calls = set()
        self._string_literals = []
        try:
            tree = ast.parse(code)
            self.visit(tree)
        except SyntaxError:
            # Syntax errors are handled during execution; for security, proceed with best-effort.
            tree = None

        # 3) File protection check (best-effort)
        fp = self._file_operation_violations()
        if fp:
            res = SecurityAnalysisResult("dangerous", "; ".join(fp))
            self._cache_set(cache_key, res)
            return fp

        # 4) AI analysis for ambiguous cases (optional)
        if self.enable_ai:
            try:
                verdict = asyncio.run(self._ai_security_verdict(code))
            except RuntimeError:
                # If we're already in an event loop, fall back to sync-safe path.
                verdict = SecurityAnalysisResult(
                    "unknown", "AI analysis skipped (event loop already running)"
                )

            if verdict.verdict == "dangerous":
                self._cache_set(cache_key, verdict)
                return [verdict.reason]

            # SAFE/UNKNOWN => allow execution; runtime sandbox still applies.
            self._cache_set(cache_key, verdict)
            return []

        # AI disabled
        self._cache_set(
            cache_key, SecurityAnalysisResult("unknown", "AI analysis disabled")
        )
        return []


# ============================================================================
# SECURITY: Improved bash command analyzer
# ============================================================================


def analyze_bash_security(code: str) -> list[str]:
    """Analyze bash code for security vulnerabilities.

    Uses multiple techniques to detect dangerous patterns:
    - Direct pattern matching for common dangerous commands
    - Shell command parsing to detect command chaining
    - Detection of obfuscation attempts
    """
    violations = []

    # Normalize the code for analysis
    normalized = code.lower()

    # Dangerous commands and patterns
    dangerous_patterns = [
        # File system destruction
        r"rm\s+-rf\s+[\/~]",
        r"rm\s+-rf\s+\.",
        r"dd\s+if=",
        r"mkfs\.",
        r"format\s+[a-z]:",
        # Fork bombs
        r":\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;",
        # Direct device access
        r">\s*\/dev\/sda",
        r">\s*\/dev\/sd[b-z]",
        # Permission escalation
        r"chmod\s+777\s+[\/~]",
        r"chown\s+root",
        # Command substitution for bypass
        r"\$\([^)]*\)",  # $(command)
        r"`[^`]*`",  # `command`
        # Pipe to dangerous commands
        r"\|\s*sh\b",
        r"\|\s*bash\b",
        r"\|\s*python\b",
        # Background execution
        r"&\s*$",
        r"nohup\b",
        # Network operations
        r"nc\s+-l",
        r"netcat\s+-l",
        r"wget\s+.*\|",
        r"curl\s+.*\|",
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, normalized, re.MULTILINE):
            violations.append(f"Detected dangerous pattern: {pattern}")

    # Check for command chaining that could bypass simple checks
    if ";" in code and any(cmd in normalized for cmd in ["rm", "dd", "mkfs", "chmod"]):
        violations.append("Command chaining with dangerous commands detected")

    # Check for variable substitution that could hide commands
    if re.search(r"\$\{[^}]+\}", code):
        violations.append("Variable substitution detected (potential obfuscation)")

    # Check for base64 encoded commands
    if "base64" in normalized and ("-d" in normalized or "--decode" in normalized):
        violations.append("Base64 decoding detected (potential command obfuscation)")

    return violations


# ============================================================================
# SECURITY: Improved JavaScript code analyzer
# ============================================================================


def analyze_javascript_security(code: str) -> list[str]:
    """Analyze JavaScript code for security vulnerabilities.

    Detects dangerous patterns including:
    - Direct require calls to dangerous modules
    - Indirect require through variables
    - String concatenation to bypass detection
    - eval and Function constructors
    - Process manipulation
    """

    # Normalize for basic checks
    normalized = code.lower()
    violations: list[str] = []

    # Dangerous modules
    dangerous_modules = [
        "child_process",
        "fs",
        "net",
        "http",
        "https",
        "dgram",
        "cluster",
        "worker_threads",
        "vm",
        "os",
        "path",
        "util",
        "crypto",
        "tls",
        "url",
        "querystring",
        "stream",
    ]

    def _direct_require_patterns(module: str) -> tuple[str, str, str]:
        # Check single quotes, double quotes, and backticks.
        return (
            f"require('{module}')",
            f'require("{module}")',
            f"require(`{module}`)",
        )

    # Check for direct require calls
    for module in dangerous_modules:
        for pattern in _direct_require_patterns(module):
            if pattern in normalized:
                violations.append(f"Direct require of dangerous module: {module}")

    # Check for indirect require through variables
    if re.search(r"require\s*\(\s*[^'\"`]", normalized):
        violations.append("Indirect require call detected (variable-based)")

    # Check for string concatenation in require
    if re.search(r"require\s*\(\s*['\"`].*[\+\$]", normalized):
        violations.append("String concatenation in require (obfuscation attempt)")

    # Check for eval and Function
    if re.search(r"\beval\s*\(", normalized):
        violations.append("Use of eval() detected")

    if re.search(r"new\s+function\s*\(", normalized):
        violations.append("Use of Function constructor detected")

    # Check for process manipulation
    if re.search(r"process\.(exit|kill|chdir|env)", normalized):
        violations.append("Process manipulation detected")

    # Check for global object manipulation
    if re.search(r"global\s*\[", normalized):
        violations.append("Global object manipulation detected")

    # Check for Buffer usage (potential for shellcode)
    if re.search(r"new\s+buffer\s*\(", normalized):
        violations.append("Buffer constructor detected (potential shellcode)")

    # Check for atob/btoa (base64 encoding/decoding for obfuscation)
    if re.search(r"\b(atob|btoa)\s*\(", normalized):
        violations.append("Base64 encoding/decoding detected (potential obfuscation)")

    return violations


class ExecuteCodeTool(BaseTool):
    """Tool for executing Python and Node.js code.

    Runs code in a restricted environment with output capture.
    Supports Python (sandboxed) and Node.js (subprocess).
    Can execute inline code or code from files.
    """

    SUPPORTED_LANGUAGES = [
        "python",
        "javascript",
        "node",
        "js",
        "typescript",
        "ts",
        "bash",
        "shell",
        "sh",
    ]

    def __init__(
        self,
        timeout: int = 30,
        allowed_modules: list[str] | None = None,
        allowed_paths: list[str] | None = None,
    ) -> None:
        self.timeout = timeout
        self.allowed_modules = allowed_modules or [
            "math",
            "json",
            "datetime",
            "re",
            "collections",
            "itertools",
            "functools",
            "random",
            "statistics",
            "string",
            "textwrap",
        ]
        # Paths where file execution is allowed (default: current directory)
        self.allowed_paths = [Path(p).resolve() for p in (allowed_paths or ["."])]
        self._node_available = shutil.which("node") is not None
        self._ts_node_available = (
            shutil.which("ts-node") is not None or shutil.which("npx") is not None
        )
        self._bash_available = shutil.which("bash") is not None

    @property
    def name(self) -> str:
        return "execute_code"

    @property
    def description(self) -> str:
        langs = ["Python"]
        if self._node_available:
            langs.append("Node.js")
        if self._bash_available:
            langs.append("Bash")
        return (
            f"Execute {', '.join(langs)} code and return the output. "
            "Can run inline code or execute code from a file path. "
            "Use for calculations, data processing, running scripts, or testing code snippets."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Code to execute (inline code string)",
                },
                "file_path": {
                    "type": "string",
                    "description": "Path to a code file to execute (alternative to inline code)",
                },
                "language": {
                    "type": "string",
                    "description": "Programming language: 'python', 'javascript', 'typescript', 'bash'. Auto-detected from file extension if not specified.",
                    "enum": [
                        "python",
                        "javascript",
                        "node",
                        "js",
                        "typescript",
                        "ts",
                        "bash",
                        "shell",
                        "sh",
                    ],
                    "default": "python",
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Command-line arguments to pass to the script (for file execution)",
                },
                "capture_output": {
                    "type": "boolean",
                    "description": "Whether to capture and return print output",
                    "default": True,
                },
            },
            "required": [],
        }

    def execute(
        self,
        code: str = "",
        file_path: str = "",
        language: str = "",
        args: list[str] | None = None,
        capture_output: bool = True,
    ) -> ToolResult:
        """Execute code from inline string or file.

        Args:
            code: Inline code to run.
            file_path: Path to a code file to execute.
            language: Programming language (auto-detected from file if not specified).
            args: Command-line arguments for file execution.
            capture_output: Whether to capture stdout/stderr.

        Returns:
            A structured [`ToolResult`](hardware/core/base_tool.py:1).
        """
        # Determine if we're executing a file or inline code
        if file_path:
            out = self._execute_file(file_path, language, args or [])
            return ToolResult.ok_result(out)
        if code.strip():
            language = language.lower() if language else "python"

            if language in ("javascript", "node", "js"):
                out = self._execute_javascript(code)
                return ToolResult.ok_result(out)
            if language in ("typescript", "ts"):
                out = self._execute_typescript(code)
                return ToolResult.ok_result(out)
            if language in ("bash", "shell", "sh"):
                out = self._execute_bash(code)
                # Security violations return a human message; treat as failure.
                if out.startswith("Security violation detected:"):
                    return ToolResult.fail(out, error_type="SecurityViolation")
                return ToolResult.ok_result(out)
            if language == "python":
                out = self._execute_python(code, capture_output)
                if out.startswith("Security violation detected:"):
                    return ToolResult.fail(out, error_type="SecurityViolation")
                # Execution errors are returned as strings; treat as failure.
                if out.startswith("Execution error:"):
                    return ToolResult.fail(out, error_type="ExecutionError")
                return ToolResult.ok_result(out)

            return ToolResult.fail(
                f"Unsupported language: {language}. Supported: {', '.join(self.SUPPORTED_LANGUAGES)}",
                error_type="ValidationError",
            )

        return ToolResult.fail(
            "Please provide either 'code' (inline code) or 'file_path' (path to a script file).",
            error_type="ValidationError",
        )

    def _is_path_allowed(self, file_path: Path) -> bool:
        """Check if a file path is within allowed directories.

        Args:
            file_path: Path to check.

        Returns:
            True if path is allowed.
        """
        resolved = file_path.resolve()
        for allowed in self.allowed_paths:
            try:
                resolved.relative_to(allowed)
                return True
            except ValueError:
                continue
        return False

    def _execute_file(
        self,
        file_path: str,
        language: str = "",
        args: list[str] | None = None,
    ) -> str:
        """Execute code from a file.

        Args:
            file_path: Path to the code file.
            language: Programming language (auto-detected if not specified).
            args: Command-line arguments to pass.

        Returns:
            Execution output or error message.
        """
        path = Path(file_path)

        # Check if file exists
        if not path.exists():
            return f"File not found: {file_path}"

        if not path.is_file():
            return f"Not a file: {file_path}"

        # Security check: verify path is in allowed directories
        if not self._is_path_allowed(path):
            return f"Access denied: {file_path} is not in an allowed directory"

        # Auto-detect language from extension if not specified
        if not language:
            ext = path.suffix.lower()
            language = EXTENSION_TO_LANGUAGE.get(ext, "")
            if not language:
                return f"Could not auto-detect language for extension '{ext}'. Please specify the language parameter."

        language = language.lower()
        args = args or []

        # Execute based on language
        try:
            if language == "python":
                return self._execute_python_file(path, args)
            elif language in ("javascript", "node", "js"):
                return self._execute_javascript_file(path, args)
            elif language in ("typescript", "ts"):
                return self._execute_typescript_file(path, args)
            elif language in ("bash", "shell", "sh"):
                return self._execute_bash_file(path, args)
            else:
                return f"Unsupported language for file execution: {language}"
        except Exception as e:
            logger.error(f"File execution failed: {e}")
            return f"Execution failed: {e}"

    def _execute_python_file(self, path: Path, args: list[str]) -> str:
        """Execute a Python file.

        Args:
            path: Path to the Python file.
            args: Command-line arguments.

        Returns:
            Execution output.
        """
        try:
            result = subprocess.run(
                ["python3", str(path)] + args,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=path.parent,
            )
            return self._format_subprocess_result(result, f"Python file: {path.name}")
        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"Python file execution failed: {e}") from e

    def _execute_javascript_file(self, path: Path, args: list[str]) -> str:
        """Execute a JavaScript file with Node.js.

        Args:
            path: Path to the JS file.
            args: Command-line arguments.

        Returns:
            Execution output.
        """
        if not self._node_available:
            return (
                "Node.js is not available. Install Node.js to execute JavaScript files."
            )

        try:
            result = subprocess.run(
                ["node", str(path)] + args,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=path.parent,
            )
            return self._format_subprocess_result(
                result, f"JavaScript file: {path.name}"
            )
        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"JavaScript file execution failed: {e}") from e

    def _execute_typescript_file(self, path: Path, args: list[str]) -> str:
        """Execute a TypeScript file.

        Args:
            path: Path to the TS file.
            args: Command-line arguments.

        Returns:
            Execution output.
        """
        # Try ts-node first, then npx ts-node
        if shutil.which("ts-node"):
            cmd = ["ts-node", str(path)] + args
        elif shutil.which("npx"):
            cmd = ["npx", "ts-node", str(path)] + args
        else:
            return "TypeScript execution requires ts-node. Install with: npm install -g ts-node typescript"

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=path.parent,
            )
            return self._format_subprocess_result(
                result, f"TypeScript file: {path.name}"
            )
        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"TypeScript file execution failed: {e}") from e

    def _execute_bash_file(self, path: Path, args: list[str]) -> str:
        """Execute a Bash script.

        Args:
            path: Path to the script.
            args: Command-line arguments.

        Returns:
            Execution output.
        """
        if not self._bash_available:
            return "Bash is not available on this system."

        try:
            result = subprocess.run(
                ["bash", str(path)] + args,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=path.parent,
            )
            return self._format_subprocess_result(result, f"Bash script: {path.name}")
        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"Bash script execution failed: {e}") from e

    def _format_subprocess_result(
        self, result: subprocess.CompletedProcess, context: str = ""
    ) -> str:
        """Format subprocess result into readable output.

        Args:
            result: Subprocess result.
            context: Description of what was executed.

        Returns:
            Formatted output string.
        """
        output_parts = []

        if context:
            output_parts.append(f"**{context}**")

        if result.stdout:
            output_parts.append(f"**Output:**\n```\n{result.stdout.strip()}\n```")

        if result.stderr:
            label = "Errors" if result.returncode != 0 else "Warnings"
            output_parts.append(f"**{label}:**\n```\n{result.stderr.strip()}\n```")

        if result.returncode != 0:
            output_parts.append(f"**Exit code:** {result.returncode}")

        if not output_parts or (not result.stdout and not result.stderr):
            output_parts.append("✓ Executed successfully (no output)")

        return "\n\n".join(output_parts)

    def _execute_typescript(self, code: str) -> str:
        """Execute TypeScript code using ts-node.

        Args:
            code: TypeScript code to run.

        Returns:
            Code output or error message.
        """
        if not self._ts_node_available:
            return "TypeScript execution requires ts-node. Install with: npm install -g ts-node typescript"

        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".ts",
                delete=False,
                encoding="utf-8",
            ) as f:
                f.write(code)
                temp_file = f.name

            try:
                if shutil.which("ts-node"):
                    cmd = ["ts-node", temp_file]
                else:
                    cmd = ["npx", "ts-node", temp_file]

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                )
                return self._format_subprocess_result(result)
            finally:
                Path(temp_file).unlink(missing_ok=True)

        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"TypeScript execution failed: {e}") from e

    def _execute_bash(self, code: str) -> str:
        """Execute Bash code.

        Args:
            code: Bash code to run.

        Returns:
            Code output or error message.
        """
        if not self._bash_available:
            return "Bash is not available on this system."

        # SECURITY: Use improved bash security analyzer
        # This detects dangerous patterns including obfuscation attempts
        violations = analyze_bash_security(code)
        if violations:
            return "Security violation detected:\n" + "\n".join(
                f"  - {v}" for v in violations
            )

        try:
            result = subprocess.run(
                ["bash", "-c", code],
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
            return self._format_subprocess_result(result)
        except subprocess.TimeoutExpired:
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            raise ToolError(f"Bash execution failed: {e}") from e

    def _execute_javascript(self, code: str) -> str:
        """Execute JavaScript code using Node.js.

        Args:
            code: JavaScript code to run.

        Returns:
            Code output or error message.
        """
        if not self._node_available:
            return (
                "Node.js is not available. Install Node.js to execute JavaScript code."
            )

        # SECURITY: Use improved JavaScript security analyzer
        # This detects dangerous patterns including obfuscation attempts
        violations = analyze_javascript_security(code)
        if violations:
            return "Security violation detected:\n" + "\n".join(
                f"  - {v}" for v in violations
            )

        try:
            # Create a temporary file for the code
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".js",
                delete=False,
                encoding="utf-8",
            ) as f:
                f.write(code)
                temp_file = f.name

            try:
                result = subprocess.run(
                    ["node", temp_file],
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                )

                output_parts = []

                if result.stdout:
                    output_parts.append(f"**Output:**\n```\n{result.stdout}\n```")

                if result.stderr:
                    output_parts.append(f"**Errors:**\n```\n{result.stderr}\n```")

                if result.returncode != 0:
                    output_parts.append(f"**Exit code:** {result.returncode}")

                if not output_parts:
                    output_parts.append("Code executed successfully (no output)")

                logger.info(f"Executed JavaScript code ({len(code)} chars)")
                return "\n\n".join(output_parts)

            finally:
                # Clean up temp file
                Path(temp_file).unlink(missing_ok=True)

        except subprocess.TimeoutExpired:
            logger.warning("JavaScript execution timed out")
            return f"Execution timed out after {self.timeout} seconds"
        except Exception as e:
            logger.error(f"JavaScript execution failed: {e}")
            raise ToolError(f"JavaScript execution failed: {e}") from e

    def _execute_python(self, code: str, capture_output: bool = True) -> str:
        """Execute Python code in a sandboxed environment.

        Args:
            code: Python code to run.
            capture_output: Whether to capture stdout/stderr.

        Returns:
            Code output or error message.
        """

        # SECURITY: Hybrid analyzer (fast pre-check + AST feature extraction + AI verdict + cache).
        # This reduces false positives vs. the old denylist-style AST scanner by allowing legitimate
        # use of modules like `os`/`pathlib` when intent is benign.
        analyzer = PythonASTSecurityAnalyzer(
            allowed_modules=set(self.allowed_modules),
            project_root=Path(".").resolve(),
            ai_timeout_seconds=2.5,
            enable_ai=True,
        )
        violations = analyzer.analyze(code)
        if violations:
            return "Security violation detected:\n" + "\n".join(
                f"  - {v}" for v in violations
            )

        # SECURITY: Create restricted globals with whitelist-only approach
        # Only include safe builtins - removed dangerous ones like __import__, getattr, setattr, hasattr
        restricted_globals = {
            "__builtins__": {
                # Safe builtins for data operations
                "print": print,
                "len": len,
                "range": range,
                "enumerate": enumerate,
                "zip": zip,
                "map": map,
                "filter": filter,
                "sorted": sorted,
                "reversed": reversed,
                "all": all,
                "any": any,
                # Type constructors
                "list": list,
                "dict": dict,
                "set": set,
                "tuple": tuple,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                # Type checking
                "type": type,
                "isinstance": isinstance,
                "issubclass": issubclass,
                # Math operations
                "abs": abs,
                "min": min,
                "max": max,
                "sum": sum,
                "round": round,
                "pow": pow,
                "divmod": divmod,
                # Character operations
                "ord": ord,
                "chr": chr,
                "hex": hex,
                "bin": bin,
                "oct": oct,
                # String formatting
                "format": format,
                "repr": repr,
                # Iteration
                "iter": iter,
                "next": next,
                "slice": slice,
                # Constants
                "True": True,
                "False": False,
                "None": None,
                # Common exceptions (read-only)
                "Exception": Exception,
                "ValueError": ValueError,
                "TypeError": TypeError,
                "KeyError": KeyError,
                "IndexError": IndexError,
                "AttributeError": AttributeError,
                "ZeroDivisionError": ZeroDivisionError,
                "RuntimeError": RuntimeError,
                "NameError": NameError,
            }
        }

        # Import allowed modules
        for module_name in self.allowed_modules:
            try:
                restricted_globals[module_name] = __import__(module_name)
            except ImportError:
                pass

        # Capture output
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        try:
            if capture_output:
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    exec(code, restricted_globals)
            else:
                exec(code, restricted_globals)

            stdout_output = stdout_capture.getvalue()
            stderr_output = stderr_capture.getvalue()

            result_parts = []
            if stdout_output:
                result_parts.append(f"Output:\n{stdout_output}")
            if stderr_output:
                result_parts.append(f"Errors:\n{stderr_output}")

            if not result_parts:
                result_parts.append("Code executed successfully (no output)")

            logger.info(f"Executed code ({len(code)} chars)")
            return "\n".join(result_parts)

        except Exception as e:
            error_msg = f"Execution error: {type(e).__name__}: {e}\n"
            error_msg += traceback.format_exc()
            logger.warning(f"Code execution failed: {e}")
            return error_msg


class AnalyzeCodeTool(BaseTool):
    """Tool for analyzing Python code structure."""

    @property
    def name(self) -> str:
        return "analyze_code"

    @property
    def description(self) -> str:
        return (
            "Analyze Python code structure. Returns information about "
            "classes, functions, imports, and complexity."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python code to analyze",
                },
            },
            "required": ["code"],
        }

    def execute(self, code: str = "") -> ToolResult:
        """Analyze code structure.

        Args:
            code: Python code to analyze.

        Returns:
            A structured [`ToolResult`](hardware/core/base_tool.py:1).
        """
        if not code.strip():
            return ToolResult.fail(
                "Please provide code to analyze.", error_type="ValidationError"
            )

        try:
            import ast

            tree = ast.parse(code)

            # Extract information
            imports = []
            functions = []
            classes = []
            variables = []

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    for alias in node.names:
                        imports.append(f"{module}.{alias.name}")
                elif isinstance(node, ast.FunctionDef):
                    args = [arg.arg for arg in node.args.args]
                    functions.append(f"{node.name}({', '.join(args)})")
                elif isinstance(node, ast.AsyncFunctionDef):
                    args = [arg.arg for arg in node.args.args]
                    functions.append(f"async {node.name}({', '.join(args)})")
                elif isinstance(node, ast.ClassDef):
                    bases = [
                        getattr(b, "id", getattr(b, "attr", "?")) for b in node.bases
                    ]
                    classes.append(f"{node.name}({', '.join(bases)})")
                elif isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            variables.append(target.id)

            # Count lines
            lines = code.split("\n")
            code_lines = sum(
                1 for line in lines if line.strip() and not line.strip().startswith("#")
            )

            result = [
                "## Code Analysis",
                "",
                f"**Total lines:** {len(lines)}",
                f"**Code lines:** {code_lines}",
                "",
            ]

            if imports:
                result.append("**Imports:**")
                for imp in imports:
                    result.append(f"  - {imp}")
                result.append("")

            if classes:
                result.append("**Classes:**")
                for cls in classes:
                    result.append(f"  - {cls}")
                result.append("")

            if functions:
                result.append("**Functions:**")
                for func in functions:
                    result.append(f"  - {func}")
                result.append("")

            if variables:
                result.append("**Top-level variables:**")
                for var in variables[:10]:  # Limit
                    result.append(f"  - {var}")
                result.append("")

            logger.info(f"Analyzed code ({len(code)} chars)")
            return ToolResult.ok_result("\n".join(result))

        except SyntaxError as e:
            return ToolResult.fail(
                f"Syntax error in code: {e}", error_type="SyntaxError"
            )
        except Exception as e:
            logger.error(f"Code analysis failed: {e}")
            raise ToolError(f"Analysis failed: {e}") from e
