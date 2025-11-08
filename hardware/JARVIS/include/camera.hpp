#pragma once

#include <cstdint>
#include <string>
#include <memory>
#include <vector>
#include <functional>

namespace camera {

// Frame format for image processing
enum class PixelFormat {
    RGB888,   // 24-bit RGB
    RGBA8888, // 32-bit RGBA
    YUV420,   // YUV 4:2:0
    UNKNOWN
};

// Represents a single camera frame
struct Frame {
    uint8_t* data;           // Raw pixel data
    size_t size;             // Data size in bytes
    uint32_t width;          // Frame width
    uint32_t height;         // Frame height
    PixelFormat format;      // Pixel format
    uint64_t timestamp_ns;   // Capture timestamp (nanoseconds)
    int stride;              // Bytes per row
    
    // Constructor
    Frame() : data(nullptr), size(0), width(0), height(0), 
              format(PixelFormat::UNKNOWN), timestamp_ns(0), stride(0) {}
    
    // Get pixel at (x, y) for RGB888
    bool get_rgb(uint32_t x, uint32_t y, uint8_t& r, uint8_t& g, uint8_t& b) const;
    
    // Convert YUV to RGB at (x, y)
    bool get_rgb_from_yuv(uint32_t x, uint32_t y, uint8_t& r, uint8_t& g, uint8_t& b) const;
};

// Camera configuration
struct CameraConfig {
    uint32_t width;          // Desired width (default: 640)
    uint32_t height;         // Desired height (default: 480)
    uint32_t framerate;      // Desired FPS (default: 30)
    PixelFormat format;      // Desired format (default: RGB888)
    bool verbose;            // Enable verbose logging
    
    CameraConfig() : width(640), height(480), framerate(30), 
                     format(PixelFormat::RGB888), verbose(false) {}
};

// Camera interface for Raspberry Pi cameras via libcamera
class Camera {
public:
    Camera();
    ~Camera();
    
    // Initialize camera with configuration
    // Returns true on success
    bool init(const CameraConfig& config);
    
    // Start camera capture
    bool start();
    
    // Stop camera capture
    void stop();
    
    // Capture a single frame (blocking)
    // Returns pointer to frame data (valid until next capture)
    // Returns nullptr on error
    Frame* capture_frame();
    
    // Get current configuration
    const CameraConfig& get_config() const { return config_; }
    
    // Check if camera is running
    bool is_running() const { return running_; }
    
    // Get last error message
    const std::string& get_error() const { return last_error_; }
    
    // List available cameras (returns count)
    static int list_cameras();
    
private:
    class Impl;
    std::unique_ptr<Impl> impl_;
    
    CameraConfig config_;
    bool running_;
    std::string last_error_;
    Frame current_frame_;
    
    // Internal frame buffer
    std::vector<uint8_t> frame_buffer_;
    
    // Disable copy
    Camera(const Camera&) = delete;
    Camera& operator=(const Camera&) = delete;
};

// Utility functions for image processing
namespace utils {
    // Convert YUV420 to RGB888
    void yuv420_to_rgb888(const uint8_t* yuv, uint8_t* rgb, 
                          uint32_t width, uint32_t height);
    
    // Resize image (simple nearest-neighbor)
    void resize_nearest(const uint8_t* src, uint8_t* dst,
                       uint32_t src_w, uint32_t src_h,
                       uint32_t dst_w, uint32_t dst_h,
                       int channels);
    
    // Convert RGB to grayscale
    void rgb_to_gray(const uint8_t* rgb, uint8_t* gray,
                    uint32_t width, uint32_t height);
    
    // Apply Gaussian blur (3x3 kernel)
    void gaussian_blur_3x3(const uint8_t* src, uint8_t* dst,
                          uint32_t width, uint32_t height,
                          int channels);
}

} // namespace camera
