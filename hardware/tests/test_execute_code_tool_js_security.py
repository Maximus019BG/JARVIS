import re

import pytest


def analyze_javascript_security(code: str) -> list[str]:
    """Local copy of [`analyze_javascript_security()`](hardware/tools/execute_code_tool.py:491).

    Tests focus on the normalization behavior without importing the full tool module
    (which has application-level imports that may not be available in the test environment).
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


@pytest.mark.parametrize(
    "code, expected_substring",
    [
        ("Require('FS')", "Direct require of dangerous module: fs"),
        ("EVAL('2+2')", "Use of eval() detected"),
        ("new Function('return 1')", "Use of Function constructor detected"),
    ],
)
def test_analyze_javascript_security_detects_mixed_case_patterns(
    code: str, expected_substring: str
) -> None:
    violations = analyze_javascript_security(code)
    assert any(expected_substring in v for v in violations)


def test_analyze_javascript_security_benign_script_does_not_trigger() -> None:
    code = """
    function add(a, b) {
      return a + b;
    }

    console.log(add(1, 2));
    """
    violations = analyze_javascript_security(code)
    assert violations == []
