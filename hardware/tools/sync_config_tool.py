from typing import Dict, Any, Literal
from core.sync.config_manager import SyncConfigManager
from core.base_tool import BaseTool

class SyncConfigTool(BaseTool):
    """Chat tool for configuring sync settings"""
    
    name = "sync_config"
    description = "Configure blueprint sync settings. Actions: get, set_interval, set_conflict, set_strategy, set_offline"
    
    def __init__(self):
        super().__init__()
        self.config = SyncConfigManager()
    
    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute config operations"""
        action = params.get('action', 'get')
        
        if action == 'get':
            return {
                "success": True,
                "config": {
                    "sync_interval_minutes": self.config.get_sync_interval(),
                    "conflict_resolution": self.config.get_conflict_resolution(),
                    "auto_resolution_strategy": self.config.get_auto_resolution_strategy(),
                    "offline_enabled": self.config.is_offline_enabled()
                }
            }
        
        elif action == 'set_interval':
            minutes = params.get('interval')
            if minutes is None:
                return {"success": False, "message": "interval parameter is required"}
            
            self.config.set_sync_interval(minutes)
            return {
                "success": True,
                "message": f"Sync interval set to {minutes} minutes"
            }
        
        elif action == 'set_conflict':
            mode = params.get('mode')
            if mode not in ['auto', 'manual']:
                return {"success": False, "message": "mode must be 'auto' or 'manual'"}
            
            self.config.set_conflict_resolution(mode)
            return {
                "success": True,
                "message": f"Conflict resolution set to {mode}"
            }
        
        elif action == 'set_strategy':
            strategy = params.get('strategy')
            if strategy not in ['server', 'local', 'merge']:
                return {"success": False, "message": "strategy must be 'server', 'local', or 'merge'"}
            
            self.config.set_auto_resolution_strategy(strategy)
            return {
                "success": True,
                "message": f"Auto resolution strategy set to {strategy}"
            }
        
        elif action == 'set_offline':
            offline = params.get('offline')
            if offline is None:
                return {"success": False, "message": "offline parameter is required"}
            
            self.config.set_offline_enabled(bool(offline))
            return {
                "success": True,
                "message": f"Offline mode {'enabled' if offline else 'disabled'}"
            }
        
        else:
            return {
                "success": False,
                "message": f"Unknown action: {action}"
            }