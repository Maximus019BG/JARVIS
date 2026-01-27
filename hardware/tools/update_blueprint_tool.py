from typing import Dict, Any
from config.config import get_config
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class UpdateBlueprintTool(BaseTool):
    """Chat tool for updating blueprints from server"""
    
    name = "update_blueprint"
    description = "Update a local blueprint from the server. Requires blueprint_id parameter."
    
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
    
    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the update operation"""
        blueprint_id = params.get('blueprint_id')
        
        if not blueprint_id:
            return {
                "success": False,
                "message": "blueprint_id is required"
            }
        
        try:
            result = await self.sync_manager.update_blueprint(blueprint_id)
            
            return {
                "success": True,
                "message": f"Updated blueprint: {result['blueprint']['name']}",
                "blueprintId": result['blueprint']['id'],
                "name": result['blueprint']['name'],
                "version": result['blueprint']['version'],
                "lastModified": result['blueprint']['lastModified']
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Update failed: {str(e)}"
            }