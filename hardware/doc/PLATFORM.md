# JARVIS Hardware Platform Specification

## Platform Overview

This document describes the hardware platform configuration for the JARVIS agentic hardware assistant system.

### Hardware Specifications

| Component | Specification |
|-----------|---------------|
| **Device** | Raspberry Pi 5 |
| **RAM** | 4 GB |
| **Operating System** | Raspberry Pi OS Lite (64-bit) |
| **Camera** | Sony IMX500 (Raspberry Pi Camera Module 3) |
| **Display Output** | Projector (HDMI) |

---

## System Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    JARVIS Hardware App                      │
├─────────────────────────────────────────────────────────────┤
│  Chat Handler (TUI)                                         │
│  ├── Multi-Agent System                                     │
│  │   ├── OrchestratorAgent                                  │
│  │   ├── CoderAgent                                         │
│  │   ├── PlannerAgent                                       │
│  │   ├── BlueprintAgent                                     │
│  │   ├── CriticAgent                                         │
│  │   ├── ResearcherAgent                                    │
│  │   └── MemoryAgent                                        │
│  ├── Tool Registry                                          │
│  └── Memory System                                          │
│       ├── Semantic Memory                                   │
│       ├── Episodic Memory                                   │
│       └── Conversation History                              │
├─────────────────────────────────────────────────────────────┤
│  Hardware Integration                                       │
│  ├── Vision/Camera Subsystem                                │
│  │   ├── IMX500 Camera (Raspberry Pi Camera Module 3)       │
│  │   ├── Hand Gesture Detection                             │
│  │   └── Frame Capture & Processing                         │
│  └── Projection/Display Subsystem                           │
│       ├── Blueprint Engine (Scene Graph + Rendering)        │
│       └── Projector Output                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## IMX500 Camera Module

### Overview

The Sony IMX500 is an intelligent vision sensor with an integrated Neural Processing Unit (NPU) capable of performing on-sensor AI inference. This enables efficient hand gesture detection without loading the main CPU.

### Technical Details

| Feature | Specification |
|---------|---------------|
| **Sensor** | Sony IMX500 |
| **Resolution** | 4056x3040 (12 MP) |
| **NPU** | Integrated Neural Processing Unit |
| **Supported Models** | Hand landmark detection, Person detection |
| **Interface** | MIPI CSI-2 |

### Features Used

- **Hand Landmark Detection**: Real-time 21-point hand skeletal tracking
- **Gesture Recognition**: Maps landmarks to gestures (point, grab, pan, etc.)
- **NPU Acceleration**: On-sensor inference reduces Pi CPU load

### Software Stack

- **rpicam-apps**: Camera capture utilities
- **libcamera**: Camera stack and drivers
- **imx500-all**: IMX500 NPU post-processing
- **TensorFlow Lite**: Model inference with NPU delegate

---

## Projector Integration

### Overview

The system outputs to a projector for display, enabling interactive whiteboard/sketch pad functionality.

### Configuration

- **Output Interface**: HDMI
- **Resolution**: Native projector resolution (typically 1920x1080)
- **Display Mode**: Extended desktop or mirrored
- **Rendering Backend**: OpenCV / NumPy framebuffer

### Features

- **Blueprint Engine**: Scene graph-based 2D drawing system
- **Drawing Primitives**: Lines, rectangles, circles, polygons, text
- **Grid System**: Configurable grid overlay for precision
- **Transforms**: Translation, rotation, scaling with undo/redo
- **Selection System**: Multi-object selection and manipulation

---

## Software Stack

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| Python | 3.13+ | Application runtime |
| OpenCV | latest | Image processing |
| NumPy | latest | Numerical operations |
| libcamera | latest | Camera control |
| rpicam-apps | latest | Camera utilities |

### Python Dependencies

Managed via `uv` with `pyproject.toml`:

- **AI/LLM**: google-genai, ollama, groq
- **TTS**: pyttsx3, gtts
- **Vision**: opencv-python, numpy
- **Database**: sqlite3 (built-in), async database drivers
- **UI**: textual (TUI framework)

### AI Models

- **Primary**: Ollama (gemma3:1b) running locally on Pi
- **Fallback**: Google Gemini API
- **Alternative**: Groq API

---

## Performance Considerations

### RAM Utilization (4GB Target)

| Component | Estimated Usage |
|-----------|-----------------|
| Base System (OS Lite) | ~500 MB |
| Python Runtime | ~200 MB |
| Ollama (gemma3:1b) | ~1.5 GB |
| OpenCV/Camera Buffer | ~100 MB |
| Application Code | ~200 MB |
| **Headroom** | ~1.5 GB |

### Optimization Strategies

1. **Model Selection**: Use smaller models (gemma3:1b, llama3.2:1b) to fit in 4GB
2. **Camera Resolution**: Reduce capture resolution if frame processing lags
3. **Memory Management**: Streaming frame capture instead of buffering
4. **NPU Offloading**: Leverage IMX500 NPU for gesture detection

---

## Network Configuration

### Sync API

The system syncs blueprints to a cloud server:

```
Primary URL: https://jarvisweb.cloud
Local Fallback: http://localhost:3000
```

Configure via `SYNC_API_BASE_URL` environment variable.

---

## Security

### File Access Control

- **Security Level**: HIGH (default)
- **Allowed Paths**: `./data`, `./temp`
- **Blocked Paths**: `/etc`, `/sys`, `/proc`
- **Max File Size**: 10 MB
- **Audit Logging**: Enabled

---

## Deployment

### Installation Steps

1. Flash Raspberry Pi OS Lite (64-bit) to SD card
2. Configure WiFi/Ethernet
3. Enable camera interface: `sudo raspi-config`
4. Install dependencies:
   ```bash
   sudo apt update
   sudo apt install -y libcap-dev libcamera-dev rpicam-apps imx500-all
   ```
5. Install Python 3.13+
6. Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
7. Sync dependencies: `uv sync`
8. Configure `.env` file
9. Run: `python app.py`

### Build Executable

```bash
./build.sh
./build/jarvis
```

---

## Known Limitations

- **RAM Constraint**: 4GB limits local LLM model size
- **No GUI**: Text-based TUI only
- **Single Camera**: Only one IMX500 supported
- **Audio Input**: Push-to-talk mode only

---

## Future Enhancements

- Multi-camera support
- Audio input (Vosk STT)
- Bluetooth device pairing
- Additional gesture commands
- Cloud model offloading
