import json
from typing import Dict, Literal, Optional

from .config_manager import SyncConfigManager


class ConflictResolver:
    """Handles blueprint conflict resolution"""

    def __init__(self, config: SyncConfigManager):
        self.config = config

    def resolve(self, local_data: Dict, server_data: Dict, blueprint_id: str) -> Dict:
        """Resolve conflict based on configuration"""
        mode = self.config.get_conflict_resolution()

        if mode == "auto":
            strategy = self.config.get_auto_resolution_strategy()
            return self._auto_resolve(local_data, server_data, strategy)
        else:
            return {
                "conflict": True,
                "blueprintId": blueprint_id,
                "localData": local_data,
                "serverData": server_data,
                "localVersion": local_data.get("version", 0),
                "serverVersion": server_data.get("version", 0),
            }

    def _auto_resolve(
        self,
        local_data: Dict,
        server_data: Dict,
        strategy: Literal["server", "local", "merge"],
    ) -> Dict:
        """Automatically resolve conflict using specified strategy"""
        if strategy == "server":
            return server_data
        elif strategy == "local":
            return local_data
        elif strategy == "merge":
            return self._merge_data(local_data, server_data)

    def _merge_data(self, local_data: Dict, server_data: Dict) -> Dict:
        """Merge local and server data"""
        merged = server_data.copy()

        for key, value in local_data.items():
            if key not in merged:
                merged[key] = value
            elif isinstance(value, dict) and isinstance(merged[key], dict):
                merged[key] = self._merge_data(value, merged[key])

        merged["version"] = (
            max(local_data.get("version", 0), server_data.get("version", 0)) + 1
        )

        return merged
