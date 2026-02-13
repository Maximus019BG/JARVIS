"""Pytest configuration for the `hardware` test suite.

Why this file exists
--------------------
The tests under `hardware/tests` import project modules as top-level packages,
for example `core.*` and `config.*`.

The actual code lives under the `hardware/` package directory:
- `hardware/core/...`
- `hardware/config/...`

When running from the repo root (desired), Python does NOT automatically add
`<repo_root>/hardware` to `sys.path`, so importing `core` / `config` would fail.

This conftest performs a minimal, test-scoped `sys.path` adjustment during
pytest collection so those imports resolve without requiring changes to
production code.

Scope / constraints
-------------------
- Only affects the pytest process (no runtime changes for non-test entrypoints).
- Prepends the path (highest priority) to avoid accidentally importing other
  similarly named modules from elsewhere on the machine.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _prepend_hardware_dir_to_syspath() -> None:
    """Ensure `<repo_root>/hardware` is on `sys.path` for test imports."""

    # This file lives at `<repo_root>/hardware/tests/conftest.py`.
    repo_root = Path(__file__).resolve().parents[2]
    hardware_dir = repo_root / "hardware"

    # Be defensive: only add if it's a real directory and not already present.
    hardware_dir_str = str(hardware_dir)
    if hardware_dir.is_dir() and hardware_dir_str not in sys.path:
        sys.path.insert(0, hardware_dir_str)


_prepend_hardware_dir_to_syspath()
