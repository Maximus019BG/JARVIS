import httpx
import secrets
from datetime import datetime
from typing import Optional, Dict, Any
from core.security.security_manager import SecurityManager
from config.config import get_config

class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded"""
    pass

class AuthenticationError(Exception):
    """Raised when authentication fails"""
    pass

class AuthorizationError(Exception):
    """Raised when authorization fails"""
    pass

class ApiError(Exception):
    """Raised when API returns an error"""
    pass

class HttpClient:
    """Secure HTTP client for blueprint synchronization with connection pooling.
    
    Performance improvements:
    - Connection pooling with configurable limits
    - Keep-alive connections to reduce handshake overhead
    - Proper timeout settings for reliability
    - Connection limits to prevent resource exhaustion
    """
    
    def __init__(self, base_url: str, security_manager: SecurityManager):
        self.base_url = base_url
        self.security = security_manager
        
        # Get configuration for connection pooling
        config = get_config()
        
        # Configure connection limits for pooling
        # max_connections: Maximum number of concurrent connections
        # max_keepalive_connections: Maximum number of idle keep-alive connections
        # keepalive_expiry: Time in seconds before idle keep-alive connections are closed
        limits = httpx.Limits(
            max_connections=getattr(config, 'http_max_connections', 100),
            max_keepalive_connections=getattr(config, 'http_max_keepalive', 20),
            keepalive_expiry=getattr(config, 'http_keepalive_expiry', 5.0)
        )
        
        # Configure timeouts for reliability
        # connect: Maximum time to establish a connection
        # read: Maximum time to wait for a response
        # write: Maximum time to send request data
        # pool: Maximum time to wait for a connection from the pool
        timeout = httpx.Timeout(
            connect=getattr(config, 'http_connect_timeout', 10.0),
            read=getattr(config, 'http_read_timeout', 30.0),
            write=getattr(config, 'http_write_timeout', 10.0),
            pool=getattr(config, 'http_pool_timeout', 5.0)
        )
        
        # Create async client with connection pooling
        self.client = httpx.AsyncClient(
            timeout=timeout,
            limits=limits,
            verify=True,
            headers={'User-Agent': 'JARVIS-Hardware/1.0'},
            # Enable HTTP/2 for better performance when supported
            http2=getattr(config, 'http_enable_http2', True)
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
    
    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()