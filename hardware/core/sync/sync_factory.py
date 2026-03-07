from __future__ import annotations

from dataclasses import dataclass

from config.config import get_config
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.sync.sync_manager import SyncManager


@dataclass(frozen=True)
class SyncStack:
    security: SecurityManager
    http_client: HttpClient
    device_id: str
    sync_manager: SyncManager


def build_sync_stack(
    *,
    security: SecurityManager | None = None,
    base_url: str | None = None,
) -> SyncStack:
    """Build the common sync stack used by multiple tools.

    Creates (or reuses) SecurityManager, configures HttpClient base_url, loads
    device token/id, and constructs SyncManager.

    Args:
        security: Optional SecurityManager to use (primarily for tests).
        base_url: Optional base URL override (primarily for tests).

    Returns:
        SyncStack containing the created objects.
    """

    sec = security or SecurityManager()

    if base_url is None:
        cfg = get_config()
        base_url = cfg.sync_api.base_url

    http_client = HttpClient(base_url=base_url, security_manager=sec)
    device_id = sec.load_device_id()
    sync_manager = SyncManager(http_client, device_id)

    return SyncStack(
        security=sec,
        http_client=http_client,
        device_id=device_id,
        sync_manager=sync_manager,
    )
