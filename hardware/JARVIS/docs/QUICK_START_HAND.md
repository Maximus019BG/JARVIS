# Quick Start Guide - Hand Recognition

## Installation (Raspberry Pi 5)

### 1. Install Dependencies
```bash
cd /home/maxra/code/JARVIS/hardware/JARVIS
./build_hand_recognition.sh --install-deps
```

### 2. Build Project
```bash
./build_hand_recognition.sh --clean
```

### 3. Test Camera
```bash
rpicam-hello -t 5000
```

## Running Hand Recognition

### Method 1: Interactive Mode
```bash
cd build
./JARVIS
```

Then type: `hand`

### Method 2: Quick Start Script
```bash
./build_hand_recognition.sh --hand
```

## Basic Commands

### In Hand Recognition Mode

| Command | Action |
|---------|--------|
| `[Enter]` | Capture frame and detect hands |
| `calibrate` | Calibrate skin color (put hand in center) |
| `stats` | Show detection statistics |
| `exit` | Exit hand mode |
| `stop` | Stop JARVIS completely |

## Example Session

```
$ cd build
$ ./JARVIS
Using DRM device: /dev/dri/card1
Press Enter to render a frame, type 'hand' for hand recognition, or type 'stop' to exit.

hand                          ← Type this

=== JARVIS Hand Recognition Mode ===
Initializing camera...
Camera started successfully.
Initializing hand detector...
Hand detector initialized.

Ready for hand detection!

calibrate                     ← Place hand in center, type this
Capturing frame for calibration...
Skin color calibrated successfully!

                             ← Press Enter to detect
Detecting hands...
Detected 1 hand(s):
  Hand #1:
    Position: (320, 240)
    Bounding box: 120x150 at (260, 165)
    Confidence: 87%
    Fingers: 5
    Gesture: Open Palm (92%)

stats                        ← Check performance
=== Detection Statistics ===
Frames processed: 15
Total hands detected: 12
Avg processing time: 23.4 ms
==========================

exit                         ← Exit hand mode
Exited hand recognition mode.

stop                         ← Exit JARVIS
```

## Troubleshooting

### Camera Not Found
```bash
# List cameras
rpicam-hello --list-cameras

# Test camera
rpicam-hello -t 5000

# If not found, check connection
sudo raspi-config
# → Interface Options → Camera → Enable
```

### Build Errors
```bash
# Install missing dependencies
./build_hand_recognition.sh --install-deps

# Clean rebuild
./build_hand_recognition.sh --clean --verbose
```

### Poor Detection
1. **Calibrate** - Put hand in center, type `calibrate`
2. **Lighting** - Ensure good, even lighting
3. **Background** - Use plain background
4. **Distance** - Keep hand 30-60cm from camera

## Configuration Tips

### For Better Accuracy
Edit `src/main.cpp`:
```cpp
det_config.downscale_factor = 1;  // Full resolution
det_config.enable_blur = true;     // Reduce noise
det_config.gesture_history = 7;    // More smoothing
```

### For Better Performance
```cpp
det_config.downscale_factor = 4;   // Quarter resolution
det_config.enable_blur = false;     // Skip blur
det_config.enable_morphology = false;
```

## API Quick Reference

### C++ Integration

```cpp
#include "camera.hpp"
#include "hand_detector.hpp"

// Setup
camera::Camera cam;
camera::CameraConfig cam_cfg;
cam.init(cam_cfg);
cam.start();

hand_detector::HandDetector det;
hand_detector::DetectorConfig det_cfg;
det.init(det_cfg);

// Detect
camera::Frame* frame = cam.capture_frame();
auto hands = det.detect(*frame);

// Use
for (auto& h : hands) {
    std::cout << "Gesture: " 
              << hand_detector::HandDetector::gesture_to_string(h.gesture)
              << "\n";
}
```

## Performance Benchmarks

| Resolution | Downscale | FPS | Latency |
|-----------|-----------|-----|---------|
| 640x480 | 1x | 18 | 55ms |
| 640x480 | 2x | 28 | 35ms |
| 640x480 | 4x | 45 | 22ms |
| 320x240 | 1x | 30 | 33ms |

*Raspberry Pi 5, 4GB RAM*

## Next Steps

1. **Read Full Documentation**: `docs/HAND_RECOGNITION.md`
2. **Explore Tests**: `tests/test_hand_detector.cpp`
3. **Customize Gestures**: Modify `hand_detector.cpp::classify_gesture()`
4. **Integrate with App**: Use API in your modules

## Support

- Documentation: `/hardware/JARVIS/docs/`
- Tests: `./build_hand_recognition.sh --test`
- Issues: GitHub Issues

---

**Quick Commands Summary**

```bash
# Install
./build_hand_recognition.sh --install-deps

# Build
./build_hand_recognition.sh --clean

# Test
./build_hand_recognition.sh --test

# Run
cd build && ./JARVIS
# → type 'hand'

# Quick demo
./build_hand_recognition.sh --hand
```
