import json
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional


class SyncConfigManager:
    """Manages sync configuration stored locally"""

    CONFIG_PATH = Path("data/sync_config.json")

    DEFAULT_CONFIG = {
        "sync_interval_minutes": 5,
        "conflict_resolution": "auto",
        "auto_resolution_strategy": "server",
        "offline_enabled": True,
        "max_offline_queue_size": 100,
        "retry_attempts": 3,
        "retry_delay_seconds": 5,
        "last_sync_timestamp": None,
    }

    def __init__(self):
        self.config = self._load_config()

    def _load_config(self) -> dict:
        """Load configuration from file"""
        if self.CONFIG_PATH.exists():
            with open(self.CONFIG_PATH, "r") as f:
                return {**self.DEFAULT_CONFIG, **json.load(f)}
        return self.DEFAULT_CONFIG.copy()

    def _save_config(self):
        """Save configuration to file"""
        self.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(self.CONFIG_PATH, "w") as f:
            json.dump(self.config, f, indent=2)

    def get_sync_interval(self) -> int:
        return self.config["sync_interval_minutes"]

    def set_sync_interval(self, minutes: int):
        self.config["sync_interval_minutes"] = max(1, minutes)
        self._save_config()

    def get_conflict_resolution(self) -> Literal["auto", "manual"]:
        return self.config["conflict_resolution"]

    def set_conflict_resolution(self, mode: Literal["auto", "manual"]):
        self.config["conflict_resolution"] = mode
        self._save_config()

    def get_auto_resolution_strategy(self) -> Literal["server", "local", "merge"]:
        return self.config["auto_resolution_strategy"]

    def set_auto_resolution_strategy(
        self, strategy: Literal["server", "local", "merge"]
    ):
        self.config["auto_resolution_strategy"] = strategy
        self._save_config()

    def is_offline_enabled(self) -> bool:
        return self.config["offline_enabled"]

    def set_offline_enabled(self, enabled: bool):
        self.config["offline_enabled"] = enabled
        self._save_config()

    def get_last_sync_timestamp(self) -> Optional[str]:
        return self.config["last_sync_timestamp"]

    def update_last_sync_timestamp(self):
        self.config["last_sync_timestamp"] = datetime.utcnow().isoformat()
        self._save_config()
