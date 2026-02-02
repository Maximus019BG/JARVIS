"""Event system for gesture callbacks.

Provides async event emitter for gesture-driven actions.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Awaitable, Callable

if TYPE_CHECKING:
    from core.vision.gesture_recognizer import GestureResult, GestureType

# Type alias for gesture callback functions
GestureCallback = Callable[["GestureResult"], Awaitable[None]]


@dataclass
class GestureEventEmitter:
    """Async event emitter for gesture events.

    Supports registering handlers for specific gestures or all gestures.

    Usage:
        emitter = GestureEventEmitter()

        async def handle_thumbs_up(result):
            print(f"Thumbs up detected! Confidence: {result.confidence}")

        emitter.on(GestureType.THUMBS_UP, handle_thumbs_up)
        await emitter.emit(gesture_result)
    """

    _handlers: dict["GestureType", list[GestureCallback]] = field(
        default_factory=lambda: defaultdict(list)
    )
    _global_handlers: list[GestureCallback] = field(default_factory=list)

    def on(self, gesture: "GestureType", callback: GestureCallback) -> None:
        """Register handler for specific gesture.

        Args:
            gesture: The gesture type to listen for.
            callback: Async function to call when gesture is detected.
        """
        self._handlers[gesture].append(callback)

    def on_any(self, callback: GestureCallback) -> None:
        """Register handler for all gestures.

        Args:
            callback: Async function to call for any gesture.
        """
        self._global_handlers.append(callback)

    def off(self, gesture: "GestureType", callback: GestureCallback) -> None:
        """Remove specific handler.

        Args:
            gesture: The gesture type the callback was registered for.
            callback: The callback to remove.
        """
        if callback in self._handlers[gesture]:
            self._handlers[gesture].remove(callback)

    def off_any(self, callback: GestureCallback) -> None:
        """Remove global handler.

        Args:
            callback: The callback to remove.
        """
        if callback in self._global_handlers:
            self._global_handlers.remove(callback)

    def clear(self, gesture: "GestureType | None" = None) -> None:
        """Clear handlers.

        Args:
            gesture: If provided, clear only handlers for this gesture.
                    If None, clear all handlers.
        """
        if gesture is None:
            self._handlers.clear()
            self._global_handlers.clear()
        else:
            self._handlers[gesture].clear()

    async def emit(self, result: "GestureResult") -> None:
        """Emit gesture event to all relevant handlers.

        Args:
            result: The gesture recognition result to emit.
        """
        tasks = []

        # Specific handlers for this gesture type
        for handler in self._handlers[result.gesture]:
            tasks.append(asyncio.create_task(handler(result)))

        # Global handlers (receive all gestures)
        for handler in self._global_handlers:
            tasks.append(asyncio.create_task(handler(result)))

        if tasks:
            # Gather all tasks, don't propagate individual errors
            await asyncio.gather(*tasks, return_exceptions=True)

    def handler_count(self, gesture: "GestureType | None" = None) -> int:
        """Count registered handlers.

        Args:
            gesture: If provided, count handlers for this gesture only.
                    If None, count all handlers.

        Returns:
            Number of registered handlers.
        """
        if gesture is None:
            total = len(self._global_handlers)
            for handlers in self._handlers.values():
                total += len(handlers)
            return total
        return len(self._handlers[gesture])
