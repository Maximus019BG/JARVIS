from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from app_logging.logger import get_logger
from core.network.http_client import HttpClient
from core.sync.config_manager import SyncConfigManager
from core.sync.conflict_resolver import ConflictResolver
from core.sync.offline_queue import OfflineQueue

logger = get_logger(__name__)


class SyncError(Exception):
    """Raised when sync operation fails."""


class SyncManager:
    """Manages blueprint synchronization with server."""

    _BLUEPRINT_EXTENSIONS = (".jarvis", ".json")

    def __init__(
        self, http_client: HttpClient, device_id: str
    ) -> None:
        self.http = http_client
        self.device_id = device_id
        self.config = SyncConfigManager()
        self.offline_queue = OfflineQueue()
        self.conflict_resolver = ConflictResolver(self.config)

    async def sync_to_server(self) -> list[dict[str, Any]]:
        """Sync blueprints to server - view latest updates."""
        try:
            params = {"since": self.config.get_last_sync_timestamp()}

            response = await self.http.get(
                "/api/workstation/blueprint/sync",
                params=params,
                device_id=self.device_id,
            )

            self.config.update_last_sync_timestamp()
            return response.get("blueprints", [])

        except Exception:
            logger.exception("Sync to server failed")
            self.offline_queue.add("sync", {})
            raise SyncError("Sync failed")

    async def send_blueprint(self, blueprint_path: str) -> dict[str, Any]:
        """Send a local blueprint to the server."""
        blueprint_data = self._load_blueprint(blueprint_path)
        if not blueprint_data.get("id"):
            raise SyncError("Blueprint missing required 'id'")
        if not blueprint_data.get("name"):
            raise SyncError("Blueprint missing required 'name'")

        blueprint_hash = self._calculate_hash(blueprint_data)
        idempotency_key = f"{blueprint_data['id']}_{blueprint_data.get('version', 1)}"

        payload = {
            "blueprintId": blueprint_data["id"],
            "name": blueprint_data["name"],
            "data": blueprint_data,
            "version": blueprint_data.get("version", 1),
            "hash": blueprint_hash,
            "timestamp": datetime.utcnow().isoformat(),
        }

        try:
            response = await self.http.post(
                "/api/workstation/blueprint/push",
                data=payload,
                device_id=self.device_id,
                idempotency_key=idempotency_key,
            )

            self._update_blueprint_version(blueprint_path, response["version"])
            return response

        except Exception:
            logger.exception("Send blueprint failed")
            self.offline_queue.add(
                "push", {"blueprint_path": blueprint_path, "payload": payload}
            )
            raise SyncError("Send failed")

    async def send_script(self, script_path: str) -> dict[str, Any]:
        """Send a local script file to the server."""
        path = Path(script_path)
        if not path.exists():
            raise SyncError(f"Script not found: {script_path}")

        source = path.read_text(encoding="utf-8")
        script_name = path.stem
        script_id = f"script_{script_name}"
        payload_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
        idempotency_key = f"{script_id}_{payload_hash}"

        payload = {
            "scriptId": script_id,
            "name": script_name,
            "language": "python",
            "source": source,
            "hash": payload_hash,
            "timestamp": datetime.utcnow().isoformat(),
        }

        try:
            return await self.http.post(
                "/api/workstation/script/push",
                data=payload,
                device_id=self.device_id,
                idempotency_key=idempotency_key,
            )
        except Exception:
            logger.exception("Send script failed")
            self.offline_queue.add(
                "script_push",
                {"script_path": str(path), "payload": payload},
            )
            raise SyncError("Script send failed")

    async def update_blueprint(self, blueprint_id: str) -> dict[str, Any]:
        """Pull and apply server updates to a local blueprint."""
        local_version = self._get_local_blueprint_version(blueprint_id)

        payload = {"blueprintId": blueprint_id, "localVersion": local_version}

        try:
            response = await self.http.post(
                "/api/workstation/blueprint/pull",
                data=payload,
                device_id=self.device_id,
            )

            self._save_blueprint(blueprint_id, response["blueprint"])
            return response

        except Exception:
            logger.exception("Update blueprint failed")
            self.offline_queue.add(
                "pull", {"blueprint_id": blueprint_id, "local_version": local_version}
            )
            raise SyncError("Update failed")

    async def resolve_conflict(
        self, blueprint_id: str, resolution: str
    ) -> dict[str, Any]:
        """Resolve a sync conflict."""
        local_data = self._load_blueprint_data(blueprint_id)
        server_data = await self._get_server_blueprint_data(blueprint_id)

        payload = {
            "blueprintId": blueprint_id,
            "resolution": resolution,
            "localData": local_data,
            "serverData": server_data,
        }

        response = await self.http.post(
            "/api/workstation/blueprint/resolve",
            data=payload,
            device_id=self.device_id,
        )

        self._save_blueprint(blueprint_id, response)
        return response

    async def process_offline_queue(self) -> list[dict[str, Any]]:
        """Process queued offline operations."""
        results: list[dict[str, Any]] = []

        while not self.offline_queue.is_empty():
            operation = self.offline_queue.pop()

            try:
                if operation["type"] == "sync":
                    result = await self.sync_to_server()
                elif operation["type"] == "push":
                    result = await self.send_blueprint(
                        operation["data"]["blueprint_path"]
                    )
                elif operation["type"] == "pull":
                    result = await self.update_blueprint(
                        operation["data"]["blueprint_id"]
                    )
                elif operation["type"] == "script_push":
                    result = await self.send_script(operation["data"]["script_path"])
                else:
                    # Unknown operation; keep it in the queue.
                    self.offline_queue.add(operation["type"], operation["data"])
                    results.append(
                        {
                            "operation": operation["type"],
                            "success": False,
                            "error": "Unknown operation type",
                        }
                    )
                    continue

                results.append(
                    {"operation": operation["type"], "success": True, "result": result}
                )

            except Exception as exc:
                logger.exception(
                    "Offline queue operation failed: %s", operation.get("type")
                )
                self.offline_queue.add(operation["type"], operation["data"])
                results.append(
                    {
                        "operation": operation["type"],
                        "success": False,
                        "error": str(exc),
                    }
                )

        return results

    def _load_blueprint(self, blueprint_path: str) -> dict[str, Any]:
        """Load blueprint from file."""
        with open(blueprint_path, encoding="utf-8") as f:
            return json.load(f)

    def _load_blueprint_data(self, blueprint_id: str) -> dict[str, Any]:
        """Load blueprint data by ID."""
        for blueprint_file in self._iter_blueprint_files():
            try:
                with open(blueprint_file, encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("id") == blueprint_id:
                        return data
            except (OSError, json.JSONDecodeError):
                logger.debug(
                    "Failed to read blueprint file %s", blueprint_file, exc_info=True
                )
                continue

        return {}

    async def _get_server_blueprint_data(self, blueprint_id: str) -> dict[str, Any]:
        """Get blueprint data from server."""
        payload = {"blueprintId": blueprint_id, "localVersion": 0}

        response = await self.http.post(
            "/api/workstation/blueprint/pull",
            data=payload,
            device_id=self.device_id,
        )

        return response.get("blueprint", {})

    def _save_blueprint(
        self, blueprint_id: str, blueprint_data: dict[str, Any]
    ) -> None:
        """Save blueprint to file."""
        blueprints_dir = Path("data/blueprints")
        blueprints_dir.mkdir(parents=True, exist_ok=True)

        blueprint_file = self._find_blueprint_file_by_id(blueprint_id)
        if blueprint_file is None:
            blueprint_file = blueprints_dir / f"{blueprint_id}.jarvis"

        with open(blueprint_file, "w", encoding="utf-8") as f:
            json.dump(blueprint_data, f, indent=2)

    def _update_blueprint_version(self, blueprint_path: str, version: int) -> None:
        """Update blueprint version in file."""
        with open(blueprint_path, encoding="utf-8") as f:
            data = json.load(f)

        data["version"] = version

        with open(blueprint_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def _get_local_blueprint_version(self, blueprint_id: str) -> int:
        """Get local blueprint version."""
        data = self._load_blueprint_data(blueprint_id)
        return int(data.get("version", 0))

    def _iter_blueprint_files(self) -> list[Path]:
        """Return blueprint files preferring .jarvis over .json."""
        blueprints_dir = Path("data/blueprints")
        if not blueprints_dir.exists():
            return []

        files: list[Path] = []
        for ext in self._BLUEPRINT_EXTENSIONS:
            files.extend(blueprints_dir.glob(f"*{ext}"))
        return files

    def _find_blueprint_file_by_id(self, blueprint_id: str) -> Path | None:
        for blueprint_file in self._iter_blueprint_files():
            try:
                with open(blueprint_file, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue

            if data.get("id") == blueprint_id:
                return blueprint_file

        return None

    def _calculate_hash(self, data: dict[str, Any]) -> str:
        """Calculate SHA-256 hash of blueprint data."""
        data_str = json.dumps(data, sort_keys=True)
        return hashlib.sha256(data_str.encode()).hexdigest()
