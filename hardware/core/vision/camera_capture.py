"""Camera capture abstraction for IMX500/Picamera2.

Provides async camera streaming with support for Raspberry Pi cameras.
Falls back to OpenCV VideoCapture for development/testing on non-Pi systems.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, AsyncIterator, Protocol

import numpy as np
from numpy.typing import NDArray

if TYPE_CHECKING:
    pass

# Type alias for frames
Frame = NDArray[np.uint8]


@dataclass(frozen=True, slots=True)
class CameraConfig:
    """Camera configuration parameters."""

    width: int = 640
    height: int = 480
    fps: int = 30
    format: str = "RGB888"  # MediaPipe expects RGB
    rotation: int = 0  # 0, 90, 180, 270
    device_id: int = 0  # For OpenCV fallback


class CameraBackend(Protocol):
    """Protocol for camera backends."""

    async def start(self) -> None:
        """Start the camera."""
        ...

    async def stop(self) -> None:
        """Stop the camera."""
        ...

    async def capture_frame(self) -> Frame:
        """Capture a single frame."""
        ...


class PiCamera2Backend:
    """Picamera2 backend for Raspberry Pi cameras (IMX500, etc.)."""

    def __init__(self, config: CameraConfig) -> None:
        self._config = config
        self._camera = None
        self._running = False

    async def start(self) -> None:
        """Initialize and start the Picamera2 camera."""
        from picamera2 import Picamera2

        self._camera = Picamera2()
        camera_config = self._camera.create_preview_configuration(
            main={
                "size": (self._config.width, self._config.height),
                "format": self._config.format,
            },
            controls={"FrameRate": self._config.fps},
        )
        self._camera.configure(camera_config)

        # Apply rotation if needed
        if self._config.rotation != 0:
            self._camera.set_controls({"Rotation": self._config.rotation})

        self._camera.start()
        self._running = True

    async def stop(self) -> None:
        """Stop and close the camera."""
        if self._camera and self._running:
            self._camera.stop()
            self._camera.close()
            self._running = False

    async def capture_frame(self) -> Frame:
        """Capture a frame from the camera."""
        if not self._running:
            raise RuntimeError("Camera not started")

        # Run blocking capture in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._camera.capture_array)


class OpenCVBackend:
    """OpenCV VideoCapture backend for development/testing."""

    def __init__(self, config: CameraConfig) -> None:
        self._config = config
        self._capture = None
        self._running = False

    async def start(self) -> None:
        """Initialize OpenCV VideoCapture."""
        import cv2

        self._capture = cv2.VideoCapture(self._config.device_id)
        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, self._config.width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self._config.height)
        self._capture.set(cv2.CAP_PROP_FPS, self._config.fps)

        if not self._capture.isOpened():
            raise RuntimeError(f"Cannot open camera {self._config.device_id}")

        self._running = True

    async def stop(self) -> None:
        """Release the OpenCV capture."""
        if self._capture and self._running:
            self._capture.release()
            self._running = False

    async def capture_frame(self) -> Frame:
        """Capture a frame and convert BGR to RGB."""
        if not self._running:
            raise RuntimeError("Camera not started")

        import cv2

        loop = asyncio.get_event_loop()

        def _read():
            ret, frame = self._capture.read()
            if not ret:
                raise RuntimeError("Failed to capture frame")
            # Convert BGR to RGB for MediaPipe
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        return await loop.run_in_executor(None, _read)


def _detect_backend(config: CameraConfig) -> CameraBackend:
    """Auto-detect the best available camera backend."""
    # Try Picamera2 first (Raspberry Pi)
    try:
        from picamera2 import Picamera2

        # Test if camera is available
        cam = Picamera2()
        cam.close()
        return PiCamera2Backend(config)
    except (ImportError, RuntimeError):
        pass

    # Fall back to OpenCV
    return OpenCVBackend(config)


class CameraCapture:
    """High-level camera capture with async frame streaming.

    Automatically selects the best available backend:
    - PiCamera2 for Raspberry Pi
    - OpenCV for development/testing

    Usage:
        camera = CameraCapture(CameraConfig(width=640, height=480))
        async with camera.stream():
            async for frame in camera.frames():
                # Process frame...
    """

    def __init__(self, config: CameraConfig | None = None) -> None:
        self._config = config or CameraConfig()
        self._backend: CameraBackend | None = None

    @asynccontextmanager
    async def stream(self) -> AsyncIterator["CameraCapture"]:
        """Context manager for camera streaming."""
        self._backend = _detect_backend(self._config)
        await self._backend.start()
        try:
            yield self
        finally:
            await self._backend.stop()
            self._backend = None

    async def frames(self) -> AsyncIterator[Frame]:
        """Async generator yielding frames at configured FPS."""
        if not self._backend:
            raise RuntimeError("Camera not started. Use 'async with camera.stream():'")

        frame_delay = 1.0 / self._config.fps

        while True:
            start = asyncio.get_event_loop().time()
            frame = await self._backend.capture_frame()
            yield frame

            # Maintain target FPS
            elapsed = asyncio.get_event_loop().time() - start
            sleep_time = frame_delay - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    async def capture_single(self) -> Frame:
        """Capture a single frame (requires active stream)."""
        if not self._backend:
            raise RuntimeError("Camera not started. Use 'async with camera.stream():'")
        return await self._backend.capture_frame()
