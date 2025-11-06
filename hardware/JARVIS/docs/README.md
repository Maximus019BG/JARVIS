# JARVIS Hardware Display Controller

C++ application for controlling DRM/KMS displays on Linux (e.g., Raspberry Pi) with remote blueprint rendering.

## Features

- Direct DRM/KMS rendering (no X11/Wayland required)
- AES-256 encrypted device/blueprint IDs
- HTTP client for fetching drawing commands
- Line drawing with configurable thickness and color
- Environment-based configuration

## Requirements

### System Dependencies

**Debian/Ubuntu/Raspberry Pi OS:**
```bash
sudo apt update && sudo apt install \
    build-essential cmake pkg-config \
    libgbm-dev libdrm-dev \
    libegl1-mesa-dev libgles2-mesa-dev \
    libssl-dev
```

### Build Requirements

- CMake 3.16+
- C++17 compatible compiler (GCC 7+, Clang 5+)
- OpenSSL 1.1.0+

## Building

```bash
# Create build directory
mkdir -p build && cd build

# Configure
cmake ..

# Build
make -j$(nproc)

# Optional: Install
sudo make install
```

### Build Types

```bash
# Debug build (with symbols, no optimization)
cmake -DCMAKE_BUILD_TYPE=Debug ..

# Release build (optimized)
cmake -DCMAKE_BUILD_TYPE=Release ..
```

## Testing

### Build and Run Tests

```bash
cd build
cmake -DBUILD_TESTING=ON ..
make -j$(nproc)

# Run all tests
make test

# Or with
ctest --output-on-failure


# Or run test binary directly
./jarvis_tests
```

### Disable Tests

```bash
cmake -DBUILD_TESTING=OFF ..
```

## Configuration

Create a `.env` file in the project root or alongside the binary:

```bash
# Server endpoint (without trailing slash)
JARVIS_SERVER=http://yor-ip-here:3000/api/workstation/blueprint/load

# Device identifier (workstation ID)
JARVIS_DEVICE_ID=workstation-001

# Encryption secret (must match server)
JARVIS_SECRET=your-secret-key-here
```

## Running

```bash
# From build directory
./JARVIS

# Or with explicit .env path
cd .. && ./build/JARVIS
```

### Usage

1. Application auto-detects DRM device (`/dev/dri/card*`)
2. Waits for input:
   - **Press Enter**: Fetch and render frame from server
   - **Type "stop"**: Exit and restore display

### Stopping

If the display is frozen:

```bash
# Find process
ps aux | grep JARVIS

# Kill gracefully
kill <PID>

# Force kill if needed
kill -9 <PID>
```

## Project Structure

```
.
├── CMakeLists.txt          # Build configuration
├── include/                # Public headers
│   ├── crypto.hpp
│   ├── draw_ticker.hpp
│   ├── http_client.hpp
│   └── renderer.hpp
├── src/                    # Implementation
│   ├── crypto.cpp
│   ├── draw_ticker.cpp
│   ├── http_client.cpp
│   ├── renderer.cpp
│   └── main.cpp
└── tests/                  # Unit tests
    ├── test_crypto.cpp
    └── test_http_client.cpp
```

## API Response Format

The server should return JSON with this structure:

```json
{
  "id": "blueprint-id",
  "blueprintId": "blueprint-id",
  "clear": true,
  "lines": [
    {
      "x0": 100,
      "y0": 100,
      "x1": 600,
      "y1": 120,
      "color": "#FF0000",
      "thickness": 6
    }
  ]
}
```

## Troubleshooting

### Permission Denied on /dev/dri/card*

Add user to `video` and `render` groups:
```bash
sudo usermod -a -G video,render $USER
# Log out and back in
```

### No Connected Display Found

Check available DRM devices:
```bash
ls -la /dev/dri/
cat /sys/class/drm/*/status
```

### Build Errors

Ensure all dependencies are installed:
```bash
# Check OpenSSL
pkg-config --modversion openssl

# Check GBM and DRM
pkg-config --modversion gbm libdrm
```