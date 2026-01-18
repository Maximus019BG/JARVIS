"""Configuration constants."""
from typing import Dict

# TODO: Change hardcoded stats for demo
HARD_CODED_STATS: Dict[str, str] = {
    "CPU Usage": "45%",
    "Memory Usage": "60%",
    "Temperature": "50°C",
    "Uptime": "2d 4h 15m",
}

# Default theme colors - Professional green palette with dark backgrounds
DEFAULT_THEME: Dict[str, str] = {
    "primary": "#158c68",      # Green
    "secondary": "#a7f3d0",    # Light green
    "background": "#171717",   # Very dark grey
    "surface": "#242323",      # Dark grey for cards
    "text_primary": "#f0fdf4", # Light green text
    "text_secondary": "#a7f3d0", # Muted green
    "accent": "#10b981",       # Emerald for success
    "error": "#ef4444",        # Red for errors
    "border": "#4b5563",       # Grey border
}