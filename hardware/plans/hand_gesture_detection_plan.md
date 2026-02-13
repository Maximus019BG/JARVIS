# Hand Detection & Gesture Recognition Implementation Plan

## Overview

This plan outlines the implementation of a real-time hand detection and gesture recognition system for JARVIS hardware using **MediaPipe**, **OpenCV**, and **uv** package management. The target platform is **Raspberry Pi OS Lite** with an **IMX500 AI Camera**.

### Target Stack
- **Hardware**: Raspberry Pi (4/5) + Sony IMX500 AI Camera
- **OS**: Raspberry Pi OS Lite (headless, 64-bit)
- **Python**: 3.13+ (managed via `uv`)
- **Core Libraries**: MediaPipe, OpenCV, picamera2
- **Integration**: Existing JARVIS tool-based architecture

---

## Phase 1: Hardware & Environment Setup

### 1.1 IMX500 Camera Configuration

The IMX500 is a smart camera with an onboard AI accelerator. For gesture detection, we'll use the camera in **raw frame mode** (not on-chip inference) since MediaPipe provides superior hand tracking.

```bash
# Enable camera in config.txt
sudo raspi-config nonint do_camera 0

# Verify camera detection
libcamera-hello --list-cameras
```

**Key Configuration** (`/boot/firmware/config.txt`):
```ini
dtoverlay=imx500
camera_auto_detect=0
```

### 1.2 Dependencies (pyproject.toml additions)

```toml
[project]
dependencies = [
    # ... existing deps ...
    
    # Vision & Hand Detection
    "opencv-python-headless>=4.9.0",   # Headless for RPi Lite (no GUI)
    "mediapipe>=0.10.14",              # Hand landmarks & gesture
    "picamera2>=0.3.19",               # RPi camera interface
    "libcamera>=0.1.0",                # Low-level camera control
    
    # Performance (RPi optimizations)  
    "tflite-runtime>=2.14.0",          # Lightweight TF for MediaPipe
]
```

Install with uv:
```bash
uv sync
```

### 1.3 System Dependencies (Raspberry Pi OS)

```bash
# Camera & video codecs
sudo apt update && sudo apt install -y \
    libcamera-dev \
    libcamera-apps \
    python3-libcamera \
    python3-picamera2 \
    libatlas-base-dev \
    libjasper-dev \
    libhdf5-dev \
    libharfbuzz-dev \
    libwebp-dev \
    libtiff-dev \
    libopenexr-dev
```

---

## Phase 2: Core Vision Module Architecture

### 2.1 Directory Structure

```
hardware/
├── core/
│   └── vision/                    # NEW: Vision processing module
│       ├── __init__.py
│       ├── camera_capture.py      # IMX500/picamera2 abstraction
│       ├── hand_detector.py       # MediaPipe hand detection
│       ├── gesture_recognizer.py  # Gesture classification
│       ├── gesture_events.py      # Event system for gestures
│       └── vision_config.py       # Vision-specific config
├── tools/
│   ├── gesture_control_tool.py    # NEW: Tool for gesture commands
│   └── camera_tool.py             # NEW: Camera status/control tool
└── config/
    └── gestures.json              # Gesture-to-action mappings
```

### 2.2 Camera Capture Module

**File**: `core/vision/camera_capture.py`

```python
"""Camera capture abstraction for IMX500/Picamera2."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import AsyncIterator, Protocol
from contextlib import asynccontextmanager

import numpy as np
from numpy.typing import NDArray

# Type alias for frames
Frame = NDArray[np.uint8]


@dataclass(frozen=True, slots=True)
class CameraConfig:
    """Camera configuration parameters."""
    
    width: int = 640
    height: int = 480
    fps: int = 30
    format: str = "RGB888"  # MediaPipe expects RGB
    rotation: int = 0       # 0, 90, 180, 270


class CameraBackend(Protocol):
    """Protocol for camera backends."""
    
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def capture_frame(self) -> Frame: ...


class PiCamera2Backend:
    """Picamera2 backend for IMX500."""
    
    def __init__(self, config: CameraConfig) -> None:
        self._config = config
        self._camera = None
        self._running = False
    
    async def start(self) -> None:
        from picamera2 import Picamera2
        
        self._camera = Picamera2()
        camera_config = self._camera.create_preview_configuration(
            main={"size": (self._config.width, self._config.height), 
                  "format": self._config.format},
            controls={"FrameRate": self._config.fps}
        )
        self._camera.configure(camera_config)
        self._camera.start()
        self._running = True
    
    async def stop(self) -> None:
        if self._camera and self._running:
            self._camera.stop()
            self._camera.close()
            self._running = False
    
    async def capture_frame(self) -> Frame:
        if not self._running:
            raise RuntimeError("Camera not started")
        # Run blocking capture in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._camera.capture_array)


class CameraCapture:
    """High-level camera capture with async frame streaming."""
    
    def __init__(self, config: CameraConfig | None = None) -> None:
        self._config = config or CameraConfig()
        self._backend: CameraBackend | None = None
    
    @asynccontextmanager
    async def stream(self) -> AsyncIterator["CameraCapture"]:
        """Context manager for camera streaming."""
        self._backend = PiCamera2Backend(self._config)
        await self._backend.start()
        try:
            yield self
        finally:
            await self._backend.stop()
    
    async def frames(self) -> AsyncIterator[Frame]:
        """Async generator yielding frames."""
        while True:
            frame = await self._backend.capture_frame()
            yield frame
            await asyncio.sleep(1 / self._config.fps)
```

### 2.3 Hand Detector Module

**File**: `core/vision/hand_detector.py`

```python
"""MediaPipe hand detection wrapper."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
from numpy.typing import NDArray

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision


class Handedness(str, Enum):
    """Hand side classification."""
    LEFT = "Left"
    RIGHT = "Right"


@dataclass(frozen=True, slots=True)
class Landmark:
    """Single hand landmark with 3D coordinates."""
    
    x: float  # Normalized [0, 1] relative to image width
    y: float  # Normalized [0, 1] relative to image height
    z: float  # Depth relative to wrist (negative = towards camera)
    
    def to_pixel(self, width: int, height: int) -> tuple[int, int]:
        """Convert normalized coords to pixel coordinates."""
        return int(self.x * width), int(self.y * height)


@dataclass(frozen=True, slots=True)
class HandDetection:
    """Complete detection result for a single hand."""
    
    landmarks: tuple[Landmark, ...]  # 21 landmarks per hand
    handedness: Handedness
    confidence: float
    
    # Landmark indices (MediaPipe standard)
    WRIST = 0
    THUMB_TIP = 4
    INDEX_TIP = 8
    MIDDLE_TIP = 12
    RING_TIP = 16
    PINKY_TIP = 20
    
    def get_fingertips(self) -> dict[str, Landmark]:
        """Return dict of fingertip landmarks."""
        return {
            "thumb": self.landmarks[self.THUMB_TIP],
            "index": self.landmarks[self.INDEX_TIP],
            "middle": self.landmarks[self.MIDDLE_TIP],
            "ring": self.landmarks[self.RING_TIP],
            "pinky": self.landmarks[self.PINKY_TIP],
        }
    
    def get_palm_center(self) -> Landmark:
        """Approximate palm center from key landmarks."""
        wrist = self.landmarks[0]
        middle_mcp = self.landmarks[9]  # Middle finger MCP joint
        return Landmark(
            x=(wrist.x + middle_mcp.x) / 2,
            y=(wrist.y + middle_mcp.y) / 2,
            z=(wrist.z + middle_mcp.z) / 2,
        )


@dataclass
class HandDetectorConfig:
    """Configuration for hand detector."""
    
    max_hands: int = 2
    min_detection_confidence: float = 0.5
    min_tracking_confidence: float = 0.5
    model_path: str | None = None  # None = use bundled model


class HandDetector:
    """MediaPipe hand detector with optimized settings for RPi."""
    
    def __init__(self, config: HandDetectorConfig | None = None) -> None:
        self._config = config or HandDetectorConfig()
        self._detector: Any = None
        self._setup_detector()
    
    def _setup_detector(self) -> None:
        """Initialize MediaPipe Hands solution."""
        # Use legacy Hands API (more stable on ARM)
        self._mp_hands = mp.solutions.hands
        self._detector = self._mp_hands.Hands(
            static_image_mode=False,  # Video mode for tracking
            max_num_hands=self._config.max_hands,
            min_detection_confidence=self._config.min_detection_confidence,
            min_tracking_confidence=self._config.min_tracking_confidence,
            model_complexity=0,  # 0=Lite (fastest), 1=Full
        )
    
    def detect(self, frame: NDArray[np.uint8]) -> list[HandDetection]:
        """Detect hands in an RGB frame.
        
        Args:
            frame: RGB image as numpy array (H, W, 3)
            
        Returns:
            List of HandDetection objects (0-2 depending on max_hands)
        """
        results = self._detector.process(frame)
        
        if not results.multi_hand_landmarks:
            return []
        
        detections = []
        for idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
            # Extract handedness
            handedness_info = results.multi_handedness[idx]
            handedness = Handedness(handedness_info.classification[0].label)
            confidence = handedness_info.classification[0].score
            
            # Convert landmarks
            landmarks = tuple(
                Landmark(x=lm.x, y=lm.y, z=lm.z)
                for lm in hand_landmarks.landmark
            )
            
            detections.append(HandDetection(
                landmarks=landmarks,
                handedness=handedness,
                confidence=confidence,
            ))
        
        return detections
    
    def close(self) -> None:
        """Release detector resources."""
        if self._detector:
            self._detector.close()
    
    def __enter__(self) -> "HandDetector":
        return self
    
    def __exit__(self, *args: Any) -> None:
        self.close()
```

### 2.4 Gesture Recognizer Module

**File**: `core/vision/gesture_recognizer.py`

```python
"""Gesture recognition from hand landmarks."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto
from typing import Callable
import math

from core.vision.hand_detector import HandDetection, Landmark


class GestureType(str, Enum):
    """Recognized gesture types."""
    
    NONE = "none"
    OPEN_PALM = "open_palm"       # All fingers extended
    CLOSED_FIST = "closed_fist"  # All fingers closed
    POINTING = "pointing"         # Index finger extended only
    THUMBS_UP = "thumbs_up"      # Thumb up, fingers closed
    THUMBS_DOWN = "thumbs_down"  # Thumb down, fingers closed
    PEACE = "peace"              # Index + middle extended (V sign)
    OK_SIGN = "ok_sign"          # Thumb + index touching (circle)
    PINCH = "pinch"              # Thumb + index close together
    WAVE = "wave"                # Detected via motion over time
    SWIPE_LEFT = "swipe_left"    # Motion gesture
    SWIPE_RIGHT = "swipe_right"  # Motion gesture
    SWIPE_UP = "swipe_up"        # Motion gesture
    SWIPE_DOWN = "swipe_down"    # Motion gesture


@dataclass(frozen=True, slots=True)
class GestureResult:
    """Result of gesture recognition."""
    
    gesture: GestureType
    confidence: float  # 0.0 - 1.0
    hand: HandDetection
    
    @property
    def is_valid(self) -> bool:
        return self.gesture != GestureType.NONE and self.confidence > 0.7


class GestureRecognizer:
    """Rule-based gesture recognition from hand landmarks.
    
    Uses geometric analysis of finger positions relative to palm.
    """
    
    def __init__(self) -> None:
        # Motion tracking for dynamic gestures
        self._history: list[tuple[float, float]] = []  # Palm positions
        self._history_max = 15  # ~0.5 sec at 30fps
    
    def recognize(self, detection: HandDetection) -> GestureResult:
        """Recognize gesture from hand detection."""
        
        # Get finger states
        fingers_extended = self._get_finger_states(detection)
        
        # Update motion history
        palm = detection.get_palm_center()
        self._history.append((palm.x, palm.y))
        if len(self._history) > self._history_max:
            self._history.pop(0)
        
        # Check for motion gestures first
        motion_gesture = self._detect_motion_gesture()
        if motion_gesture:
            return GestureResult(
                gesture=motion_gesture,
                confidence=0.85,
                hand=detection,
            )
        
        # Static gesture recognition
        gesture, confidence = self._classify_static_gesture(
            detection, fingers_extended
        )
        
        return GestureResult(
            gesture=gesture,
            confidence=confidence,
            hand=detection,
        )
    
    def _get_finger_states(self, detection: HandDetection) -> dict[str, bool]:
        """Determine which fingers are extended.
        
        Uses comparison of fingertip to MCP joint positions.
        """
        lm = detection.landmarks
        
        # Finger extended = tip is farther from palm than MCP
        # For thumb, compare x-position (left/right hand matters)
        is_right = detection.handedness.value == "Right"
        
        # Thumb: compare x position to IP joint (index 3)
        thumb_extended = (lm[4].x < lm[3].x) if is_right else (lm[4].x > lm[3].x)
        
        # Other fingers: tip y < PIP y (tip is higher = extended)
        return {
            "thumb": thumb_extended,
            "index": lm[8].y < lm[6].y,
            "middle": lm[12].y < lm[10].y,
            "ring": lm[16].y < lm[14].y,
            "pinky": lm[20].y < lm[18].y,
        }
    
    def _classify_static_gesture(
        self,
        detection: HandDetection,
        fingers: dict[str, bool],
    ) -> tuple[GestureType, float]:
        """Classify static (non-motion) gesture."""
        
        all_extended = all(fingers.values())
        all_closed = not any(fingers.values())
        
        # Open palm: all fingers extended
        if all_extended:
            return GestureType.OPEN_PALM, 0.95
        
        # Closed fist: all fingers closed
        if all_closed:
            return GestureType.CLOSED_FIST, 0.95
        
        # Pointing: only index extended
        if (fingers["index"] and 
            not fingers["middle"] and 
            not fingers["ring"] and 
            not fingers["pinky"]):
            # Thumb can be either
            return GestureType.POINTING, 0.90
        
        # Peace/Victory: index + middle extended
        if (fingers["index"] and 
            fingers["middle"] and 
            not fingers["ring"] and 
            not fingers["pinky"]):
            return GestureType.PEACE, 0.90
        
        # Thumbs up: only thumb extended, hand rotated
        if (fingers["thumb"] and 
            not fingers["index"] and 
            not fingers["middle"]):
            lm = detection.landmarks
            # Check if thumb is pointing up (tip above base)
            if lm[4].y < lm[2].y:
                return GestureType.THUMBS_UP, 0.85
            elif lm[4].y > lm[2].y:
                return GestureType.THUMBS_DOWN, 0.85
        
        # OK sign: thumb and index tips close together
        lm = detection.landmarks
        thumb_index_dist = self._distance(lm[4], lm[8])
        if thumb_index_dist < 0.05:  # Threshold for "touching"
            return GestureType.OK_SIGN, 0.85
        
        # Pinch: thumb and index close but not touching
        if thumb_index_dist < 0.1:
            return GestureType.PINCH, 0.80
        
        return GestureType.NONE, 0.0
    
    def _detect_motion_gesture(self) -> GestureType | None:
        """Detect swipe gestures from motion history."""
        
        if len(self._history) < 10:
            return None
        
        # Calculate displacement
        start_x, start_y = self._history[0]
        end_x, end_y = self._history[-1]
        
        dx = end_x - start_x
        dy = end_y - start_y
        
        # Minimum displacement threshold
        min_dist = 0.15  # 15% of frame
        
        if abs(dx) > min_dist and abs(dx) > abs(dy) * 1.5:
            self._history.clear()  # Reset after detection
            return GestureType.SWIPE_RIGHT if dx > 0 else GestureType.SWIPE_LEFT
        
        if abs(dy) > min_dist and abs(dy) > abs(dx) * 1.5:
            self._history.clear()
            return GestureType.SWIPE_DOWN if dy > 0 else GestureType.SWIPE_UP
        
        return None
    
    @staticmethod
    def _distance(a: Landmark, b: Landmark) -> float:
        """Euclidean distance between two landmarks."""
        return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2 + (a.z - b.z)**2)
    
    def reset(self) -> None:
        """Clear motion history."""
        self._history.clear()
```

---

## Phase 3: Event System & Integration

### 3.1 Gesture Event System

**File**: `core/vision/gesture_events.py`

```python
"""Event system for gesture callbacks."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from collections import defaultdict

from core.vision.gesture_recognizer import GestureType, GestureResult


GestureCallback = Callable[[GestureResult], Awaitable[None]]


@dataclass
class GestureEventEmitter:
    """Async event emitter for gesture events."""
    
    _handlers: dict[GestureType, list[GestureCallback]] = field(
        default_factory=lambda: defaultdict(list)
    )
    _global_handlers: list[GestureCallback] = field(default_factory=list)
    
    def on(self, gesture: GestureType, callback: GestureCallback) -> None:
        """Register handler for specific gesture."""
        self._handlers[gesture].append(callback)
    
    def on_any(self, callback: GestureCallback) -> None:
        """Register handler for all gestures."""
        self._global_handlers.append(callback)
    
    def off(self, gesture: GestureType, callback: GestureCallback) -> None:
        """Remove specific handler."""
        if callback in self._handlers[gesture]:
            self._handlers[gesture].remove(callback)
    
    async def emit(self, result: GestureResult) -> None:
        """Emit gesture event to all relevant handlers."""
        tasks = []
        
        # Specific handlers
        for handler in self._handlers[result.gesture]:
            tasks.append(asyncio.create_task(handler(result)))
        
        # Global handlers
        for handler in self._global_handlers:
            tasks.append(asyncio.create_task(handler(result)))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
```

### 3.2 Vision Service (Main Orchestrator)

**File**: `core/vision/__init__.py`

```python
"""Vision module - hand detection and gesture recognition."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from app_logging.logger import get_logger

from core.vision.camera_capture import CameraCapture, CameraConfig
from core.vision.hand_detector import HandDetector, HandDetectorConfig
from core.vision.gesture_recognizer import GestureRecognizer, GestureType, GestureResult
from core.vision.gesture_events import GestureEventEmitter

logger = get_logger(__name__)

__all__ = [
    "VisionService",
    "GestureType",
    "GestureResult",
    "CameraConfig",
]


@dataclass
class VisionServiceConfig:
    """Configuration for the vision service."""
    
    camera: CameraConfig = CameraConfig()
    hand_detector: HandDetectorConfig = HandDetectorConfig()
    gesture_cooldown_ms: int = 300  # Min time between same gesture


class VisionService:
    """Main vision service orchestrating camera, detection, and gestures.
    
    Usage:
        service = VisionService()
        service.events.on(GestureType.THUMBS_UP, my_handler)
        await service.run()
    """
    
    def __init__(self, config: VisionServiceConfig | None = None) -> None:
        self._config = config or VisionServiceConfig()
        self._camera = CameraCapture(self._config.camera)
        self._detector = HandDetector(self._config.hand_detector)
        self._recognizer = GestureRecognizer()
        self._events = GestureEventEmitter()
        self._running = False
        self._last_gesture: GestureType | None = None
        self._last_gesture_time: float = 0
    
    @property
    def events(self) -> GestureEventEmitter:
        """Access event emitter for registering handlers."""
        return self._events
    
    async def run(self) -> None:
        """Start vision processing loop."""
        import time
        
        self._running = True
        logger.info("Vision service starting...")
        
        async with self._camera.stream():
            logger.info("Camera stream active")
            
            async for frame in self._camera.frames():
                if not self._running:
                    break
                
                # Detect hands
                detections = self._detector.detect(frame)
                
                # Process each detected hand
                for hand in detections:
                    result = self._recognizer.recognize(hand)
                    
                    if not result.is_valid:
                        continue
                    
                    # Apply cooldown to prevent spam
                    now = time.monotonic() * 1000
                    if (result.gesture == self._last_gesture and
                        now - self._last_gesture_time < self._config.gesture_cooldown_ms):
                        continue
                    
                    self._last_gesture = result.gesture
                    self._last_gesture_time = now
                    
                    # Emit event
                    logger.debug("Gesture detected: %s (%.2f)", 
                                result.gesture.value, result.confidence)
                    await self._events.emit(result)
    
    def stop(self) -> None:
        """Signal the vision loop to stop."""
        self._running = False
        self._detector.close()
        logger.info("Vision service stopped")
```

---

## Phase 4: Tool Integration

### 4.1 Gesture Control Tool

**File**: `tools/gesture_control_tool.py`

```python
"""Tool to enable/disable gesture control and map gestures to actions."""

from __future__ import annotations

from typing import Any

from core.base_tool import BaseTool, ToolResult


class GestureControlTool(BaseTool):
    """Tool for managing gesture-based control."""
    
    @property
    def name(self) -> str:
        return "gesture_control"
    
    @property
    def description(self) -> str:
        return (
            "Enable, disable, or configure gesture-based control. "
            "Allows mapping hand gestures to JARVIS actions."
        )
    
    def schema_parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["enable", "disable", "status", "map", "unmap", "list"],
                    "description": "Action to perform on gesture control",
                },
                "gesture": {
                    "type": "string",
                    "enum": [
                        "open_palm", "closed_fist", "pointing", "thumbs_up",
                        "thumbs_down", "peace", "ok_sign", "pinch",
                        "swipe_left", "swipe_right", "swipe_up", "swipe_down",
                    ],
                    "description": "Gesture type (for map/unmap actions)",
                },
                "command": {
                    "type": "string",
                    "description": "JARVIS command to execute when gesture detected",
                },
            },
            "required": ["action"],
        }
    
    def execute(self, **kwargs: Any) -> ToolResult:
        action = kwargs.get("action", "status")
        gesture = kwargs.get("gesture")
        command = kwargs.get("command")
        
        # Implementation would interact with VisionService
        # This is a stub showing the interface
        
        if action == "enable":
            return ToolResult.ok_result(
                "Gesture control enabled. Show 👍 to confirm actions, "
                "✋ open palm to stop, 👆 point to select."
            )
        
        if action == "disable":
            return ToolResult.ok_result("Gesture control disabled.")
        
        if action == "status":
            return ToolResult.ok_result(
                "Gesture control: ENABLED\n"
                "Active mappings:\n"
                "  • thumbs_up → confirm\n"
                "  • open_palm → stop\n"
                "  • pointing → select\n"
                "  • swipe_left → back\n"
                "  • swipe_right → forward"
            )
        
        if action == "map" and gesture and command:
            return ToolResult.ok_result(
                f"Mapped gesture '{gesture}' to command: {command}"
            )
        
        if action == "list":
            return ToolResult.ok_result(
                "Available gestures:\n"
                "• open_palm - Stop/cancel current action\n"
                "• closed_fist - Pause/hold\n"
                "• pointing - Select/focus\n"
                "• thumbs_up - Confirm/yes\n"
                "• thumbs_down - Reject/no\n"
                "• peace - Switch mode\n"
                "• ok_sign - OK/acknowledge\n"
                "• pinch - Fine control/zoom\n"
                "• swipe_left/right/up/down - Navigation"
            )
        
        return ToolResult.fail(f"Unknown action: {action}")
```

### 4.2 App Integration

**File modifications**: `app.py`

```python
# Add imports
from core.vision import VisionService, GestureType, GestureResult

# Add gesture handler setup
async def setup_gesture_handlers(
    vision: VisionService, 
    chat_handler: ChatHandler
) -> None:
    """Map gestures to chat commands."""
    
    async def handle_thumbs_up(result: GestureResult) -> None:
        await chat_handler.process_message("confirm")
    
    async def handle_open_palm(result: GestureResult) -> None:
        await chat_handler.process_message("stop")
    
    async def handle_pointing(result: GestureResult) -> None:
        await chat_handler.process_message("select")
    
    vision.events.on(GestureType.THUMBS_UP, handle_thumbs_up)
    vision.events.on(GestureType.OPEN_PALM, handle_open_palm)
    vision.events.on(GestureType.POINTING, handle_pointing)


# In main():
async def main():
    # ... existing setup ...
    
    # Vision service (optional, based on config)
    if config.enable_gesture_control:
        vision = VisionService()
        await setup_gesture_handlers(vision, chat_handler)
        
        # Run vision in parallel with chat
        await asyncio.gather(
            vision.run(),
            chat_loop(chat_handler),
        )
    else:
        await chat_loop(chat_handler)
```

---

## Phase 5: Configuration

### 5.1 Vision Config

**File**: `core/vision/vision_config.py`

```python
"""Vision-specific configuration."""

from pydantic import Field
from pydantic_settings import BaseSettings


class VisionConfig(BaseSettings):
    """Vision subsystem configuration."""
    
    enabled: bool = Field(default=False, description="Enable gesture control")
    
    # Camera settings
    camera_width: int = Field(default=640, ge=320, le=1920)
    camera_height: int = Field(default=480, ge=240, le=1080)
    camera_fps: int = Field(default=30, ge=15, le=60)
    camera_rotation: int = Field(default=0, description="0, 90, 180, 270")
    
    # Detection settings
    max_hands: int = Field(default=2, ge=1, le=4)
    detection_confidence: float = Field(default=0.5, ge=0.1, le=1.0)
    tracking_confidence: float = Field(default=0.5, ge=0.1, le=1.0)
    
    # Gesture settings
    gesture_cooldown_ms: int = Field(default=300, ge=100, le=2000)
    
    model_config = {"env_prefix": "VISION_"}
```

### 5.2 Environment Variables

**Add to `.env.example`**:

```bash
# Vision / Gesture Control
VISION_ENABLED=false
VISION_CAMERA_WIDTH=640
VISION_CAMERA_HEIGHT=480
VISION_CAMERA_FPS=30
VISION_CAMERA_ROTATION=0
VISION_MAX_HANDS=2
VISION_DETECTION_CONFIDENCE=0.5
VISION_TRACKING_CONFIDENCE=0.5
VISION_GESTURE_COOLDOWN_MS=300
```

---

## Phase 6: Testing

### 6.1 Unit Tests

**File**: `tests/test_gesture_recognizer.py`

```python
"""Tests for gesture recognition."""

import pytest
from core.vision.hand_detector import HandDetection, Landmark, Handedness
from core.vision.gesture_recognizer import GestureRecognizer, GestureType


def make_detection(landmarks: list[tuple[float, float, float]]) -> HandDetection:
    """Helper to create HandDetection from landmark coords."""
    return HandDetection(
        landmarks=tuple(Landmark(x=x, y=y, z=z) for x, y, z in landmarks),
        handedness=Handedness.RIGHT,
        confidence=0.95,
    )


# Landmark positions for open palm (all fingers extended)
OPEN_PALM_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.4, 0.6, 0.0),   # 2 THUMB_MCP
    (0.35, 0.5, 0.0),  # 3 THUMB_IP
    (0.3, 0.4, 0.0),   # 4 THUMB_TIP (extended left)
    (0.45, 0.6, 0.0),  # 5 INDEX_MCP
    (0.45, 0.45, 0.0), # 6 INDEX_PIP
    (0.45, 0.35, 0.0), # 7 INDEX_DIP
    (0.45, 0.25, 0.0), # 8 INDEX_TIP (up)
    (0.5, 0.55, 0.0),  # 9 MIDDLE_MCP
    (0.5, 0.4, 0.0),   # 10 MIDDLE_PIP
    (0.5, 0.3, 0.0),   # 11 MIDDLE_DIP
    (0.5, 0.2, 0.0),   # 12 MIDDLE_TIP (up)
    (0.55, 0.58, 0.0), # 13 RING_MCP
    (0.55, 0.43, 0.0), # 14 RING_PIP
    (0.55, 0.33, 0.0), # 15 RING_DIP
    (0.55, 0.23, 0.0), # 16 RING_TIP (up)
    (0.6, 0.62, 0.0),  # 17 PINKY_MCP
    (0.6, 0.5, 0.0),   # 18 PINKY_PIP
    (0.6, 0.4, 0.0),   # 19 PINKY_DIP
    (0.6, 0.3, 0.0),   # 20 PINKY_TIP (up)
]


class TestGestureRecognizer:
    def test_open_palm_recognized(self):
        recognizer = GestureRecognizer()
        detection = make_detection(OPEN_PALM_LANDMARKS)
        
        result = recognizer.recognize(detection)
        
        assert result.gesture == GestureType.OPEN_PALM
        assert result.confidence > 0.8
    
    def test_result_is_valid(self):
        recognizer = GestureRecognizer()
        detection = make_detection(OPEN_PALM_LANDMARKS)
        
        result = recognizer.recognize(detection)
        
        assert result.is_valid is True
```

### 6.2 Integration Test

**File**: `tests/test_vision_integration.py`

```python
"""Integration tests for vision pipeline."""

import pytest
import numpy as np
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_vision_service_emits_gestures():
    """Test that VisionService emits gesture events."""
    from core.vision import VisionService, GestureType
    
    received_gestures = []
    
    async def capture_gesture(result):
        received_gestures.append(result.gesture)
    
    service = VisionService()
    service.events.on(GestureType.OPEN_PALM, capture_gesture)
    
    # Mock would inject test frames here
    # Full test requires camera mocking
```

---

## Phase 7: Performance Optimization (Raspberry Pi)

### 7.1 MediaPipe Optimizations

```python
# In hand_detector.py, use lite model
self._detector = self._mp_hands.Hands(
    model_complexity=0,  # 0=Lite (fastest on ARM)
    ...
)
```

### 7.2 Frame Skipping

```python
# Process every Nth frame to reduce CPU
async for idx, frame in enumerate(self._camera.frames()):
    if idx % 2 != 0:  # Skip every other frame
        continue
    # Process frame...
```

### 7.3 Resolution Tuning

- **640x480** @ 30fps: Balanced (default)
- **320x240** @ 30fps: Maximum performance
- **640x480** @ 15fps: Power saving mode

---

## Phase 8: Deployment Checklist

### 8.1 Pre-deployment

- [ ] Camera connected and detected (`libcamera-hello`)
- [ ] Python 3.13+ installed via `uv`
- [ ] All dependencies installed (`uv sync`)
- [ ] Environment variables configured (`.env`)
- [ ] Gesture mappings reviewed

### 8.2 Startup Script

**File**: `scripts/start_with_vision.sh`

```bash
#!/bin/bash
# Start JARVIS with gesture control enabled

export VISION_ENABLED=true
export VISION_CAMERA_FPS=30

cd /home/pi/jarvis/hardware
uv run python -m app
```

### 8.3 Systemd Service (Optional)

**File**: `/etc/systemd/system/jarvis-vision.service`

```ini
[Unit]
Description=JARVIS AI Assistant with Gesture Control
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/jarvis/hardware
Environment=VISION_ENABLED=true
ExecStart=/home/pi/.local/bin/uv run python -m app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## Implementation Timeline

| Phase | Task | Estimated Time |
|-------|------|----------------|
| 1 | Environment setup & dependencies | 2 hours |
| 2 | Camera capture module | 3 hours |
| 2 | Hand detector module | 4 hours |
| 2 | Gesture recognizer | 4 hours |
| 3 | Event system | 2 hours |
| 3 | Vision service orchestrator | 3 hours |
| 4 | Gesture control tool | 2 hours |
| 4 | App integration | 2 hours |
| 5 | Configuration | 1 hour |
| 6 | Testing | 4 hours |
| 7 | Performance optimization | 3 hours |
| **Total** | | **~30 hours** |

---

## Future Enhancements

1. **On-chip IMX500 Inference**: Use IMX500's built-in NPU for detection (requires Sony SDK)
2. **Custom Gestures**: Train custom gesture classifier with user data
3. **Multi-hand Coordination**: Two-hand gestures (pinch-zoom, rotate)
4. **Face + Hand Fusion**: Combine with face detection for user identification
5. **Spatial Tracking**: 3D hand position for AR-style interactions

---

## References

- [MediaPipe Hands Documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- [Picamera2 Documentation](https://datasheets.raspberrypi.com/camera/picamera2-manual.pdf)
- [IMX500 Camera Guide](https://www.raspberrypi.com/documentation/accessories/ai-camera.html)
- [OpenCV ARM Optimization](https://docs.opencv.org/4.x/d0/d76/tutorial_arm_crosscompile_with_cmake.html)
