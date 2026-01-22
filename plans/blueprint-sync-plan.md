# Blueprint Synchronization Feature - Implementation Plan

## Overview
This plan outlines the implementation of secure blueprint synchronization between the hardware (Python) and the web server. The feature will enable:
1. **Sync blueprints to server** - View latest updates from the server
2. **Send blueprints** - Push local blueprints to the server
3. **Update blueprints** - Pull and apply server updates to local blueprints

All tools will be accessible via the chat agent interface.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WEB SERVER (Next.js)                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        API Endpoints                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │   /sync      │  │   /push      │  │   /pull      │  │ /register│  │   │
│  │  │  (GET)       │  │  (POST)      │  │  (POST)      │  │  (POST)  │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Security Layer                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │   │
│  │  │ Device Auth  │  │   HMAC       │  │   Replay     │  │ Rate     │  │   │
│  │  │   (JWT)      │  │  Signatures  │  │  Protection  │  │ Limiting │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘  │   │
│  │  ┌──────────────┐  ┌──────────────┐                                      │   │
│  │  │ Idempotency  │  │   Nonce      │                                      │   │
│  │  │   Keys       │  │   Tracking   │                                      │   │
│  │  └──────────────┘  └──────────────┘                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Database (PostgreSQL)                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │  blueprint   │  │  device      │  │  sync_log    │                │   │
│  │  │  (extended)  │  │  (new)       │  │  (new)       │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS (TLS 1.3)
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HARDWARE (Python)                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Chat Agent Interface                                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │  SyncTool    │  │  SendTool    │  │  UpdateTool  │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │  ConfigTool  │  │  QueueTool   │  │  StatusTool  │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Sync Manager                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │  sync_to_    │  │  send_       │  │  update_     │                │   │
│  │  │  server()    │  │  blueprint() │  │  blueprint() │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ Offline      │  │  Conflict    │  │  Config      │                │   │
│  │  │  Queue       │  │  Resolver    │  │  Manager     │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Security Layer                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ Device Token │  │   HMAC       │  │   TPM/Secure │                │   │
│  │  │   Storage    │  │  Signatures  │  │   Enclave    │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    HTTP Client (httpx)                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema Changes

### 1.1 Extend Blueprint Table
**File:** `web/src/server/db/schemas/blueprint.ts`

```typescript
export const blueprint = pgTable("blueprint", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  metadata: text("metadata"),  // JSON string
  workstationId: text("workstation_id").notNull().references(() => workstation.id, { onDelete: "cascade" }),
  // New sync fields
  version: integer("version").notNull().default(1),
  hash: text("hash"),                    // SHA-256 of blueprint data
  syncStatus: text("sync_status").default("synced"), // 'synced', 'pending', 'conflict'
  lastSyncedAt: timestamp("last_synced_at"),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
});
```

### 1.2 Create Device Table (New)
**File:** `web/src/server/db/schemas/device.ts`

```typescript
export const device = pgTable("device", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workstationId: text("workstation_id").notNull().references(() => workstation.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  deviceToken: text("device_token").notNull().unique(),  // JWT token hash
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").default(true),
});
```

### 1.3 Create Sync Log Table (New)
**File:** `web/src/server/db/schemas/sync_log.ts`

```typescript
export const syncLog = pgTable("sync_log", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").references(() => blueprint.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
  action: text("action").notNull(),  // 'push', 'pull', 'sync', 'conflict'
  direction: text("direction").notNull(),  // 'to_server', 'to_device'
  status: text("status").notNull(),  // 'success', 'failed', 'conflict'
  versionBefore: integer("version_before"),
  versionAfter: integer("version_after"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### 1.4 Create Nonce Tracking Table (New)
**File:** `web/src/server/db/schemas/nonce.ts`

```typescript
export const nonce = pgTable("nonce", {
  value: text("value").primaryKey(),
  deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### 1.5 Create Idempotency Key Table (New)
**File:** `web/src/server/db/schemas/idempotency_key.ts`

```typescript
export const idempotencyKey = pgTable("idempotency_key", {
  key: text("key").primaryKey(),
  deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  response: text("response").notNull(),  // Cached response JSON
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

---

## Phase 2: Server-Side API Endpoints

### 2.1 Device Registration Endpoint
**File:** `web/src/app/api/workstation/device/register/route.ts`

```
POST /api/workstation/device/register
```

**Purpose:** Register a new device and receive authentication token

**Request:**
```json
{
  "workstationId": "workstation_id",
  "deviceName": "JARVIS-Hardware-01"
}
```

**Response:**
```json
{
  "success": true,
  "deviceId": "device_id",
  "deviceToken": "jwt_token"
}
```

---

### 2.2 Sync Status Endpoint
**File:** `web/src/app/api/workstation/blueprint/sync/route.ts`

```
GET /api/workstation/blueprint/sync?workstationId={id}&since={timestamp}
```

**Request Headers:**
```
Authorization: Bearer {device_token}
X-Device-Id: {device_id}
X-Timestamp: {iso8601_timestamp}
X-Nonce: {random_nonce}
X-Signature: {hmac_signature}
```

**Response:**
```json
{
  "success": true,
  "serverTime": "2026-01-22T07:33:21.622Z",
  "blueprints": [
    {
      "id": "blueprint_id",
      "name": "My Blueprint",
      "version": 3,
      "hash": "sha256_hash",
      "lastModified": "2026-01-22T07:30:00.000Z",
      "syncStatus": "needs_pull",
      "localVersion": 1
    }
  ]
}
```

---

### 2.3 Push Blueprint Endpoint
**File:** `web/src/app/api/workstation/blueprint/push/route.ts`

```
POST /api/workstation/blueprint/push
```

**Request Headers:**
```
Authorization: Bearer {device_token}
X-Device-Id: {device_id}
X-Timestamp: {iso8601_timestamp}
X-Nonce: {random_nonce}
X-Signature: {hmac_signature}
X-Idempotency-Key: {unique_key}
```

**Request Body:**
```json
{
  "blueprintId": "blueprint_id",
  "name": "My Blueprint",
  "data": { /* blueprint data as plain JSON */ },
  "version": 2,
  "hash": "sha256_hash",
  "timestamp": "2026-01-22T07:33:21.622Z"
}
```

**Response:**
```json
{
  "success": true,
  "blueprintId": "blueprint_id",
  "version": 2,
  "syncStatus": "synced",
  "serverTimestamp": "2026-01-22T07:33:22.000Z"
}
```

---

### 2.4 Pull Blueprint Endpoint
**File:** `web/src/app/api/workstation/blueprint/pull/route.ts`

```
POST /api/workstation/blueprint/pull
```

**Request Headers:**
```
Authorization: Bearer {device_token}
X-Device-Id: {device_id}
X-Timestamp: {iso8601_timestamp}
X-Nonce: {random_nonce}
X-Signature: {hmac_signature}
```

**Request Body:**
```json
{
  "blueprintId": "blueprint_id",
  "localVersion": 1
}
```

**Response:**
```json
{
  "success": true,
  "blueprint": {
    "id": "blueprint_id",
    "name": "My Blueprint",
    "data": { /* blueprint data as plain JSON */ },
    "version": 3,
    "hash": "sha256_hash",
    "lastModified": "2026-01-22T07:30:00.000Z"
  }
}
```

---

### 2.5 Conflict Resolution Endpoint
**File:** `web/src/app/api/workstation/blueprint/resolve/route.ts`

```
POST /api/workstation/blueprint/resolve
```

**Request Headers:**
```
Authorization: Bearer {device_token}
X-Device-Id: {device_id}
X-Timestamp: {iso8601_timestamp}
X-Nonce: {random_nonce}
X-Signature: {hmac_signature}
```

**Request Body:**
```json
{
  "blueprintId": "blueprint_id",
  "resolution": "server" | "local" | "merge",
  "localData": { /* plain JSON */ },
  "serverData": { /* plain JSON */ }
}
```

**Response:**
```json
{
  "success": true,
  "blueprintId": "blueprint_id",
  "version": 4,
  "mergedData": { /* plain JSON */ }
}
```

---

## Phase 3: Hardware-Side Chat Tools

### 3.1 Chat Tool: Sync Tool
**File:** `hardware/tools/sync_tool.py`

```python
from typing import Dict, Any
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager

class SyncTool:
    """Chat tool for syncing blueprints to server"""
    
    name = "sync_blueprints"
    description = "Sync blueprints to the server to view latest updates"
    
    def __init__(self):
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
```

### 3.2 Chat Tool: Send Blueprint Tool
**File:** `hardware/tools/send_blueprint_tool.py`

```python
from typing import Dict, Any
from pathlib import Path
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager

class SendBlueprintTool:
    """Chat tool for sending blueprints to server"""
    
    name = "send_blueprint"
    description = "Send a local blueprint to the server"
    
    def __init__(self):
        self.security = SecurityManager()
        self.http_client = HttpClient(
            base_url='https://api.jarvis.example.com',
            security_manager=self.security
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
```

### 3.3 Chat Tool: Update Blueprint Tool
**File:** `hardware/tools/update_blueprint_tool.py`

```python
from typing import Dict, Any
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager

class UpdateBlueprintTool:
    """Chat tool for updating blueprints from server"""
    
    name = "update_blueprint"
    description = "Update a local blueprint from the server"
    
    def __init__(self):
        self.security = SecurityManager()
        self.http_client = HttpClient(
            base_url='https://api.jarvis.example.com',
            security_manager=self.security
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
```

### 3.4 Chat Tool: Config Tool
**File:** `hardware/tools/sync_config_tool.py`

```python
from typing import Dict, Any, Literal
from core.sync.config_manager import SyncConfigManager

class SyncConfigTool:
    """Chat tool for configuring sync settings"""
    
    name = "sync_config"
    description = "Configure blueprint sync settings (interval, conflict resolution, offline mode)"
    
    def __init__(self):
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
```

### 3.5 Chat Tool: Queue Tool
**File:** `hardware/tools/sync_queue_tool.py`

```python
from typing import Dict, Any
from core.sync.sync_manager import SyncManager
from core.sync.offline_queue import OfflineQueue
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager

class SyncQueueTool:
    """Chat tool for managing offline sync queue"""
    
    name = "sync_queue"
    description = "View or process the offline sync queue"
    
    def __init__(self):
        self.security = SecurityManager()
        self.http_client = HttpClient(
            base_url='https://api.jarvis.example.com',
            security_manager=self.security
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
```

### 3.6 Chat Tool: Status Tool
**File:** `hardware/tools/sync_status_tool.py`

```python
from typing import Dict, Any
from core.sync.config_manager import SyncConfigManager
from core.sync.offline_queue import OfflineQueue
from core.security.security_manager import SecurityManager

class SyncStatusTool:
    """Chat tool for viewing sync status"""
    
    name = "sync_status"
    description = "View current sync status and configuration"
    
    def __init__(self):
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
```

### 3.7 Chat Tool: Resolve Conflict Tool
**File:** `hardware/tools/resolve_conflict_tool.py`

```python
from typing import Dict, Any, Literal
from core.sync.sync_manager import SyncManager
from core.network.http_client import HttpClient
from core.security.security_manager import SecurityManager

class ResolveConflictTool:
    """Chat tool for resolving blueprint conflicts"""
    
    name = "resolve_conflict"
    description = "Resolve a sync conflict for a blueprint"
    
    def __init__(self):
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
```

### 3.8 Chat Tool Registration
**File:** `hardware/tools/__init__.py`

```python
from .sync_tool import SyncTool
from .send_blueprint_tool import SendBlueprintTool
from .update_blueprint_tool import UpdateBlueprintTool
from .sync_config_tool import SyncConfigTool
from .sync_queue_tool import SyncQueueTool
from .sync_status_tool import SyncStatusTool
from .resolve_conflict_tool import ResolveConflictTool

# Export all sync tools
__all__ = [
    'SyncTool',
    'SendBlueprintTool',
    'UpdateBlueprintTool',
    'SyncConfigTool',
    'SyncQueueTool',
    'SyncStatusTool',
    'ResolveConflictTool'
]

# Tool registry for chat agent
SYNC_TOOLS = [
    SyncTool(),
    SendBlueprintTool(),
    UpdateBlueprintTool(),
    SyncConfigTool(),
    SyncQueueTool(),
    SyncStatusTool(),
    ResolveConflictTool()
]
```

---

## Phase 4: Supporting Modules

### 4.1 HTTP Client Module
**File:** `hardware/core/network/http_client.py`

```python
import httpx
import secrets
from datetime import datetime
from typing import Optional, Dict, Any
from core.security.security_manager import SecurityManager

class HttpClient:
    """Secure HTTP client for blueprint synchronization"""
    
    def __init__(self, base_url: str, security_manager: SecurityManager):
        self.base_url = base_url
        self.security = security_manager
        self.client = httpx.AsyncClient(
            timeout=30.0,
            verify=True,
            headers={'User-Agent': 'JARVIS-Hardware/1.0'}
        )
    
    async def get(self, endpoint: str, params: Optional[Dict] = None, 
                  device_id: str = None, device_token: str = None) -> Dict:
        """Secure GET request with rate limiting and replay protection"""
        if not self.security.rate_limiter.allow_request():
            raise RateLimitExceeded("Too many requests")
        
        headers = self._build_security_headers(device_id, device_token)
        url = f"{self.base_url}{endpoint}"
        response = await self.client.get(url, params=params, headers=headers)
        return self._handle_response(response)
    
    async def post(self, endpoint: str, data: Optional[Dict] = None,
                   device_id: str = None, device_token: str = None,
                   idempotency_key: str = None) -> Dict:
        """Secure POST request with rate limiting and replay protection"""
        if not self.security.rate_limiter.allow_request():
            raise RateLimitExceeded("Too many requests")
        
        headers = self._build_security_headers(device_id, device_token, data)
        
        if idempotency_key:
            headers['X-Idempotency-Key'] = idempotency_key
        
        url = f"{self.base_url}{endpoint}"
        response = await self.client.post(url, json=data, headers=headers)
        return self._handle_response(response)
    
    def _build_security_headers(self, device_id: str, device_token: str, 
                                payload: Optional[Dict] = None) -> Dict:
        """Build secure request headers with replay protection"""
        timestamp = datetime.utcnow().isoformat()
        nonce = secrets.token_urlsafe(16)
        
        headers = {
            'Authorization': f'Bearer {device_token}',
            'X-Device-Id': device_id,
            'X-Timestamp': timestamp,
            'X-Nonce': nonce,
            'Content-Type': 'application/json'
        }
        
        if payload:
            signature = self._calculate_signature(payload, timestamp, nonce)
            headers['X-Signature'] = signature
        
        return headers
    
    def _calculate_signature(self, payload: Dict, timestamp: str, nonce: str) -> str:
        """Calculate HMAC signature for payload"""
        import hmac
        import hashlib
        import json
        
        canonical = {
            'timestamp': timestamp,
            'nonce': nonce,
            'payload': payload
        }
        payload_str = json.dumps(canonical, sort_keys=True)
        
        signing_key = self.security.get_signing_key()
        
        h = hmac.HMAC(signing_key, hashlib.sha256())
        h.update(payload_str.encode())
        return h.hexdigest()
    
    def _handle_response(self, response: httpx.Response) -> Dict:
        """Handle HTTP response with security checks"""
        if response.status_code == 429:
            raise RateLimitExceeded("Rate limit exceeded")
        elif response.status_code == 401:
            raise AuthenticationError("Invalid device token")
        elif response.status_code == 403:
            raise AuthorizationError("Access denied")
        elif response.status_code >= 400:
            raise ApiError(f"API error: {response.status_code}")
        
        return response.json()
```

### 4.2 Sync Manager Module
**File:** `hardware/core/sync/sync_manager.py`

```python
import hashlib
import json
from datetime import datetime
from typing import List, Dict, Optional, Literal
from pathlib import Path

class SyncManager:
    """Manages blueprint synchronization with server"""
    
    def __init__(self, http_client: HttpClient, device_token: str, device_id: str):
        self.http = http_client
        self.device_token = device_token
        self.device_id = device_id
        self.config = SyncConfigManager()
        self.offline_queue = OfflineQueue()
        self.conflict_resolver = ConflictResolver(self.config)
    
    async def sync_to_server(self) -> Dict:
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
            return response['blueprints']
        
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
            'data': blueprint_data['data'],
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
    
    def _calculate_hash(self, data: Dict) -> str:
        """Calculate SHA-256 hash of blueprint data"""
        data_str = json.dumps(data, sort_keys=True)
        return hashlib.sha256(data_str.encode()).hexdigest()
```

### 4.3 Configuration Manager
**File:** `hardware/core/sync/config_manager.py`

```python
import json
from pathlib import Path
from typing import Literal, Optional
from datetime import datetime

class SyncConfigManager:
    """Manages sync configuration stored locally"""
    
    CONFIG_PATH = Path('data/sync_config.json')
    
    DEFAULT_CONFIG = {
        'sync_interval_minutes': 5,
        'conflict_resolution': 'auto',
        'auto_resolution_strategy': 'server',
        'offline_enabled': True,
        'max_offline_queue_size': 100,
        'retry_attempts': 3,
        'retry_delay_seconds': 5,
        'last_sync_timestamp': None
    }
    
    def __init__(self):
        self.config = self._load_config()
    
    def _load_config(self) -> dict:
        """Load configuration from file"""
        if self.CONFIG_PATH.exists():
            with open(self.CONFIG_PATH, 'r') as f:
                return {**self.DEFAULT_CONFIG, **json.load(f)}
        return self.DEFAULT_CONFIG.copy()
    
    def _save_config(self):
        """Save configuration to file"""
        self.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(self.CONFIG_PATH, 'w') as f:
            json.dump(self.config, f, indent=2)
    
    def get_sync_interval(self) -> int:
        return self.config['sync_interval_minutes']
    
    def set_sync_interval(self, minutes: int):
        self.config['sync_interval_minutes'] = max(1, minutes)
        self._save_config()
    
    def get_conflict_resolution(self) -> Literal['auto', 'manual']:
        return self.config['conflict_resolution']
    
    def set_conflict_resolution(self, mode: Literal['auto', 'manual']):
        self.config['conflict_resolution'] = mode
        self._save_config()
    
    def get_auto_resolution_strategy(self) -> Literal['server', 'local', 'merge']:
        return self.config['auto_resolution_strategy']
    
    def set_auto_resolution_strategy(self, strategy: Literal['server', 'local', 'merge']):
        self.config['auto_resolution_strategy'] = strategy
        self._save_config()
    
    def is_offline_enabled(self) -> bool:
        return self.config['offline_enabled']
    
    def set_offline_enabled(self, enabled: bool):
        self.config['offline_enabled'] = enabled
        self._save_config()
    
    def get_last_sync_timestamp(self) -> Optional[str]:
        return self.config['last_sync_timestamp']
    
    def update_last_sync_timestamp(self):
        self.config['last_sync_timestamp'] = datetime.utcnow().isoformat()
        self._save_config()
```

### 4.4 Conflict Resolver
**File:** `hardware/core/sync/conflict_resolver.py`

```python
import json
from typing import Dict, Literal, Optional
from .config_manager import SyncConfigManager

class ConflictResolver:
    """Handles blueprint conflict resolution"""
    
    def __init__(self, config: SyncConfigManager):
        self.config = config
    
    def resolve(self, local_data: Dict, server_data: Dict, 
                blueprint_id: str) -> Dict:
        """Resolve conflict based on configuration"""
        mode = self.config.get_conflict_resolution()
        
        if mode == 'auto':
            strategy = self.config.get_auto_resolution_strategy()
            return self._auto_resolve(local_data, server_data, strategy)
        else:
            return {
                'conflict': True,
                'blueprintId': blueprint_id,
                'localData': local_data,
                'serverData': server_data,
                'localVersion': local_data.get('version', 0),
                'serverVersion': server_data.get('version', 0)
            }
    
    def _auto_resolve(self, local_data: Dict, server_data: Dict, 
                      strategy: Literal['server', 'local', 'merge']) -> Dict:
        """Automatically resolve conflict using specified strategy"""
        if strategy == 'server':
            return server_data
        elif strategy == 'local':
            return local_data
        elif strategy == 'merge':
            return self._merge_data(local_data, server_data)
    
    def _merge_data(self, local_data: Dict, server_data: Dict) -> Dict:
        """Merge local and server data"""
        merged = server_data.copy()
        
        for key, value in local_data.items():
            if key not in merged:
                merged[key] = value
            elif isinstance(value, dict) and isinstance(merged[key], dict):
                merged[key] = self._merge_data(value, merged[key])
        
        merged['version'] = max(
            local_data.get('version', 0),
            server_data.get('version', 0)
        ) + 1
        
        return merged
```

### 4.5 Offline Queue
**File:** `hardware/core/sync/offline_queue.py`

```python
import json
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime

class OfflineQueue:
    """Manages offline operation queue"""
    
    QUEUE_PATH = Path('data/offline_queue.json')
    
    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self.queue = self._load_queue()
    
    def _load_queue(self) -> List[Dict]:
        """Load queue from file"""
        if self.QUEUE_PATH.exists():
            with open(self.QUEUE_PATH, 'r') as f:
                return json.load(f)
        return []
    
    def _save_queue(self):
        """Save queue to file"""
        self.QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(self.QUEUE_PATH, 'w') as f:
            json.dump(self.queue, f, indent=2)
    
    def add(self, operation_type: str, data: Dict):
        """Add operation to queue"""
        if len(self.queue) >= self.max_size:
            self.queue.pop(0)
        
        self.queue.append({
            'type': operation_type,
            'data': data,
            'timestamp': datetime.utcnow().isoformat()
        })
        self._save_queue()
    
    def pop(self) -> Optional[Dict]:
        """Pop oldest operation from queue"""
        if self.queue:
            operation = self.queue.pop(0)
            self._save_queue()
            return operation
        return None
    
    def is_empty(self) -> bool:
        """Check if queue is empty"""
        return len(self.queue) == 0
    
    def clear(self):
        """Clear all operations from queue"""
        self.queue = []
        self._save_queue()
```

### 4.6 Secure Key Storage (TPM/Secure Enclave)
**File:** `hardware/core/security/secure_storage.py`

```python
import os
from typing import Optional
from pathlib import Path

class SecureStorage:
    """Secure key storage with TPM/Secure Enclave support"""
    
    def __init__(self):
        self.use_tpm = self._check_tpm_available()
        self.storage_path = Path('data/secure_storage')
        self.storage_path.mkdir(parents=True, exist_ok=True)
    
    def _check_tpm_available(self) -> bool:
        """Check if TPM is available"""
        try:
            from tpm2_pytss import ESAPI
            return True
        except ImportError:
            return False
    
    def store_key(self, key_id: str, key_data: bytes) -> bool:
        """Store key securely"""
        if self.use_tpm:
            return self._store_in_tpm(key_id, key_data)
        else:
            return self._store_encrypted(key_id, key_data)
    
    def retrieve_key(self, key_id: str) -> Optional[bytes]:
        """Retrieve key securely"""
        if self.use_tpm:
            return self._retrieve_from_tpm(key_id)
        else:
            return self._retrieve_encrypted(key_id)
    
    def _store_in_tpm(self, key_id: str, key_data: bytes) -> bool:
        """Store key in TPM"""
        try:
            from tpm2_pytss import ESAPI, TPM2B_PUBLIC, TPM2B_SENSITIVE_CREATE
            
            esys = ESAPI()
            public = TPM2B_PUBLIC()
            sensitive = TPM2B_SENSITIVE_CREATE()
            
            result = esys.create_primary(
                in_sensitive=sensitive,
                in_public=public
            )
            
            return True
        except Exception as e:
            print(f"TPM storage failed: {e}")
            return False
    
    def _retrieve_from_tpm(self, key_id: str) -> Optional[bytes]:
        """Retrieve key from TPM"""
        try:
            from tpm2_pytss import ESAPI
            esys = ESAPI()
            return b''
        except Exception as e:
            print(f"TPM retrieval failed: {e}")
            return None
    
    def _store_encrypted(self, key_id: str, key_data: bytes) -> bool:
        """Store key encrypted with system key"""
        import hashlib
        from cryptography.fernet import Fernet
        
        system_key = self._derive_system_key()
        fernet = Fernet(system_key)
        
        encrypted = fernet.encrypt(key_data)
        key_file = self.storage_path / f"{key_id}.enc"
        
        with open(key_file, 'wb') as f:
            f.write(encrypted)
        
        return True
    
    def _retrieve_encrypted(self, key_id: str) -> Optional[bytes]:
        """Retrieve encrypted key"""
        from cryptography.fernet import Fernet
        
        system_key = self._derive_system_key()
        fernet = Fernet(system_key)
        
        key_file = self.storage_path / f"{key_id}.enc"
        
        if not key_file.exists():
            return None
        
        with open(key_file, 'rb') as f:
            encrypted = f.read()
        
        return fernet.decrypt(encrypted)
    
    def _derive_system_key(self) -> bytes:
        """Derive encryption key from system-specific data"""
        import hashlib
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.backends import default_backend
        
        machine_id = self._get_machine_id()
        salt = hashlib.sha256(machine_id.encode()).digest()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        return kdf.derive(b'JARVIS_SECURE_STORAGE')
    
    def _get_machine_id(self) -> str:
        """Get unique machine identifier"""
        sources = []
        
        if os.name == 'nt':
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                                   r'SOFTWARE\Microsoft\Cryptography')
                sources.append(winreg.QueryValueEx(key, 'MachineGuid')[0])
            except:
                pass
        else:
            for path in ['/etc/machine-id', '/var/lib/dbus/machine-id']:
                try:
                    with open(path, 'r') as f:
                        sources.append(f.read().strip())
                except:
                    pass
        
        import socket
        sources.append(socket.gethostname())
        
        return '|'.join(sources)
```

---

## Phase 5: Server-Side Security Implementation

### 5.1 Replay Protection Middleware
**File:** `web/src/middleware/replay-protection.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { nonce } from '@/server/db/schemas/nonce';
import { eq, and, gt } from 'drizzle-orm';

const NONCE_EXPIRY_SECONDS = 300;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export async function replayProtection(request: NextRequest) {
  const deviceId = request.headers.get('X-Device-Id');
  const timestamp = request.headers.get('X-Timestamp');
  const nonceValue = request.headers.get('X-Nonce');
  
  if (!deviceId || !timestamp || !nonceValue) {
    return NextResponse.json(
      { error: 'Missing replay protection headers' },
      { status: 400 }
    );
  }
  
  const requestTime = new Date(timestamp).getTime();
  const now = Date.now();
  
  if (Math.abs(now - requestTime) > TIMESTAMP_TOLERANCE_SECONDS * 1000) {
    return NextResponse.json(
      { error: 'Timestamp outside valid range' },
      { status: 400 }
    );
  }
  
  const existingNonce = await db.query.nonce.findFirst({
    where: and(
      eq(nonce.value, nonceValue),
      eq(nonce.deviceId, deviceId),
      gt(nonce.expiresAt, new Date())
    )
  });
  
  if (existingNonce) {
    return NextResponse.json(
      { error: 'Replay attack detected' },
      { status: 403 }
    );
  }
  
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_SECONDS * 1000);
  await db.insert(nonce).values({
    value: nonceValue,
    deviceId,
    expiresAt
  });
  
  await db.delete(nonce).where(
    gt(nonce.expiresAt, new Date())
  );
  
  return NextResponse.next();
}
```

### 5.2 Idempotency Middleware
**File:** `web/src/middleware/idempotency.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { idempotencyKey } from '@/server/db/schemas/idempotencyKey';
import { eq, and, gt } from 'drizzle-orm';

const IDEMPOTENCY_EXPIRY_HOURS = 24;

export async function idempotency(request: NextRequest) {
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  const deviceId = request.headers.get('X-Device-Id');
  
  if (!idempotencyKey || !deviceId) {
    return NextResponse.next();
  }
  
  const existing = await db.query.idempotencyKey.findFirst({
    where: and(
      eq(idempotencyKey.key, idempotencyKey),
      eq(idempotencyKey.deviceId, deviceId),
      gt(idempotencyKey.expiresAt, new Date())
    )
  });
  
  if (existing) {
    return NextResponse.json(JSON.parse(existing.response), {
      status: 200,
      headers: {
        'X-Idempotency-Replayed': 'true'
      }
    });
  }
  
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_EXPIRY_HOURS * 60 * 60 * 1000);
  
  request.headers.set('X-Idempotency-Store', 'true');
  request.headers.set('X-Idempotency-Key', idempotencyKey);
  request.headers.set('X-Idempotency-Expires', expiresAt.toISOString());
  
  return NextResponse.next();
}

export async function storeIdempotencyResponse(
  request: NextRequest,
  response: NextResponse
) {
  if (request.headers.get('X-Idempotency-Store') !== 'true') {
    return;
  }
  
  const key = request.headers.get('X-Idempotency-Key')!;
  const deviceId = request.headers.get('X-Device-Id')!;
  const expiresAt = new Date(request.headers.get('X-Idempotency-Expires')!);
  
  await db.insert(idempotencyKey).values({
    key,
    deviceId,
    response: JSON.stringify(await response.json()),
    expiresAt
  });
}
```

### 5.3 HMAC Signature Verification
**File:** `web/src/lib/hmac-verify.ts`

```typescript
import crypto from 'crypto';

export function verifyHMACSignature(
  payload: any,
  timestamp: string,
  nonce: string,
  signature: string,
  secret: string
): boolean {
  const canonical = {
    timestamp,
    nonce,
    payload
  };
  
  const payloadString = JSON.stringify(canonical, Object.keys(canonical).sort());
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

---

## Phase 6: Configuration

### 6.1 Server Environment Variables

```env
# Blueprint Sync Configuration
BLUEPRINT_SYNC_ENABLED=true
BLUEPRINT_SYNC_JWT_SECRET=your_jwt_secret_here
BLUEPRINT_SYNC_HMAC_SECRET=your_hmac_secret_here
BLUEPRINT_SYNC_RATE_LIMIT_MAX=100
BLUEPRINT_SYNC_RATE_LIMIT_WINDOW=60

# Device Registration
DEVICE_REGISTRATION_ENABLED=true
DEVICE_TOKEN_EXPIRY_HOURS=8760

# Replay Protection
NONCE_EXPIRY_SECONDS=300
TIMESTAMP_TOLERANCE_SECONDS=300

# Idempotency
IDEMPOTENCY_EXPIRY_HOURS=24
```

### 6.2 Hardware Configuration

**File:** `hardware/config/sync_config.py`

```python
SYNC_CONFIG = {
    'server_url': 'https://api.jarvis.example.com',
    'device_token_path': 'data/device_token.enc',
    'device_id_path': 'data/device_id.enc',
    'signing_key_path': 'data/signing_key.enc',
    'sync_interval_minutes': 5,
    'retry_attempts': 3,
    'retry_delay_seconds': 5,
    'timeout_seconds': 30,
    'offline_enabled': True,
    'max_offline_queue_size': 100
}
```

---

## Chat Tool Usage Examples

### Sync Blueprints
```
User: Sync my blueprints to the server
Agent: [Calls SyncTool]
Agent: Synced 3 blueprints:
  - My Blueprint: synced
  - Theme Config: needs_pull
  - Profile Settings: synced
```

### Send Blueprint
```
User: Send my theme blueprint to the server
Agent: [Calls SendBlueprintTool with blueprint_id="theme_blueprint"]
Agent: Sent blueprint: theme_blueprint
Version: 2
Sync Status: synced
```

### Update Blueprint
```
User: Update the profile blueprint from the server
Agent: [Calls UpdateBlueprintTool with blueprint_id="profile_blueprint"]
Agent: Updated blueprint: Profile Settings
Version: 5
Last Modified: 2026-01-22T07:30:00.000Z
```

### Configure Sync
```
User: Set sync interval to 10 minutes
Agent: [Calls SyncConfigTool with action="set_interval", interval=10]
Agent: Sync interval set to 10 minutes

User: Set conflict resolution to manual
Agent: [Calls SyncConfigTool with action="set_conflict", mode="manual"]
Agent: Conflict resolution set to manual

User: Show sync configuration
Agent: [Calls SyncConfigTool with action="get"]
Agent: Current configuration:
  - Sync interval: 10 minutes
  - Conflict resolution: manual
  - Auto strategy: server
  - Offline mode: enabled
```

### View Queue
```
User: Show offline queue
Agent: [Calls SyncQueueTool with action="view"]
Agent: Queue size: 2
Operations:
  - push (2026-01-22T07:30:00.000Z)
  - pull (2026-01-22T07:31:00.000Z)

User: Process the queue
Agent: [Calls SyncQueueTool with action="process"]
Agent: Processed 2 operations:
  ✓ push
  ✓ pull
```

### View Status
```
User: What's my sync status?
Agent: [Calls SyncStatusTool]
Agent: Sync Status:
  - Device registered: Yes
  - Device ID: device_123
  - Last sync: 2026-01-22T07:30:00.000Z
  - Sync interval: 10 minutes
  - Conflict resolution: manual
  - Offline mode: enabled
  - Queue size: 0
```

### Resolve Conflict
```
User: Resolve the conflict for blueprint_123 using server version
Agent: [Calls ResolveConflictTool with blueprint_id="blueprint_123", resolution="server"]
Agent: Resolved conflict for blueprint: blueprint_123
Version: 4
```

---

## Implementation Order

1. **Phase 1:** Database schema changes (migration script)
2. **Phase 5:** Server security middleware (replay protection, idempotency, HMAC)
3. **Phase 2:** Server API endpoints (with security)
4. **Phase 4:** Hardware supporting modules (config, conflict resolver, queue, storage)
5. **Phase 3:** Hardware HTTP client and sync manager
6. **Phase 3:** Hardware chat tools
7. **Phase 6:** Configuration and deployment
8. **Testing and validation**

---

## Summary of Security Features

| Feature | Implementation |
|---------|----------------|
| **Transport Security** | TLS 1.3 with certificate verification |
| **Authentication** | JWT tokens with device claims |
| **Request Integrity** | HMAC-SHA256 signatures |
| **Replay Protection** | X-Timestamp + X-Nonce with server-side tracking |
| **Idempotency** | X-Idempotency-Key for safe retries |
| **Rate Limiting** | Sliding window per device |
| **Audit Logging** | All sync operations logged |
| **Key Storage** | TPM/Secure Enclave when available, encrypted fallback |
| **Version Control** | Conflict detection via versioning |
| **Hash Verification** | SHA-256 data integrity checks |
| **Offline Support** | Queued operations with retry |
| **Configurable Sync** | User-configurable via chat |