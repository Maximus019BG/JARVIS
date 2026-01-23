"""Execute code tool for running Python and Node.js code safely.

Provides sandboxed code execution with:
- Multi-language support (Python, Node.js)
- Execute inline code or code from files
- Timeout limits
- Output capture
- Error handling
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger
from core.base_tool import BaseTool, ToolError

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


class ExecuteCodeTool(BaseTool):
    """Tool for executing Python and Node.js code.

    Runs code in a restricted environment with output capture.
    Supports Python (sandboxed) and Node.js (subprocess).
    Can execute inline code or code from files.
    """

    SUPPORTED_LANGUAGES = ["python", "javascript", "node", "js", "typescript", "ts", "bash", "shell", "sh"]

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
        self._ts_node_available = shutil.which("ts-node") is not None or shutil.which("npx") is not None
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
                    "enum": ["python", "javascript", "node", "js", "typescript", "ts", "bash", "shell", "sh"],
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
    ) -> str:
        """Execute code from inline string or file.

        Args:
            code: Inline code to run.
            file_path: Path to a code file to execute.
            language: Programming language (auto-detected from file if not specified).
            args: Command-line arguments for file execution.
            capture_output: Whether to capture stdout/stderr.

        Returns:
            Code output or error message.
        """
        # Determine if we're executing a file or inline code
        if file_path:
            return self._execute_file(file_path, language, args or [])
        elif code.strip():
            language = language.lower() if language else "python"
            
            if language in ("javascript", "node", "js"):
                return self._execute_javascript(code)
            elif language in ("typescript", "ts"):
                return self._execute_typescript(code)
            elif language in ("bash", "shell", "sh"):
                return self._execute_bash(code)
            elif language == "python":
                return self._execute_python(code, capture_output)
            else:
                return f"Unsupported language: {language}. Supported: {', '.join(self.SUPPORTED_LANGUAGES)}"
        else:
            return "Please provide either 'code' (inline code) or 'file_path' (path to a script file)."

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
            return "Node.js is not available. Install Node.js to execute JavaScript files."
        
        try:
            result = subprocess.run(
                ["node", str(path)] + args,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=path.parent,
            )
            return self._format_subprocess_result(result, f"JavaScript file: {path.name}")
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
            return self._format_subprocess_result(result, f"TypeScript file: {path.name}")
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

    def _format_subprocess_result(self, result: subprocess.CompletedProcess, context: str = "") -> str:
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

        # Basic safety checks for bash
        dangerous_patterns = [
            "rm -rf /",
            "rm -rf ~",
            ":(){ :|:& };:",  # Fork bomb
            "> /dev/sda",
            "mkfs.",
            "dd if=",
            "chmod 777 /",
        ]

        for pattern in dangerous_patterns:
            if pattern in code:
                return f"Code contains restricted operation: {pattern}"

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
                "Node.js is not available. "
                "Install Node.js to execute JavaScript code."
            )

        # Basic safety checks for JS
        dangerous_patterns = [
            "require('child_process')",
            'require("child_process")',
            "require('fs')",
            'require("fs")',
            "require('net')",
            'require("net")',
            "require('http')",
            'require("http")',
            "require('https')",
            'require("https")',
            "process.exit",
            "process.kill",
            "eval(",
            "Function(",
        ]

        for pattern in dangerous_patterns:
            if pattern in code:
                return f"Code contains restricted operation: {pattern}"

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

        # Basic safety checks
        dangerous_patterns = [
            "import os",
            "import subprocess",
            "import sys",
            "__import__",
            "eval(",
            "exec(",
            "open(",
            "file(",
            "input(",
            "breakpoint(",
        ]

        code_lower = code.lower()
        for pattern in dangerous_patterns:
            if pattern in code_lower:
                return f"Code contains restricted operation: {pattern}"

        # Create restricted globals
        restricted_globals = {
            "__builtins__": {
                "print": print,
                "len": len,
                "range": range,
                "enumerate": enumerate,
                "zip": zip,
                "map": map,
                "filter": filter,
                "sorted": sorted,
                "reversed": reversed,
                "list": list,
                "dict": dict,
                "set": set,
                "tuple": tuple,
                "str": str,
                "int": int,
                "float": float,
                "bool": bool,
                "abs": abs,
                "min": min,
                "max": max,
                "sum": sum,
                "round": round,
                "pow": pow,
                "divmod": divmod,
                "isinstance": isinstance,
                "type": type,
                "hasattr": hasattr,
                "getattr": getattr,
                "setattr": setattr,
                "all": all,
                "any": any,
                "ord": ord,
                "chr": chr,
                "hex": hex,
                "bin": bin,
                "oct": oct,
                "format": format,
                "repr": repr,
                "hash": hash,
                "id": id,
                "callable": callable,
                "iter": iter,
                "next": next,
                "slice": slice,
                "object": object,
                "property": property,
                "staticmethod": staticmethod,
                "classmethod": classmethod,
                "super": super,
                "True": True,
                "False": False,
                "None": None,
                "Exception": Exception,
                "ValueError": ValueError,
                "TypeError": TypeError,
                "KeyError": KeyError,
                "IndexError": IndexError,
                "AttributeError": AttributeError,
                "ZeroDivisionError": ZeroDivisionError,
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

    def execute(self, code: str = "") -> str:
        """Analyze code structure.

        Args:
            code: Python code to analyze.

        Returns:
            Analysis results.
        """
        if not code.strip():
            return "Please provide code to analyze."

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
                        getattr(b, "id", getattr(b, "attr", "?"))
                        for b in node.bases
                    ]
                    classes.append(f"{node.name}({', '.join(bases)})")
                elif isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            variables.append(target.id)

            # Count lines
            lines = code.split("\n")
            code_lines = sum(1 for line in lines if line.strip() and not line.strip().startswith("#"))

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
            return "\n".join(result)

        except SyntaxError as e:
            return f"Syntax error in code: {e}"
        except Exception as e:
            logger.error(f"Code analysis failed: {e}")
            raise ToolError(f"Analysis failed: {e}") from e
