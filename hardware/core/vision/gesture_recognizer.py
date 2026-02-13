"""Gesture recognition from hand landmarks.

Uses geometric analysis of finger positions to classify static and dynamic gestures.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from core.vision.hand_detector import HandDetection, Landmark


class GestureType(str, Enum):
    """Recognized gesture types."""

    NONE = "none"
    OPEN_PALM = "open_palm"  # All fingers extended
    CLOSED_FIST = "closed_fist"  # All fingers closed
    POINTING = "pointing"  # Index finger extended only
    THUMBS_UP = "thumbs_up"  # Thumb up, fingers closed
    THUMBS_DOWN = "thumbs_down"  # Thumb down, fingers closed
    PEACE = "peace"  # Index + middle extended (V sign)
    OK_SIGN = "ok_sign"  # Thumb + index touching (circle)
    PINCH = "pinch"  # Thumb + index close together
    THREE_FINGERS = "three_fingers"  # Index + middle + ring extended
    ROCK = "rock"  # Index + pinky extended (rock sign)
    CALL_ME = "call_me"  # Thumb + pinky extended (call gesture)
    # Motion gestures (detected via position history)
    SWIPE_LEFT = "swipe_left"
    SWIPE_RIGHT = "swipe_right"
    SWIPE_UP = "swipe_up"
    SWIPE_DOWN = "swipe_down"
    WAVE = "wave"  # Side-to-side motion


@dataclass(frozen=True, slots=True)
class GestureResult:
    """Result of gesture recognition."""

    gesture: GestureType
    confidence: float  # 0.0 - 1.0
    hand: HandDetection

    @property
    def is_valid(self) -> bool:
        """Check if this is a valid recognized gesture."""
        return self.gesture != GestureType.NONE and self.confidence > 0.7


class GestureRecognizer:
    """Rule-based gesture recognition from hand landmarks.

    Uses geometric analysis of finger positions relative to palm.
    Supports both static gestures (poses) and dynamic gestures (motion).

    Usage:
        recognizer = GestureRecognizer()
        result = recognizer.recognize(hand_detection)
        if result.is_valid:
            print(f"Detected: {result.gesture}")
    """

    def __init__(self) -> None:
        # Motion tracking for dynamic gestures
        self._history: list[tuple[float, float]] = []  # Palm positions
        self._history_max = 15  # ~0.5 sec at 30fps

    def recognize(self, detection: HandDetection) -> GestureResult:
        """Recognize gesture from hand detection.

        Args:
            detection: Hand detection with landmarks.

        Returns:
            GestureResult with gesture type and confidence.
        """
        # Get finger states
        fingers_extended = self._get_finger_states(detection)

        # Update motion history
        palm = detection.get_palm_center()
        self._history.append((palm.x, palm.y))
        if len(self._history) > self._history_max:
            self._history.pop(0)

        # Check for motion gestures first (higher priority)
        motion_gesture = self._detect_motion_gesture()
        if motion_gesture:
            return GestureResult(
                gesture=motion_gesture,
                confidence=0.85,
                hand=detection,
            )

        # Static gesture recognition
        gesture, confidence = self._classify_static_gesture(detection, fingers_extended)

        return GestureResult(
            gesture=gesture,
            confidence=confidence,
            hand=detection,
        )

    def _get_finger_states(self, detection: HandDetection) -> dict[str, bool]:
        """Determine which fingers are extended.

        Uses comparison of fingertip to PIP joint positions.
        For thumb, compares x-position based on handedness.
        """
        lm = detection.landmarks
        is_right = detection.handedness.value == "Right"

        # Thumb: compare tip x position to IP joint
        # For right hand: thumb extended = tip is left of IP
        # For left hand: thumb extended = tip is right of IP
        thumb_extended = (lm[4].x < lm[3].x) if is_right else (lm[4].x > lm[3].x)

        # Other fingers: tip y < PIP y means finger is extended (pointing up)
        # Note: y increases downward in image coordinates
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
        lm = detection.landmarks

        # Count extended fingers
        extended_count = sum(fingers.values())
        all_extended = extended_count == 5
        all_closed = extended_count == 0

        # === OPEN PALM: all fingers extended ===
        if all_extended:
            return GestureType.OPEN_PALM, 0.95

        # === CLOSED FIST: all fingers closed ===
        if all_closed:
            return GestureType.CLOSED_FIST, 0.95

        # === OK SIGN: thumb and index tips close together ===
        thumb_index_dist = self._distance(lm[4], lm[8])
        if thumb_index_dist < 0.05:  # Threshold for "touching"
            return GestureType.OK_SIGN, 0.90

        # === PINCH: thumb and index close but not touching ===
        if thumb_index_dist < 0.1:
            return GestureType.PINCH, 0.85

        # === POINTING: only index extended ===
        if (
            fingers["index"]
            and not fingers["middle"]
            and not fingers["ring"]
            and not fingers["pinky"]
        ):
            return GestureType.POINTING, 0.90

        # === PEACE / VICTORY: index + middle extended ===
        if (
            fingers["index"]
            and fingers["middle"]
            and not fingers["ring"]
            and not fingers["pinky"]
        ):
            return GestureType.PEACE, 0.90

        # === THREE FINGERS: index + middle + ring extended ===
        if (
            fingers["index"]
            and fingers["middle"]
            and fingers["ring"]
            and not fingers["pinky"]
        ):
            return GestureType.THREE_FINGERS, 0.85

        # === ROCK SIGN: index + pinky extended ===
        if (
            fingers["index"]
            and not fingers["middle"]
            and not fingers["ring"]
            and fingers["pinky"]
        ):
            return GestureType.ROCK, 0.85

        # === CALL ME: thumb + pinky extended ===
        if (
            fingers["thumb"]
            and not fingers["index"]
            and not fingers["middle"]
            and not fingers["ring"]
            and fingers["pinky"]
        ):
            return GestureType.CALL_ME, 0.85

        # === THUMBS UP: thumb extended, pointing up ===
        if (
            fingers["thumb"]
            and not fingers["index"]
            and not fingers["middle"]
            and not fingers["ring"]
            and not fingers["pinky"]
        ):
            # Check if thumb is pointing up (tip above CMC joint)
            if lm[4].y < lm[2].y:
                return GestureType.THUMBS_UP, 0.90
            # Check if thumb is pointing down
            elif lm[4].y > lm[2].y:
                return GestureType.THUMBS_DOWN, 0.90

        return GestureType.NONE, 0.0

    def _detect_motion_gesture(self) -> GestureType | None:
        """Detect swipe gestures from motion history."""
        if len(self._history) < 10:
            return None

        # Calculate displacement from start to end
        start_x, start_y = self._history[0]
        end_x, end_y = self._history[-1]

        dx = end_x - start_x
        dy = end_y - start_y

        # Minimum displacement threshold (15% of frame)
        min_dist = 0.15

        # Check for horizontal swipe
        if abs(dx) > min_dist and abs(dx) > abs(dy) * 1.5:
            self._history.clear()  # Reset after detection
            return GestureType.SWIPE_RIGHT if dx > 0 else GestureType.SWIPE_LEFT

        # Check for vertical swipe
        if abs(dy) > min_dist and abs(dy) > abs(dx) * 1.5:
            self._history.clear()
            return GestureType.SWIPE_DOWN if dy > 0 else GestureType.SWIPE_UP

        # Check for wave (oscillation in x)
        if len(self._history) >= self._history_max:
            direction_changes = self._count_direction_changes()
            if direction_changes >= 3:
                self._history.clear()
                return GestureType.WAVE

        return None

    def _count_direction_changes(self) -> int:
        """Count horizontal direction changes in history (for wave detection)."""
        changes = 0
        prev_direction = 0

        for i in range(1, len(self._history)):
            dx = self._history[i][0] - self._history[i - 1][0]
            if abs(dx) < 0.01:  # Ignore small movements
                continue

            direction = 1 if dx > 0 else -1
            if prev_direction != 0 and direction != prev_direction:
                changes += 1
            prev_direction = direction

        return changes

    @staticmethod
    def _distance(a: Landmark, b: Landmark) -> float:
        """Euclidean distance between two landmarks."""
        return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)

    def reset(self) -> None:
        """Clear motion history."""
        self._history.clear()
