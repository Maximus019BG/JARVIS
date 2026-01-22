from typing import Dict, Any, Literal
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class ResolveConflictTool(BaseTool):
    """Chat tool for resolving blueprint conflicts"""
    
    name = "resolve_conflict"
    description = "Resolve a sync conflict for a blueprint. Requires blueprint_id and resolution (server/local/merge)"
    
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
    
    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute conflict resolution"""
        blueprint_id = params.get('blueprint_id')
        resolution = params.get('resolution')
        
        if not blueprint_id:
            return {"success": False, "message": "blueprint_id is required"}
        
        if resolution not in ['server', 'local', 'merge']:
            return {"success": False, "message": "resolution must be 'server', 'local', or 'merge'"}
        
        try:
            result = await self.sync_manager.resolve_conflict(blueprint_id, resolution)
            
            return {
                "success": True,
                "message": f"Resolved conflict for blueprint: {result['blueprintId']}",
                "blueprintId": result['blueprintId'],
                "version": result['version']
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Resolution failed: {str(e)}"
            }