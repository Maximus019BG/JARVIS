import hashlib
import json
from datetime import datetime
from typing import List, Dict, Optional, Literal
from pathlib import Path

from core.network.http_client import HttpClient, ApiError
from core.sync.config_manager import SyncConfigManager
from core.sync.offline_queue import OfflineQueue
from core.sync.conflict_resolver import ConflictResolver

class SyncError(Exception):
    """Raised when sync operation fails"""
    pass

class SyncManager:
    """Manages blueprint synchronization with server"""
    
    def __init__(self, http_client: HttpClient, device_token: str, device_id: str):
        self.http = http_client
        self.device_token = device_token
        self.device_id = device_id
        self.config = SyncConfigManager()
        self.offline_queue = OfflineQueue()
        self.conflict_resolver = ConflictResolver(self.config)
    
    async def sync_to_server(self) -> List[Dict]:
        """Sync blueprints to server - view latest updates"""
        try:
            params = {'since': self.config.get_last_sync_timestamp()}
            
            response = await self.http.get(
                '/api/workstation/blueprint/sync',
                params=params,
                device_id=self.device_id,
                device_token=self.device_token
            )
            
            self.config.update_last_sync_timestamp()
            return response.get('blueprints', [])
        
        except Exception as e:
            self.offline_queue.add('sync', {})
            raise SyncError(f"Sync failed: {e}")
    
    async def send_blueprint(self, blueprint_path: str) -> Dict:
        """Send a local blueprint to the server"""
        blueprint_data = self._load_blueprint(blueprint_path)
        blueprint_hash = self._calculate_hash(blueprint_data)
        idempotency_key = f"{blueprint_data['id']}_{blueprint_data.get('version', 1)}"
        
        payload = {
            'blueprintId': blueprint_data['id'],
            'name': blueprint_data['name'],
            'data': blueprint_data.get('data', {}),
            'version': blueprint_data.get('version', 1),
            'hash': blueprint_hash,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        try:
            response = await self.http.post(
                '/api/workstation/blueprint/push',
                data=payload,
                device_id=self.device_id,
                device_token=self.device_token,
                idempotency_key=idempotency_key
            )
            
            self._update_blueprint_version(blueprint_path, response['version'])
            return response
        
        except Exception as e:
            self.offline_queue.add('push', {
                'blueprint_path': blueprint_path,
                'payload': payload
            })
            raise SyncError(f"Send failed: {e}")
    
    async def update_blueprint(self, blueprint_id: str) -> Dict:
        """Pull and apply server updates to a local blueprint"""
        local_version = self._get_local_blueprint_version(blueprint_id)
        
        payload = {
            'blueprintId': blueprint_id,
            'localVersion': local_version
        }
        
        try:
            response = await self.http.post(
                '/api/workstation/blueprint/pull',
                data=payload,
                device_id=self.device_id,
                device_token=self.device_token
            )
            
            self._save_blueprint(blueprint_id, response['blueprint'])
            return response
        
        except Exception as e:
            self.offline_queue.add('pull', {
                'blueprint_id': blueprint_id,
                'local_version': local_version
            })
            raise SyncError(f"Update failed: {e}")
    
    async def resolve_conflict(self, blueprint_id: str, resolution: Literal['server', 'local', 'merge']) -> Dict:
        """Resolve a sync conflict"""
        local_data = self._load_blueprint_data(blueprint_id)
        server_data = await self._get_server_blueprint_data(blueprint_id)
        
        payload = {
            'blueprintId': blueprint_id,
            'resolution': resolution,
            'localData': local_data,
            'serverData': server_data
        }
        
        response = await self.http.post(
            '/api/workstation/blueprint/resolve',
            data=payload,
            device_id=self.device_id,
            device_token=self.device_token
        )
        
        self._save_blueprint(blueprint_id, response)
        return response
    
    async def process_offline_queue(self) -> List[Dict]:
        """Process queued offline operations"""
        results = []
        
        while not self.offline_queue.is_empty():
            operation = self.offline_queue.pop()
            
            try:
                if operation['type'] == 'sync':
                    result = await self.sync_to_server()
                elif operation['type'] == 'push':
                    result = await self.send_blueprint(operation['data']['blueprint_path'])
                elif operation['type'] == 'pull':
                    result = await self.update_blueprint(operation['data']['blueprint_id'])
                
                results.append({'operation': operation['type'], 'success': True, 'result': result})
            
            except Exception as e:
                self.offline_queue.add(operation['type'], operation['data'])
                results.append({'operation': operation['type'], 'success': False, 'error': str(e)})
        
        return results
    
    def _load_blueprint(self, blueprint_path: str) -> Dict:
        """Load blueprint from file"""
        with open(blueprint_path, 'r') as f:
            return json.load(f)
    
    def _load_blueprint_data(self, blueprint_id: str) -> Dict:
        """Load blueprint data by ID"""
        blueprints_dir = Path('data/blueprints')
        
        for blueprint_file in blueprints_dir.glob('*.json'):
            try:
                with open(blueprint_file, 'r') as f:
                    data = json.load(f)
                    if data.get('id') == blueprint_id:
                        return data
            except:
                continue
        
        return {}
    
    async def _get_server_blueprint_data(self, blueprint_id: str) -> Dict:
        """Get blueprint data from server"""
        payload = {
            'blueprintId': blueprint_id,
            'localVersion': 0
        }
        
        response = await self.http.post(
            '/api/workstation/blueprint/pull',
            data=payload,
            device_id=self.device_id,
            device_token=self.device_token
        )
        
        return response.get('blueprint', {})
    
    def _save_blueprint(self, blueprint_id: str, blueprint_data: Dict):
        """Save blueprint to file"""
        blueprints_dir = Path('data/blueprints')
        blueprints_dir.mkdir(parents=True, exist_ok=True)
        
        blueprint_file = blueprints_dir / f"{blueprint_id}.json"
        
        with open(blueprint_file, 'w') as f:
            json.dump(blueprint_data, f, indent=2)
    
    def _update_blueprint_version(self, blueprint_path: str, version: int):
        """Update blueprint version in file"""
        with open(blueprint_path, 'r') as f:
            data = json.load(f)
        
        data['version'] = version
        
        with open(blueprint_path, 'w') as f:
            json.dump(data, f, indent=2)
    
    def _get_local_blueprint_version(self, blueprint_id: str) -> int:
        """Get local blueprint version"""
        data = self._load_blueprint_data(blueprint_id)
        return data.get('version', 0)
    
    def _calculate_hash(self, data: Dict) -> str:
        """Calculate SHA-256 hash of blueprint data"""
        data_str = json.dumps(data, sort_keys=True)
        return hashlib.sha256(data_str.encode()).hexdigest()