from typing import Dict, Any
from config.config import get_config
from core.sync.sync_manager import SyncManager
from core.sync.offline_queue import OfflineQueue
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class SyncQueueTool(BaseTool):
    """Chat tool for managing offline sync queue"""
    
    name = "sync_queue"
    description = "View or process the offline sync queue. Actions: view, process, clear"
    
    def __init__(self):
        super().__init__()
        self.security = SecurityManager()

        # Security: base URL is now configured via environment/config, not hardcoded.
        cfg = get_config()
        self.http_client = HttpClient(
            base_url=cfg.sync_api.base_url,
            security_manager=self.security,
        )
        self.device_token = self.security.load_device_token()
        self.device_id = self.security.load_device_id()
        self.sync_manager = SyncManager(self.http_client, self.device_token, self.device_id)
        self.queue = OfflineQueue()
    
    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute queue operations"""
        action = params.get('action', 'view')
        
        if action == 'view':
            return {
                "success": True,
                "queue_size": len(self.queue.queue),
                "operations": [
                    {
                        "type": op['type'],
                        "timestamp": op['timestamp']
                    }
                    for op in self.queue.queue
                ]
            }
        
        elif action == 'process':
            results = await self.sync_manager.process_offline_queue()
            
            return {
                "success": True,
                "message": f"Processed {len(results)} operations",
                "results": results
            }
        
        elif action == 'clear':
            self.queue.clear()
            return {
                "success": True,
                "message": "Queue cleared"
            }
        
        else:
            return {
                "success": False,
                "message": f"Unknown action: {action}"
            }