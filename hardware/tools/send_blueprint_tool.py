from typing import Dict, Any
from pathlib import Path
from config.config import get_config
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager
from core.base_tool import BaseTool

class SendBlueprintTool(BaseTool):
    """Chat tool for sending blueprints to server"""
    
    name = "send_blueprint"
    description = "Send a local blueprint to the server. Provide either blueprint_path or blueprint_id."
    
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
        """Execute the send operation"""
        blueprint_path = params.get('blueprint_path')
        blueprint_id = params.get('blueprint_id')
        
        if not blueprint_path and not blueprint_id:
            return {
                "success": False,
                "message": "Either blueprint_path or blueprint_id is required"
            }
        
        if blueprint_id and not blueprint_path:
            blueprint_path = self._find_blueprint_path(blueprint_id)
            if not blueprint_path:
                return {
                    "success": False,
                    "message": f"Blueprint with ID '{blueprint_id}' not found locally"
                }
        
        try:
            result = await self.sync_manager.send_blueprint(blueprint_path)
            
            return {
                "success": True,
                "message": f"Sent blueprint: {result['blueprintId']}",
                "blueprintId": result['blueprintId'],
                "version": result['version'],
                "syncStatus": result['syncStatus']
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Send failed: {str(e)}"
            }
    
    def _find_blueprint_path(self, blueprint_id: str) -> str:
        """Find blueprint file by ID"""
        blueprints_dir = Path('data/blueprints')
        
        for blueprint_file in blueprints_dir.glob('*.json'):
            try:
                import json
                with open(blueprint_file, 'r') as f:
                    data = json.load(f)
                    if data.get('id') == blueprint_id:
                        return str(blueprint_file)
            except:
                continue
        
        return None