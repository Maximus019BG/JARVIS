"""Logging utilities for the hardware app.

This module provides deterministic stdlib logging configuration.

Design goals:
- Safe to import in tests (does not create files / directories on import).
- Works when executed from different working directories.
- Uses a small, predictable configuration surface.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Final

_DEFAULT_LOGGER_NAME: Final[str] = "hardware"


def _default_log_level() -> int:
    level = os.environ.get("HARDWARE_LOG_LEVEL", "INFO").upper().strip()
    return getattr(logging, level, logging.INFO)


def _default_log_dir() -> Path:
    # Resolve relative to repo execution cwd (intentionally). This keeps behavior
    # familiar for CLI users while being explicit.
    return Path(os.environ.get("HARDWARE_LOG_DIR", "logs")).resolve()


def configure_logging() -> None:
    """Configure logging for CLI runs.

    This is idempotent: repeated calls won't add duplicate handlers.
    """

    root = logging.getLogger()
    if root.handlers:
        return

    log_dir = _default_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)

    date = datetime.now().strftime("%Y%m%d")
    logfile = log_dir / f"hardware_{date}.log"

    logging.basicConfig(
        level=_default_log_level(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.FileHandler(logfile, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def get_logger(name: str | None = None) -> logging.Logger:
    """Return an app logger.

    Call [`hardware.app_logging.logger.configure_logging`](hardware/app_logging/logger.py)
    from CLI entrypoints before heavy use.
    """

    return logging.getLogger(name or _DEFAULT_LOGGER_NAME)
