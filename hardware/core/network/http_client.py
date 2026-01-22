import httpx
import secrets
from datetime import datetime
from typing import Optional, Dict, Any
from core.security.security_manager import SecurityManager

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
    
    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()