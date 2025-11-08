# Hand Recognition Module - Enterprise Documentation

## Overview

The JARVIS hand recognition system provides real-time hand detection and gesture recognition using computer vision algorithms optimized for Raspberry Pi 5 with AI camera. This module is designed for production use with enterprise-level features including calibration, statistics tracking, and robust error handling.

## Features

### Core Capabilities
- **Real-time Hand Detection**: Skin color-based detection using HSV color space
- **Gesture Recognition**: Recognizes 6+ standard gestures
- **Finger Counting**: Accurate finger counting (0-5)
- **Calibration**: Adaptive skin color calibration for different lighting conditions
- **Performance Monitoring**: Built-in statistics and performance tracking
- **Configurable Pipeline**: Extensive configuration options for different use cases

### Supported Gestures
1. **Open Palm** - All fingers extended
2. **Fist** - All fingers closed
3. **Pointing** - Index finger extended
4. **Peace** - Index and middle fingers extended (V sign)
5. **Thumbs Up** - Thumb extended
6. **OK Sign** - Thumb and index forming circle
7. **Custom** - Extensible for custom gestures

## Architecture

### Components

```
┌─────────────────────────────────────────────┐
│           JARVIS Application                │
│  ┌───────────────────────────────────────┐  │
│  │         main.cpp (CLI)                │  │
│  └───────────────┬───────────────────────┘  │
│                  │                           │
│  ┌───────────────▼───────────┐               │
│  │   Camera Interface        │               │
│  │   (camera.hpp/cpp)        │               │
│  │   - Frame capture         │               │
│  │   - Format conversion     │               │
│  │   - Image utilities       │               │
│  └───────────────┬───────────┘               │
│                  │                           │
│  ┌───────────────▼───────────┐               │
│  │   Hand Detector           │               │
│  │   (hand_detector.hpp/cpp) │               │
│  │   - Skin detection        │               │
│  │   - Contour analysis      │               │
│  │   - Gesture classification│               │
│  │   - Statistics tracking   │               │
│  └───────────────────────────┘               │
└─────────────────────────────────────────────┘
```

### Detection Pipeline

1. **Frame Acquisition** → Camera captures RGB frame
2. **Preprocessing** → Optional downscaling and blur
3. **Color Space Conversion** → RGB to HSV
4. **Skin Segmentation** → Apply skin color mask
5. **Morphological Operations** → Erosion + Dilation (noise removal)
6. **Contour Detection** → Find connected regions
7. **Hand Analysis** → Bounding box, centroid, finger count
8. **Gesture Classification** → Classify based on features
9. **Temporal Stabilization** → Smooth gestures over frames

## Usage

### Basic Usage

```cpp
#include "camera.hpp"
#include "hand_detector.hpp"

// Initialize camera
camera::Camera cam;
camera::CameraConfig cam_config;
cam_config.width = 640;
cam_config.height = 480;
cam_config.framerate = 30;

cam.init(cam_config);
cam.start();

// Initialize detector
hand_detector::HandDetector detector;
hand_detector::DetectorConfig det_config;
det_config.enable_gesture = true;
det_config.verbose = true;

detector.init(det_config);

// Detection loop
while (running) {
    camera::Frame* frame = cam.capture_frame();
    
    if (frame) {
        auto detections = detector.detect(*frame);
        
        for (const auto& hand : detections) {
            std::cout << "Gesture: " 
                     << hand_detector::HandDetector::gesture_to_string(hand.gesture)
                     << " (" << hand.num_fingers << " fingers)\n";
        }
    }
}

cam.stop();
```

### Console Application

When running the JARVIS application:

```bash
cd build
./JARVIS
```

Type `hand` to enter hand recognition mode:

```
=== JARVIS Hand Recognition Mode ===
Initializing camera...
Camera started successfully.
Initializing hand detector...

Commands:
  [Enter]     - Capture and detect hands
  'calibrate' - Calibrate skin color (place hand in center)
  'stats'     - Show detection statistics
  'exit'      - Exit hand recognition mode

Ready for hand detection!
```

### Calibration

For optimal detection accuracy:

1. Place your hand in the center of the camera view
2. Ensure good lighting (avoid shadows)
3. Type `calibrate` and press Enter
4. The system will analyze skin color in the center region
5. Updated HSV thresholds will be applied

### Configuration

#### Detector Configuration Options

```cpp
hand_detector::DetectorConfig config;

// Skin color range (HSV)
config.hue_min = 0;      // 0-179 (red-orange range)
config.hue_max = 20;
config.sat_min = 30;     // 0-255
config.sat_max = 255;
config.val_min = 60;     // 0-255
config.val_max = 255;

// Detection parameters
config.min_hand_area = 2000;    // Minimum contour area
config.max_hand_area = 200000;  // Maximum contour area
config.min_confidence = 0.3f;   // 0.0-1.0

// Preprocessing
config.enable_blur = true;
config.blur_kernel = 5;
config.enable_morphology = true;

// Gesture recognition
config.enable_gesture = true;
config.gesture_history = 5;     // Frames for stabilization

// Performance
config.downscale_factor = 2;    // Process at 1/2 resolution
config.verbose = true;
```

#### Camera Configuration Options

```cpp
camera::CameraConfig config;

config.width = 640;           // Frame width
config.height = 480;          // Frame height
config.framerate = 30;        // FPS
config.format = camera::PixelFormat::RGB888;
config.verbose = true;
```

## Performance Optimization

### Raspberry Pi 5 Optimizations

1. **Resolution Scaling**: Use `downscale_factor = 2` to process at half resolution
   - Reduces computation by 75%
   - Minimal accuracy loss for hand detection

2. **Morphological Operations**: Keep enabled for noise reduction
   - Improves detection accuracy
   - Small performance cost

3. **Gesture History**: Set to 3-5 frames for smooth recognition
   - Reduces jitter in gesture classification
   - Negligible memory overhead

### Expected Performance

| Configuration | Resolution | FPS | CPU Usage |
|--------------|-----------|-----|-----------|
| High Quality | 640x480 | 15-20 | 40-50% |
| Balanced | 320x240 | 25-30 | 25-35% |
| Fast | 160x120 | 30+ | 15-25% |

*Tested on Raspberry Pi 5 (4GB)*

## API Reference

### HandDetector Class

```cpp
class HandDetector {
public:
    // Initialize with configuration
    bool init(const DetectorConfig& config);
    
    // Detect hands in frame
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    // Calibrate skin color from ROI
    bool calibrate_skin(const camera::Frame& frame, 
                       int roi_x, int roi_y, 
                       int roi_w, int roi_h);
    
    // Get/set configuration
    void set_config(const DetectorConfig& config);
    const DetectorConfig& get_config() const;
    
    // Statistics
    const Stats& get_stats() const;
    void reset_stats();
    
    // Utility
    static std::string gesture_to_string(Gesture g);
    static Gesture string_to_gesture(const std::string& s);
};
```

### HandDetection Structure

```cpp
struct HandDetection {
    BoundingBox bbox;              // Hand bounding box
    Point center;                  // Center of mass
    Gesture gesture;               // Detected gesture
    float gesture_confidence;      // 0.0-1.0
    int num_fingers;               // 0-5
    std::vector<Point> contour;    // Hand outline
    std::vector<Point> fingertips; // Fingertip positions
};
```

### Camera Class

```cpp
class Camera {
public:
    // Initialize camera
    bool init(const CameraConfig& config);
    
    // Start/stop capture
    bool start();
    void stop();
    
    // Capture single frame (blocking)
    Frame* capture_frame();
    
    // Status
    bool is_running() const;
    const std::string& get_error() const;
    
    // Utility
    static int list_cameras();
};
```

## Testing

### Build and Run Tests

```bash
cd build
make jarvis_tests
./jarvis_tests
```

### Test Coverage

- Point distance calculations
- Bounding box operations
- Gesture string conversion
- Detector initialization
- Frame processing
- Skin calibration
- Statistics tracking
- Drawing utilities
- Color space conversion

## Troubleshooting

### Common Issues

#### No Camera Detected

```
Failed to initialize camera: Camera not found
```

**Solution**: Ensure `rpicam-hello` works:
```bash
rpicam-hello --list-cameras
rpicam-hello -t 5000
```

#### No Hands Detected

**Symptoms**: `No hands detected` even with hand visible

**Solutions**:
1. Run calibration with hand in view
2. Adjust lighting (avoid backlighting)
3. Lower `min_hand_area` threshold
4. Check camera is not obstructed
5. Increase `hue_max` for different skin tones

#### Poor Gesture Recognition

**Solutions**:
1. Increase `gesture_history` for more stability
2. Ensure clear hand visibility (no obstructions)
3. Make gestures deliberately and hold for 1-2 seconds
4. Calibrate skin color in current lighting

#### Low FPS

**Solutions**:
1. Increase `downscale_factor` (try 2 or 4)
2. Reduce camera resolution
3. Disable `enable_blur` if not needed
4. Close other CPU-intensive applications

## Integration Examples

### Example 1: Gesture-Based Control

```cpp
auto detections = detector.detect(*frame);

for (const auto& hand : detections) {
    switch (hand.gesture) {
        case Gesture::OPEN_PALM:
            // Execute "stop" command
            break;
        case Gesture::FIST:
            // Execute "close" command
            break;
        case Gesture::POINTING:
            // Execute "select" at hand.center
            break;
        case Gesture::PEACE:
            // Execute "confirm" command
            break;
    }
}
```

### Example 2: Hand Tracking

```cpp
static Point last_position;

auto detections = detector.detect(*frame);

if (!detections.empty()) {
    Point current_pos = detections[0].center;
    
    int dx = current_pos.x - last_position.x;
    int dy = current_pos.y - last_position.y;
    
    // Use dx, dy for cursor movement
    move_cursor(dx, dy);
    
    last_position = current_pos;
}
```

### Example 3: Multi-Hand Detection

```cpp
auto detections = detector.detect(*frame);

std::cout << "Detected " << detections.size() << " hands\n";

for (size_t i = 0; i < detections.size(); i++) {
    std::cout << "Hand " << i << ": "
             << HandDetector::gesture_to_string(detections[i].gesture)
             << " at (" << detections[i].center.x 
             << ", " << detections[i].center.y << ")\n";
}
```

## Security Considerations

### Data Privacy
- All processing is local (no cloud dependency)
- No frame storage or recording
- Camera only active when explicitly started

### Resource Management
- Automatic cleanup on shutdown
- Memory bounded by frame buffer size
- CPU usage configurable via downscaling

## Future Enhancements

### Planned Features
1. **Neural Network Integration**: TensorFlow Lite support for improved accuracy
2. **Advanced Gestures**: Swipe, rotate, pinch recognition
3. **Hand Pose Estimation**: Full 21-point hand skeleton
4. **Multi-threading**: Parallel processing pipeline
5. **GPU Acceleration**: VideoCore VII offloading

### Contribution Guidelines
See main JARVIS CONTRIBUTING.md for details.

## License

See LICENSE file in repository root.

## Support

For issues and questions:
- GitHub Issues: [JARVIS Repository](https://github.com/Maximus019BG/JARVIS)
- Documentation: `/hardware/JARVIS/docs/`

---

**Version**: 1.0.0  
**Last Updated**: November 2025  
**Maintainer**: JARVIS Development Team
