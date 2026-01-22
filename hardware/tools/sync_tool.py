from typing import Dict, Any
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class SyncTool(BaseTool):
    """Chat tool for syncing blueprints to server"""
    
    name = "sync_blueprints"
    description = "Sync blueprints to the server to view latest updates"
    
    def __init__(self):
        super().__init__()
        self.security = SecurityManager()
        self.http_client = HttpClient(
            base_url='https://api.jarvis.example.com',
            security_manager=self.security
        )
        self.device_token = self.security.load_device_token()
        self.device_id = self.security.load_device_id()
        self.sync_manager = SyncManager(self.http_client, self.device_token, self.device_id)
    
    async def execute(self, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute the sync operation"""
        try:
            blueprints = await self.sync_manager.sync_to_server()
            
            return {
                "success": True,
                "message": f"Synced {len(blueprints)} blueprints",
                "blueprints": [
                    {
                        "id": bp['id'],
                        "name": bp['name'],
                        "version": bp['version'],
                        "syncStatus": bp['syncStatus'],
                        "lastModified": bp['lastModified']
                    }
                    for bp in blueprints
                ]
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Sync failed: {str(e)}"
            }