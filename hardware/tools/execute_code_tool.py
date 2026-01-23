"""Execute code tool for running Python and Node.js code safely.

Provides sandboxed code execution with:
- Multi-language support (Python, Node.js)
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


class ExecuteCodeTool(BaseTool):
    """Tool for executing Python and Node.js code.

    Runs code in a restricted environment with output capture.
    Supports Python (sandboxed) and Node.js (subprocess).
    """

    SUPPORTED_LANGUAGES = ["python", "javascript", "node", "js"]

    def __init__(
        self,
        timeout: int = 30,
        allowed_modules: list[str] | None = None,
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
        self._node_available = shutil.which("node") is not None

    @property
    def name(self) -> str:
        return "execute_code"

    @property
    def description(self) -> str:
        langs = "Python and Node.js" if self._node_available else "Python"
        return (
            f"Execute {langs} code and return the output. "
            "Use for calculations, data processing, or testing code snippets. "
            "Specify the language parameter for non-Python code."
        )

    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Code to execute",
                },
                "language": {
                    "type": "string",
                    "description": "Programming language: 'python', 'javascript' (or 'node', 'js')",
                    "enum": ["python", "javascript", "node", "js"],
                    "default": "python",
                },
                "capture_output": {
                    "type": "boolean",
                    "description": "Whether to capture and return print output",
                    "default": True,
                },
            },
            "required": ["code"],
        }

    def execute(
        self,
        code: str = "",
        language: str = "python",
        capture_output: bool = True,
    ) -> str:
        """Execute code in the specified language.

        Args:
            code: Code to run.
            language: Programming language ('python', 'javascript', 'node', 'js').
            capture_output: Whether to capture stdout/stderr.

        Returns:
            Code output or error message.
        """
        if not code.strip():
            return "Please provide code to execute."

        language = language.lower()

        if language in ("javascript", "node", "js"):
            return self._execute_javascript(code)
        elif language == "python":
            return self._execute_python(code, capture_output)
        else:
            return f"Unsupported language: {language}. Supported: {', '.join(self.SUPPORTED_LANGUAGES)}"

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
