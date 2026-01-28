"""
Blueprint synchronization configuration for JARVIS hardware.
"""

SYNC_CONFIG = {
    # Server URL for blueprint sync API
    "server_url": "https://api.jarvis.example.com",
    # Paths for storing device credentials
    "device_token_path": "data/device_token.enc",
    "device_id_path": "data/device_id.enc",
    "signing_key_path": "data/signing_key.enc",
    # Sync settings
    "sync_interval_minutes": 5,
    "retry_attempts": 3,
    "retry_delay_seconds": 5,
    "timeout_seconds": 30,
    # Offline mode
    "offline_enabled": True,
    "max_offline_queue_size": 100,
    # Security settings
    "use_tpm": True,  # Try to use TPM if available
    "verify_tls": True,  # Verify TLS certificates
}

# Override with environment variables if present
import os

SYNC_CONFIG["server_url"] = os.getenv(
    "JARVIS_SYNC_SERVER_URL", SYNC_CONFIG["server_url"]
)
SYNC_CONFIG["sync_interval_minutes"] = int(
    os.getenv("JARVIS_SYNC_INTERVAL", SYNC_CONFIG["sync_interval_minutes"])
)
SYNC_CONFIG["timeout_seconds"] = int(
    os.getenv("JARVIS_SYNC_TIMEOUT", SYNC_CONFIG["timeout_seconds"])
)
SYNC_CONFIG["offline_enabled"] = (
    os.getenv("JARVIS_SYNC_OFFLINE", "true").lower() == "true"
)
SYNC_CONFIG["verify_tls"] = (
    os.getenv("JARVIS_SYNC_VERIFY_TLS", "true").lower() == "true"
)
