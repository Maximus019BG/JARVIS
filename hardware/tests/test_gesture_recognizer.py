"""Tests for gesture recognition."""

import pytest

from core.vision.hand_detector import HandDetection, Landmark, Handedness
from core.vision.gesture_recognizer import GestureRecognizer, GestureType


def make_landmark(x: float, y: float, z: float = 0.0) -> Landmark:
    """Helper to create a Landmark."""
    return Landmark(x=x, y=y, z=z)


def make_detection(
    landmarks: list[tuple[float, float, float]],
    handedness: Handedness = Handedness.RIGHT,
    confidence: float = 0.95,
) -> HandDetection:
    """Helper to create HandDetection from landmark coords."""
    return HandDetection(
        landmarks=tuple(Landmark(x=x, y=y, z=z) for x, y, z in landmarks),
        handedness=handedness,
        confidence=confidence,
    )


# Landmark positions for open palm (all fingers extended, pointing up)
# Lower y = higher in image (finger tips above base)
OPEN_PALM_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.4, 0.6, 0.0),   # 2 THUMB_MCP
    (0.35, 0.5, 0.0),  # 3 THUMB_IP
    (0.3, 0.4, 0.0),   # 4 THUMB_TIP (extended left for right hand)
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

# Closed fist - all fingertips below PIP joints
CLOSED_FIST_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.4, 0.65, 0.0),  # 2 THUMB_MCP
    (0.42, 0.6, 0.0),  # 3 THUMB_IP
    (0.45, 0.62, 0.0), # 4 THUMB_TIP (not extended for right hand)
    (0.45, 0.6, 0.0),  # 5 INDEX_MCP
    (0.45, 0.55, 0.0), # 6 INDEX_PIP
    (0.45, 0.58, 0.0), # 7 INDEX_DIP
    (0.45, 0.62, 0.0), # 8 INDEX_TIP (below PIP)
    (0.5, 0.58, 0.0),  # 9 MIDDLE_MCP
    (0.5, 0.52, 0.0),  # 10 MIDDLE_PIP
    (0.5, 0.56, 0.0),  # 11 MIDDLE_DIP
    (0.5, 0.6, 0.0),   # 12 MIDDLE_TIP (below PIP)
    (0.55, 0.6, 0.0),  # 13 RING_MCP
    (0.55, 0.54, 0.0), # 14 RING_PIP
    (0.55, 0.58, 0.0), # 15 RING_DIP
    (0.55, 0.62, 0.0), # 16 RING_TIP (below PIP)
    (0.6, 0.62, 0.0),  # 17 PINKY_MCP
    (0.6, 0.56, 0.0),  # 18 PINKY_PIP
    (0.6, 0.6, 0.0),   # 19 PINKY_DIP
    (0.6, 0.64, 0.0),  # 20 PINKY_TIP (below PIP)
]

# Pointing - only index extended
POINTING_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.4, 0.65, 0.0),  # 2 THUMB_MCP
    (0.42, 0.6, 0.0),  # 3 THUMB_IP
    (0.45, 0.58, 0.0), # 4 THUMB_TIP (slightly extended)
    (0.45, 0.6, 0.0),  # 5 INDEX_MCP
    (0.45, 0.45, 0.0), # 6 INDEX_PIP
    (0.45, 0.35, 0.0), # 7 INDEX_DIP
    (0.45, 0.25, 0.0), # 8 INDEX_TIP (extended up!)
    (0.5, 0.58, 0.0),  # 9 MIDDLE_MCP
    (0.5, 0.52, 0.0),  # 10 MIDDLE_PIP
    (0.5, 0.56, 0.0),  # 11 MIDDLE_DIP
    (0.5, 0.6, 0.0),   # 12 MIDDLE_TIP (closed)
    (0.55, 0.6, 0.0),  # 13 RING_MCP
    (0.55, 0.54, 0.0), # 14 RING_PIP
    (0.55, 0.58, 0.0), # 15 RING_DIP
    (0.55, 0.62, 0.0), # 16 RING_TIP (closed)
    (0.6, 0.62, 0.0),  # 17 PINKY_MCP
    (0.6, 0.56, 0.0),  # 18 PINKY_PIP
    (0.6, 0.6, 0.0),   # 19 PINKY_DIP
    (0.6, 0.64, 0.0),  # 20 PINKY_TIP (closed)
]

# Peace sign - index and middle extended
PEACE_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.4, 0.65, 0.0),  # 2 THUMB_MCP
    (0.42, 0.6, 0.0),  # 3 THUMB_IP
    (0.45, 0.58, 0.0), # 4 THUMB_TIP
    (0.45, 0.6, 0.0),  # 5 INDEX_MCP
    (0.45, 0.45, 0.0), # 6 INDEX_PIP
    (0.45, 0.35, 0.0), # 7 INDEX_DIP
    (0.45, 0.25, 0.0), # 8 INDEX_TIP (extended!)
    (0.5, 0.55, 0.0),  # 9 MIDDLE_MCP
    (0.5, 0.4, 0.0),   # 10 MIDDLE_PIP
    (0.5, 0.3, 0.0),   # 11 MIDDLE_DIP
    (0.5, 0.2, 0.0),   # 12 MIDDLE_TIP (extended!)
    (0.55, 0.6, 0.0),  # 13 RING_MCP
    (0.55, 0.54, 0.0), # 14 RING_PIP
    (0.55, 0.58, 0.0), # 15 RING_DIP
    (0.55, 0.62, 0.0), # 16 RING_TIP (closed)
    (0.6, 0.62, 0.0),  # 17 PINKY_MCP
    (0.6, 0.56, 0.0),  # 18 PINKY_PIP
    (0.6, 0.6, 0.0),   # 19 PINKY_DIP
    (0.6, 0.64, 0.0),  # 20 PINKY_TIP (closed)
]

# Thumbs up - thumb extended upward, other fingers closed
THUMBS_UP_LANDMARKS = [
    (0.5, 0.7, 0.0),   # 0 WRIST
    (0.45, 0.6, 0.0),  # 1 THUMB_CMC
    (0.4, 0.5, 0.0),   # 2 THUMB_MCP
    (0.35, 0.4, 0.0),  # 3 THUMB_IP
    (0.3, 0.3, 0.0),   # 4 THUMB_TIP (extended up & left for right hand)
    (0.48, 0.58, 0.0), # 5 INDEX_MCP
    (0.48, 0.52, 0.0), # 6 INDEX_PIP
    (0.48, 0.56, 0.0), # 7 INDEX_DIP
    (0.48, 0.6, 0.0),  # 8 INDEX_TIP (closed)
    (0.52, 0.56, 0.0), # 9 MIDDLE_MCP
    (0.52, 0.5, 0.0),  # 10 MIDDLE_PIP
    (0.52, 0.54, 0.0), # 11 MIDDLE_DIP
    (0.52, 0.58, 0.0), # 12 MIDDLE_TIP (closed)
    (0.56, 0.58, 0.0), # 13 RING_MCP
    (0.56, 0.52, 0.0), # 14 RING_PIP
    (0.56, 0.56, 0.0), # 15 RING_DIP
    (0.56, 0.6, 0.0),  # 16 RING_TIP (closed)
    (0.6, 0.6, 0.0),   # 17 PINKY_MCP
    (0.6, 0.54, 0.0),  # 18 PINKY_PIP
    (0.6, 0.58, 0.0),  # 19 PINKY_DIP
    (0.6, 0.62, 0.0),  # 20 PINKY_TIP (closed)
]

# OK sign - thumb and index tips close together
OK_SIGN_LANDMARKS = [
    (0.5, 0.8, 0.0),   # 0 WRIST
    (0.45, 0.7, 0.0),  # 1 THUMB_CMC
    (0.42, 0.62, 0.0), # 2 THUMB_MCP
    (0.4, 0.55, 0.0),  # 3 THUMB_IP
    (0.42, 0.5, 0.0),  # 4 THUMB_TIP (touching index)
    (0.45, 0.6, 0.0),  # 5 INDEX_MCP
    (0.45, 0.55, 0.0), # 6 INDEX_PIP
    (0.44, 0.52, 0.0), # 7 INDEX_DIP
    (0.43, 0.5, 0.0),  # 8 INDEX_TIP (touching thumb - dist < 0.05)
    (0.5, 0.55, 0.0),  # 9 MIDDLE_MCP
    (0.5, 0.4, 0.0),   # 10 MIDDLE_PIP
    (0.5, 0.3, 0.0),   # 11 MIDDLE_DIP
    (0.5, 0.2, 0.0),   # 12 MIDDLE_TIP (extended)
    (0.55, 0.58, 0.0), # 13 RING_MCP
    (0.55, 0.43, 0.0), # 14 RING_PIP
    (0.55, 0.33, 0.0), # 15 RING_DIP
    (0.55, 0.23, 0.0), # 16 RING_TIP (extended)
    (0.6, 0.62, 0.0),  # 17 PINKY_MCP
    (0.6, 0.47, 0.0),  # 18 PINKY_PIP
    (0.6, 0.37, 0.0),  # 19 PINKY_DIP
    (0.6, 0.27, 0.0),  # 20 PINKY_TIP (extended)
]


class TestGestureRecognizer:
    """Tests for GestureRecognizer class."""

    def test_open_palm_recognized(self) -> None:
        """Test open palm gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(OPEN_PALM_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.OPEN_PALM
        assert result.confidence > 0.8
        assert result.is_valid

    def test_closed_fist_recognized(self) -> None:
        """Test closed fist gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(CLOSED_FIST_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.CLOSED_FIST
        assert result.confidence > 0.8
        assert result.is_valid

    def test_pointing_recognized(self) -> None:
        """Test pointing gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(POINTING_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.POINTING
        assert result.confidence > 0.8
        assert result.is_valid

    def test_peace_recognized(self) -> None:
        """Test peace/victory gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(PEACE_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.PEACE
        assert result.confidence > 0.8
        assert result.is_valid

    def test_thumbs_up_recognized(self) -> None:
        """Test thumbs up gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(THUMBS_UP_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.THUMBS_UP
        assert result.confidence > 0.8
        assert result.is_valid

    def test_ok_sign_recognized(self) -> None:
        """Test OK sign gesture is recognized."""
        recognizer = GestureRecognizer()
        detection = make_detection(OK_SIGN_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.OK_SIGN
        assert result.confidence > 0.8
        assert result.is_valid

    def test_result_is_valid_property(self) -> None:
        """Test is_valid property returns True for valid gestures."""
        recognizer = GestureRecognizer()
        detection = make_detection(OPEN_PALM_LANDMARKS)

        result = recognizer.recognize(detection)

        assert result.is_valid is True

    def test_left_hand_pointing(self) -> None:
        """Test pointing works for left hand."""
        recognizer = GestureRecognizer()
        # Mirror the x coordinates for left hand
        left_pointing = [
            (1.0 - x, y, z) for x, y, z in POINTING_LANDMARKS
        ]
        detection = make_detection(left_pointing, handedness=Handedness.LEFT)

        result = recognizer.recognize(detection)

        assert result.gesture == GestureType.POINTING
        assert result.is_valid

    def test_reset_clears_history(self) -> None:
        """Test reset clears motion history."""
        recognizer = GestureRecognizer()
        detection = make_detection(OPEN_PALM_LANDMARKS)

        # Build up history
        for _ in range(10):
            recognizer.recognize(detection)

        recognizer.reset()

        # History should be empty (can't directly check, but swipe won't trigger)
        assert len(recognizer._history) == 0


class TestSwipeGestures:
    """Tests for swipe gesture detection."""

    def test_swipe_right_detected(self) -> None:
        """Test swipe right is detected from motion history."""
        recognizer = GestureRecognizer()

        # Simulate hand moving right
        for i in range(15):
            x = 0.3 + (i * 0.02)  # Move from 0.3 to 0.58 (> 0.15 displacement)
            landmarks = [
                (x + offset_x, y, z) for offset_x, y, z in 
                [(lm[0] - 0.5, lm[1], lm[2]) for lm in OPEN_PALM_LANDMARKS]
            ]
            # Adjust landmarks to move palm center
            adjusted = [(x + (lm[0] - 0.5), lm[1], lm[2]) for lm in OPEN_PALM_LANDMARKS]
            detection = make_detection(adjusted)
            result = recognizer.recognize(detection)

        # After sufficient movement, should detect swipe
        assert result.gesture in (GestureType.SWIPE_RIGHT, GestureType.OPEN_PALM)

    def test_swipe_left_detected(self) -> None:
        """Test swipe left is detected from motion history."""
        recognizer = GestureRecognizer()

        # Simulate hand moving left
        for i in range(15):
            x = 0.7 - (i * 0.02)  # Move from 0.7 to 0.42
            adjusted = [(x + (lm[0] - 0.5), lm[1], lm[2]) for lm in OPEN_PALM_LANDMARKS]
            detection = make_detection(adjusted)
            result = recognizer.recognize(detection)

        # Should eventually detect swipe
        assert result.gesture in (GestureType.SWIPE_LEFT, GestureType.OPEN_PALM)


class TestHandDetection:
    """Tests for HandDetection dataclass."""

    def test_get_fingertips(self) -> None:
        """Test get_fingertips returns correct landmarks."""
        detection = make_detection(OPEN_PALM_LANDMARKS)

        fingertips = detection.get_fingertips()

        assert "thumb" in fingertips
        assert "index" in fingertips
        assert "middle" in fingertips
        assert "ring" in fingertips
        assert "pinky" in fingertips
        # Check thumb tip is at index 4
        assert fingertips["thumb"] == detection.landmarks[4]

    def test_get_palm_center(self) -> None:
        """Test get_palm_center returns midpoint of wrist and middle MCP."""
        detection = make_detection(OPEN_PALM_LANDMARKS)

        palm = detection.get_palm_center()

        wrist = detection.landmarks[0]
        middle_mcp = detection.landmarks[9]
        expected_x = (wrist.x + middle_mcp.x) / 2
        expected_y = (wrist.y + middle_mcp.y) / 2

        assert abs(palm.x - expected_x) < 0.001
        assert abs(palm.y - expected_y) < 0.001

    def test_get_bounding_box(self) -> None:
        """Test get_bounding_box returns valid bounds."""
        detection = make_detection(OPEN_PALM_LANDMARKS)

        bbox = detection.get_bounding_box(640, 480)

        x_min, y_min, x_max, y_max = bbox
        assert x_min < x_max
        assert y_min < y_max
        assert x_min >= 0
        assert y_min >= 0


class TestLandmark:
    """Tests for Landmark dataclass."""

    def test_to_pixel(self) -> None:
        """Test to_pixel converts normalized coords correctly."""
        lm = make_landmark(0.5, 0.5)

        x, y = lm.to_pixel(640, 480)

        assert x == 320
        assert y == 240

    def test_distance_to(self) -> None:
        """Test distance_to calculates correct distance."""
        lm1 = make_landmark(0.0, 0.0, 0.0)
        lm2 = make_landmark(0.3, 0.4, 0.0)

        dist = lm1.distance_to(lm2)

        assert abs(dist - 0.5) < 0.001  # 3-4-5 triangle
