from typing import Dict, Any
from core.sync.config_manager import SyncConfigManager
from core.sync.offline_queue import OfflineQueue
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class SyncStatusTool(BaseTool):
    """Chat tool for viewing sync status"""
    
    name = "sync_status"
    description = "View current sync status and configuration"
    
    def __init__(self):
        super().__init__()
        self.config = SyncConfigManager()
        self.queue = OfflineQueue()
        self.security = SecurityManager()
    
    async def execute(self, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute status operation"""
        device_registered = self.security.is_device_registered()
        last_sync = self.config.get_last_sync_timestamp()
        
        return {
            "success": True,
            "status": {
                "device_registered": device_registered,
                "device_id": self.security.load_device_id() if device_registered else None,
                "last_sync": last_sync,
                "sync_interval_minutes": self.config.get_sync_interval(),
                "conflict_resolution": self.config.get_conflict_resolution(),
                "auto_resolution_strategy": self.config.get_auto_resolution_strategy(),
                "offline_enabled": self.config.is_offline_enabled(),
                "queue_size": len(self.queue.queue),
                "queue_enabled": self.config.is_offline_enabled()
            }
        }