# Blueprint Synchronization Communication Protocol

## Overview

This document describes the secure communication protocol between the JARVIS hardware (Python) and the web server (Next.js) for blueprint synchronization. The protocol uses REST over HTTPS with multiple layers of security to ensure data integrity, authentication, and protection against common attacks.

---

## Architecture

```
┌─────────────────┐                    ┌─────────────────┐
│   Hardware      │                    │   Web Server    │
│   (Python)      │                    │   (Next.js)     │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │  1. Device Registration              │
         │  ────────────────────────>          │
         │                                      │
         │  2. Sync Blueprints (GET)            │
         │  <───────────────────────           │
         │                                      │
         │  3. Push Blueprint (POST)            │
         │  ────────────────────────>          │
         │                                      │
         │  4. Pull Blueprint (POST)            │
         │  ────────────────────────>          │
         │                                      │
         │  5. Resolve Conflict (POST)          │
         │  ────────────────────────>          │
         │                                      │
         └──────────────────────────────────────┘
```

---

## Security Layers

### 1. Transport Layer Security (TLS 1.3)

All communication is encrypted using TLS 1.3, providing:
- **Confidentiality**: Data cannot be read by intermediaries
- **Integrity**: Data cannot be modified in transit
- **Authentication**: Server identity verification via certificates

### 2. Device Authentication (JWT)

Each hardware device receives a JWT (JSON Web Token) upon registration:

```python
# Token payload structure
{
  "deviceId": "device_abc123",
  "workstationId": "ws_xyz789",
  "userId": "user_def456",
  "iat": 1705900000,
  "exp": 1705986400
}
```

**Token Usage:**
- Sent in `Authorization: Bearer <token>` header
- Validated on every request
- Configurable expiry (default: 24 hours)

### 3. HMAC-SHA256 Signatures

Each request is signed using HMAC-SHA256 to ensure payload integrity:

```python
# Signature calculation
canonical = {
  'timestamp': '2024-01-22T10:00:00.000Z',
  'nonce': 'abc123def456',
  'payload': {...}
}
payload_str = json.dumps(canonical, sort_keys=True)
signature = hmac_sha256(signing_key, payload_str)
```

**Signature Verification:**
- Server recalculates signature using shared secret
- Compares with `X-Signature` header
- Rejects requests with mismatched signatures

### 4. Replay Protection

Prevents replay attacks using timestamp and nonce validation:

**Headers Required:**
- `X-Timestamp`: ISO 8601 timestamp (±5 minutes tolerance)
- `X-Nonce`: Cryptographically random unique value (16 bytes)
- `X-Device-Id`: Device identifier

**Validation Flow:**
```
1. Check timestamp is within ±5 minutes of current time
2. Check if nonce exists in database (within 5-minute window)
3. If nonce exists → Reject (replay attack)
4. If nonce doesn't exist → Store nonce and proceed
```

### 5. Idempotency

Ensures safe retries for failed requests:

**Headers Required:**
- `X-Idempotency-Key`: Unique key per operation (e.g., `blueprint_123_5`)

**Behavior:**
- First request: Process and store response (24-hour expiry)
- Duplicate request: Return cached response with `X-Idempotency-Replayed: true`
- Prevents duplicate operations on network failures

### 6. Rate Limiting

Prevents abuse and DoS attacks:

**Configuration:**
- 100 requests per minute per device
- Sliding window algorithm
- Returns HTTP 429 when exceeded

---

## Request Headers

Every request to the sync API must include the following headers:

| Header | Required | Description | Example |
|--------|----------|-------------|---------|
| `Authorization` | Yes | JWT device token | `Bearer eyJhbGciOiJIUzI1NiIs...` |
| `X-Device-Id` | Yes | Device identifier | `device_abc123` |
| `X-Timestamp` | Yes | ISO 8601 timestamp | `2024-01-22T10:00:00.000Z` |
| `X-Nonce` | Yes | Cryptographic nonce | `abc123def456` |
| `X-Signature` | Yes | HMAC-SHA256 signature | `a1b2c3d4e5f6...` |
| `X-Idempotency-Key` | Optional | Idempotency key | `blueprint_123_5` |
| `Content-Type` | Yes | Request content type | `application/json` |

---

## API Endpoints

### 1. Device Registration

**Endpoint:** `POST /api/workstation/device/register`

**Purpose:** Register a new hardware device and receive authentication token.

**Request Body:**
```json
{
  "deviceName": "Living Room Controller",
  "workstationId": "ws_xyz789"
}
```

**Response:**
```json
{
  "success": true,
  "deviceId": "device_abc123",
  "deviceToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2024-01-23T10:00:00.000Z"
}
```

**Security:**
- Requires user authentication (session cookie)
- Generates unique device ID
- Creates JWT token with workstation association

---

### 2. Sync Blueprints (Get Latest Updates)

**Endpoint:** `GET /api/workstation/blueprint/sync`

**Purpose:** Retrieve blueprints updated since last sync.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | string | No | ISO 8601 timestamp for incremental sync |

**Request Example:**
```http
GET /api/workstation/blueprint/sync?since=2024-01-22T09:00:00.000Z
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
X-Device-Id: device_abc123
X-Timestamp: 2024-01-22T10:00:00.000Z
X-Nonce: abc123def456
X-Signature: a1b2c3d4e5f6...
```

**Response:**
```json
{
  "success": true,
  "blueprints": [
    {
      "id": "bp_001",
      "name": "Theme Blueprint",
      "version": 5,
      "hash": "a1b2c3d4e5f6...",
      "lastModified": "2024-01-22T09:30:00.000Z",
      "syncStatus": "synced"
    }
  ],
  "serverTimestamp": "2024-01-22T10:00:00.000Z"
}
```

---

### 3. Push Blueprint (Send to Server)

**Endpoint:** `POST /api/workstation/blueprint/push`

**Purpose:** Send a local blueprint to the server.

**Request Body:**
```json
{
  "blueprintId": "bp_001",
  "name": "Theme Blueprint",
  "data": {
    "theme": "dark",
    "colors": ["#1a1a1a", "#2a2a2a"]
  },
  "version": 5,
  "hash": "a1b2c3d4e5f6...",
  "timestamp": "2024-01-22T10:00:00.000Z"
}
```

**Response (Success):**
```json
{
  "success": true,
  "blueprintId": "bp_001",
  "version": 5,
  "syncStatus": "synced",
  "serverTimestamp": "2024-01-22T10:00:01.000Z"
}
```

**Response (Conflict):**
```json
{
  "error": "Version conflict",
  "currentVersion": 6
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Missing required fields
- `401`: Invalid token or signature
- `403`: Access denied
- `409`: Version conflict
- `429`: Rate limit exceeded
- `500`: Internal server error

---

### 4. Pull Blueprint (Update from Server)

**Endpoint:** `POST /api/workstation/blueprint/pull`

**Purpose:** Retrieve a blueprint from the server.

**Request Body:**
```json
{
  "blueprintId": "bp_001",
  "localVersion": 4
}
```

**Response:**
```json
{
  "success": true,
  "blueprint": {
    "id": "bp_001",
    "name": "Theme Blueprint",
    "data": {
      "theme": "dark",
      "colors": ["#1a1a1a", "#2a2a2a"]
    },
    "version": 5,
    "hash": "a1b2c3d4e5f6...",
    "lastModified": "2024-01-22T09:30:00.000Z"
  }
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Missing blueprintId
- `401`: Invalid token or signature
- `403`: Access denied (wrong workstation)
- `404`: Blueprint not found
- `500`: Internal server error

---

### 5. Resolve Conflict

**Endpoint:** `POST /api/workstation/blueprint/resolve`

**Purpose:** Resolve a sync conflict between local and server versions.

**Request Body:**
```json
{
  "blueprintId": "bp_001",
  "resolution": "server",
  "localData": {
    "id": "bp_001",
    "name": "Theme Blueprint",
    "data": {"theme": "light"},
    "version": 5
  },
  "serverData": {
    "id": "bp_001",
    "name": "Theme Blueprint",
    "data": {"theme": "dark"},
    "version": 6
  }
}
```

**Resolution Options:**
- `server`: Use server version
- `local`: Use local version
- `merge`: Merge both versions (server-side logic)

**Response:**
```json
{
  "success": true,
  "blueprintId": "bp_001",
  "version": 7,
  "resolution": "server",
  "serverTimestamp": "2024-01-22T10:00:02.000Z"
}
```

---

## Error Handling

### Error Response Format

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `MISSING_HEADERS` | 400 | Required security headers missing |
| `INVALID_TIMESTAMP` | 400 | Timestamp outside valid range |
| `REPLAY_ATTACK` | 403 | Duplicate nonce detected |
| `INVALID_TOKEN` | 401 | JWT token invalid or expired |
| `INVALID_SIGNATURE` | 401 | HMAC signature verification failed |
| `ACCESS_DENIED` | 403 | Device not authorized for resource |
| `VERSION_CONFLICT` | 409 | Blueprint version conflict |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

### Retry Strategy

For transient errors, use exponential backoff:

```python
import asyncio

async def retry_with_backoff(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return await func()
        except (RateLimitExceeded, ApiError) as e:
            if attempt == max_retries - 1:
                raise
            wait_time = 2 ** attempt  # 1s, 2s, 4s
            await asyncio.sleep(wait_time)
```

---

## Offline Support

### Offline Queue

When the server is unreachable, operations are queued locally:

**Queue Storage:** `data/offline_queue.json`

**Queue Entry Format:**
```json
{
  "id": "queue_001",
  "type": "push",
  "data": {
    "blueprint_path": "data/blueprints/bp_001.json",
    "payload": {...}
  },
  "timestamp": "2024-01-22T10:00:00.000Z",
  "retries": 0
}
```

### Queue Processing

When connection is restored:

```python
async def process_offline_queue():
    while not offline_queue.is_empty():
        operation = offline_queue.pop()
        try:
            if operation['type'] == 'push':
                await sync_manager.send_blueprint(operation['data']['blueprint_path'])
            elif operation['type'] == 'pull':
                await sync_manager.update_blueprint(operation['data']['blueprint_id'])
        except Exception as e:
            # Re-queue for later
            offline_queue.add(operation['type'], operation['data'])
```

---

## Configuration

### Server Configuration (`.env`)

```bash
# Blueprint Sync Configuration
BLUEPRINT_SYNC_HMAC_SECRET=your-secret-key-here
BLUEPRINT_SYNC_JWT_SECRET=your-jwt-secret-here
BLUEPRINT_SYNC_JWT_EXPIRY_HOURS=24
BLUEPRINT_SYNC_RATE_LIMIT_PER_MINUTE=100
BLUEPRINT_SYNC_NONCE_EXPIRY_SECONDS=300
BLUEPRINT_SYNC_IDEMPOTENCY_EXPIRY_HOURS=24
```

### Hardware Configuration (`.env`)

```bash
# Server Configuration
SERVER_URL=https://your-server.com
DEVICE_ID=device_abc123
DEVICE_TOKEN=eyJhbGciOiJIUzI1NiIs...

# Sync Configuration
SYNC_INTERVAL_MINUTES=10
CONFLICT_RESOLUTION=auto
OFFLINE_QUEUE_ENABLED=true
OFFLINE_QUEUE_PATH=data/offline_queue.json
```

### Sync Configuration File (`data/sync_config.json`)

```json
{
  "sync_interval_minutes": 10,
  "conflict_resolution": "auto",
  "auto_sync_enabled": true,
  "last_sync_timestamp": "2024-01-22T10:00:00.000Z",
  "offline_queue_enabled": true
}
```

---

## Security Best Practices

### 1. Key Management

- Store `BLUEPRINT_SYNC_HMAC_SECRET` securely (environment variables)
- Rotate secrets periodically
- Use strong, randomly generated secrets (32+ bytes)

### 2. Token Security

- Use short token expiry (24 hours recommended)
- Implement token refresh mechanism
- Revoke tokens on device deactivation

### 3. Rate Limiting

- Monitor rate limit violations
- Implement progressive penalties for abuse
- Log suspicious activity

### 4. Audit Logging

All sync operations are logged to the `sync_log` table:

```sql
CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  action TEXT NOT NULL,        -- 'push', 'pull', 'resolve'
  direction TEXT NOT NULL,     -- 'to_server', 'to_device'
  status TEXT NOT NULL,        -- 'success', 'failed'
  version_before INTEGER,
  version_after INTEGER,
  created_at TIMESTAMP NOT NULL
);
```

---

## Testing

### Manual Testing with cURL

```bash
# 1. Register device
curl -X POST https://your-server.com/api/workstation/device/register \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"deviceName": "Test Device", "workstationId": "ws_xyz789"}'

# 2. Push blueprint
curl -X POST https://your-server.com/api/workstation/blueprint/push \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "X-Device-Id: device_abc123" \
  -H "X-Timestamp: 2024-01-22T10:00:00.000Z" \
  -H "X-Nonce: abc123def456" \
  -H "X-Signature: a1b2c3d4e5f6..." \
  -H "X-Idempotency-Key: bp_001_5" \
  -H "Content-Type: application/json" \
  -d '{
    "blueprintId": "bp_001",
    "name": "Test Blueprint",
    "data": {"test": true},
    "version": 1,
    "hash": "abc123..."
  }'
```

---

## Troubleshooting

### Common Issues

**Issue: "Invalid signature" error**
- Check that `BLUEPRINT_SYNC_HMAC_SECRET` matches on both sides
- Verify timestamp format (ISO 8601)
- Ensure payload is JSON with sorted keys

**Issue: "Replay attack detected"**
- Generate a new nonce for each request
- Check system clock synchronization
- Wait for nonce expiry (5 minutes)

**Issue: "Rate limit exceeded"**
- Implement backoff in client
- Check for infinite retry loops
- Increase rate limit if needed

**Issue: "Version conflict"**
- Pull latest version before pushing
- Use conflict resolution endpoint
- Implement merge strategy

---

## References

- **HTTP Client:** [`hardware/core/network/http_client.py`](../core/network/http_client.py)
- **Sync Manager:** [`hardware/core/sync/sync_manager.py`](../core/sync/sync_manager.py)
- **Device Auth:** [`web/src/lib/device-auth.ts`](../../web/src/lib/device-auth.ts)
- **HMAC Verify:** [`web/src/lib/hmac-verify.ts`](../../web/src/lib/hmac-verify.ts)
- **Replay Protection:** [`web/src/middleware/replay-protection.ts`](../../web/src/middleware/replay-protection.ts)
- **Idempotency:** [`web/src/middleware/idempotency.ts`](../../web/src/middleware/idempotency.ts)