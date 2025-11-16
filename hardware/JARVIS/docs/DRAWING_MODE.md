# Drawing Mode - User Guide

## Overview

The JARVIS drawing mode allows you to draw on screen by pointing your index finger at the camera. Drawings are automatically saved in a custom `.jarvis` file format (JSON-based) and can be loaded later.

## Quick Start

### 1. Start Drawing Mode

```bash
./JARVIS
# Type: hand
# Enter sketch name: my_drawing
```

### 2. Draw with Your Hand

- **👉 Point** with your index finger to draw
- **✊ Make a fist** to stop drawing (lift pen)
- Move your hand smoothly for best results

### 3. Interactive Commands

While drawing, press:
- **`s`** - Save sketch to file
- **`c`** - Clear sketch (start over)
- **`i`** - Show sketch information (stroke count, points)
- **`q`** - Quit and auto-save

### 4. Load a Sketch

```bash
./JARVIS
# Type: load my_drawing
# (Press Enter to continue after viewing)
```

## File Format

Sketches are saved as `.jarvis` files in JSON format:

```json
{
  "name": "my_drawing",
  "width": 640,
  "height": 480,
  "created_timestamp": 1700000000000,
  "strokes": [
    {
      "color": 16777215,
      "thickness": 5,
      "points": [
        {"x": 100, "y": 100},
        {"x": 150, "y": 150},
        {"x": 200, "y": 200}
      ]
    }
  ]
}
```

### Fields

- **name**: Sketch identifier
- **width/height**: Canvas dimensions
- **created_timestamp**: Creation time in milliseconds
- **strokes**: Array of continuous drawing strokes
  - **color**: RGB color (0x00RRGGBB format)
  - **thickness**: Line width in pixels
  - **points**: Array of {x, y} coordinates

## Features

### Auto-Calibration

The system automatically calibrates hand detection on the first good hand detection (>70% confidence). No manual setup required!

### Gesture Recognition

- **POINTING** gesture starts/continues drawing
- **FIST** gesture stops drawing (pen up)
- Other gestures are ignored

### Smoothing

The system applies motion smoothing to:
- Reduce jittery lines
- Filter out noise
- Create smoother drawings

Parameters:
- 3-point moving average for position
- Minimum 5-pixel distance between points
- Auto-finish stroke after 30 frames of no movement

### Production-Ready Tracking

Uses the `ProductionHandDetector` with:
- Multi-frame tracking for stability
- Adaptive lighting compensation
- Fast gesture response (5-frame stabilization)

## Tips for Best Results

### Lighting

✅ **Do:**
- Use bright, even lighting
- Avoid shadows on your hand
- Position camera 40-60cm from hand

❌ **Avoid:**
- Backlighting
- Very dark or very bright environments
- Colored lighting that affects skin tone

### Hand Position

✅ **Do:**
- Point clearly with index finger extended
- Keep other fingers closed (make pointing gesture clear)
- Move smoothly and deliberately
- Keep hand in camera view

❌ **Avoid:**
- Ambiguous hand positions
- Very fast movements
- Partially occluded hand
- Hand too close or too far from camera

### Drawing

✅ **Do:**
- Start with simple shapes
- Draw continuously in one stroke
- Pause (make fist) between strokes
- Save frequently (`s` key)

❌ **Avoid:**
- Drawing too fast
- Erratic movements
- Leaving hand pointing while thinking

## Examples

### Basic Usage

```bash
# Start JARVIS
./JARVIS

# Enter drawing mode
hand

# Name your sketch
Enter sketch name: circle

# Draw a circle by pointing and moving your finger
# Make a fist when done
# Press 's' to save
# Press 'q' to quit
```

### Loading a Sketch

```bash
# Start JARVIS
./JARVIS

# Load previous sketch
load circle

# View it on screen
# Press Enter to continue
```

## File Management

### Saving

Sketches are saved with `.jarvis` extension automatically:
- Input: `my_drawing` → File: `my_drawing.jarvis`
- Auto-saved when you press `q` to quit

### Loading

Load without the `.jarvis` extension:
```bash
load my_drawing    # Loads my_drawing.jarvis
```

### Location

Files are saved in the current working directory (where you ran `./JARVIS`).

## Architecture

```
Drawing Mode Flow:
┌─────────────┐
│   Camera    │ → Capture frame (640x480 @ 30fps)
└─────────────┘
      ↓
┌─────────────────────┐
│ ProductionDetector  │ → Detect hands with gestures
│  - Multi-tracking   │
│  - Auto-calibration │
└─────────────────────┘
      ↓
┌─────────────┐
│  SketchPad  │ → Update drawing state
│  - Smoothing│    - POINTING → add points
│  - Tracking │    - FIST → end stroke
└─────────────┘
      ↓
┌─────────────┐
│   Render    │ → Draw to DRM display
│  - Strokes  │    - Clear background
│  - Points   │    - Draw all strokes
└─────────────┘
      ↓
┌─────────────┐
│ Save/Load   │ → .jarvis files (JSON)
└─────────────┘
```

## Performance

- **Frame rate**: ~20-30 FPS
- **Latency**: ~50ms (camera → display)
- **Smoothing**: 3-frame window (~100ms)
- **Render**: Every 3 frames (optimized)

## Troubleshooting

### Hand Not Detected

**Problem:** Pointing gesture not recognized

**Solutions:**
1. Improve lighting
2. Make pointing gesture more distinct
3. Ensure hand is 40-60cm from camera
4. Check camera is working: verify other modes work

### Jittery Lines

**Problem:** Lines are not smooth

**Solutions:**
1. Move hand more slowly
2. Keep hand steadier
3. Ensure good lighting (helps tracking)
4. System already applies 3-point smoothing

### Drawing Doesn't Save

**Problem:** Press `s` but file not created

**Solutions:**
1. Check disk space
2. Verify write permissions in current directory
3. Check console for error messages
4. Try a different sketch name (no special characters)

### Can't Load Sketch

**Problem:** `load` command fails

**Solutions:**
1. Verify file exists: `ls *.jarvis`
2. Use correct name (without .jarvis extension)
3. Check file is valid JSON
4. Try re-saving the sketch

## API Reference

### SketchPad Class

```cpp
#include "sketch_pad.hpp"

// Create sketch pad
sketch::SketchPad pad(640, 480);
pad.init("my_sketch", 640, 480);

// Set drawing parameters
pad.set_color(0x00FFFFFF);  // White
pad.set_thickness(5);        // 5 pixels

// Update with hand detections
std::vector<hand_detector::HandDetection> hands = detector.detect(frame);
bool is_drawing = pad.update(hands);

// Render to buffer
pad.render(map_data, map_stride, width, height);

// Save/load
pad.save("my_sketch");  // Saves as my_sketch.jarvis
pad.load("my_sketch");  // Loads from my_sketch.jarvis

// Info
int strokes = pad.get_stroke_count();
int points = pad.get_total_points();
```

### Sketch Structure

```cpp
#include "sketch_pad.hpp"

sketch::Sketch sketch;
sketch.name = "example";
sketch.width = 640;
sketch.height = 480;

sketch::Stroke stroke;
stroke.color = 0x00FF0000;  // Red
stroke.thickness = 3;
stroke.points.push_back(sketch::Point(100, 100));
stroke.points.push_back(sketch::Point(200, 200));

sketch.strokes.push_back(stroke);

// Save
sketch.save("example");  // Creates example.jarvis

// Load
sketch.load("example");
```

## Future Enhancements

Potential features for future versions:
- [ ] Color palette selection
- [ ] Thickness adjustment (thin/medium/thick)
- [ ] Eraser mode (open palm to erase)
- [ ] Undo/redo functionality
- [ ] Export to PNG/SVG
- [ ] Multi-layer support
- [ ] Shape recognition (circle → perfect circle)
- [ ] Text mode
- [ ] Brush styles (solid, dashed, dotted)

## License

Part of the JARVIS project. See main LICENSE file.
