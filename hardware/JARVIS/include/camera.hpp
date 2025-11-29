#pragma once

#include <cstdint>
#include <string>
#include <memory>
#include <vector>
#include <functional>

namespace camera
{

    // Frame format for image processing
    enum class PixelFormat
    {
        RGB888,   // 24-bit RGB
        RGBA8888, // 32-bit RGBA
        YUV420,   // YUV 4:2:0
        UNKNOWN
    };

    // IMX500 keypoint from PoseNet
    struct IMX500Keypoint
    {
        float x, y;       // Normalized coordinates [0, 1]
        float confidence; // Detection confidence

        IMX500Keypoint() : x(0), y(0), confidence(0) {}
        IMX500Keypoint(float x_, float y_, float conf) : x(x_), y(y_), confidence(conf) {}
    };

    // IMX500 PoseNet detection (17 keypoints)
    struct IMX500PoseDetection
    {
        IMX500Keypoint keypoints[17]; // PoseNet 17 keypoints
        float overall_confidence;

        // Keypoint indices (PoseNet standard)
        enum KeypointIndex
        {
            NOSE = 0,
            LEFT_EYE = 1,
            RIGHT_EYE = 2,
            LEFT_EAR = 3,
            RIGHT_EAR = 4,
            LEFT_SHOULDER = 5,
            RIGHT_SHOULDER = 6,
            LEFT_ELBOW = 7,
            RIGHT_ELBOW = 8,
            LEFT_WRIST = 9,
            RIGHT_WRIST = 10,
            LEFT_HIP = 11,
            RIGHT_HIP = 12,
            LEFT_KNEE = 13,
            RIGHT_KNEE = 14,
            LEFT_ANKLE = 15,
            RIGHT_ANKLE = 16
        };

        IMX500PoseDetection() : overall_confidence(0) {}
    };

    // IMX500 Hand Landmark detection (21 keypoints)
    struct IMX500HandLandmark
    {
        IMX500Keypoint landmarks[21]; // MediaPipe hand landmarks
        float handedness;             // 0.0 = left hand, 1.0 = right hand
        float overall_confidence;

        // Landmark indices (MediaPipe standard)
        enum LandmarkIndex
        {
            WRIST = 0,
            THUMB_CMC = 1,
            THUMB_MCP = 2,
            THUMB_IP = 3,
            THUMB_TIP = 4,
            INDEX_FINGER_MCP = 5,
            INDEX_FINGER_PIP = 6,
            INDEX_FINGER_DIP = 7,
            INDEX_FINGER_TIP = 8,
            MIDDLE_FINGER_MCP = 9,
            MIDDLE_FINGER_PIP = 10,
            MIDDLE_FINGER_DIP = 11,
            MIDDLE_FINGER_TIP = 12,
            RING_FINGER_MCP = 13,
            RING_FINGER_PIP = 14,
            RING_FINGER_DIP = 15,
            RING_FINGER_TIP = 16,
            PINKY_MCP = 17,
            PINKY_PIP = 18,
            PINKY_DIP = 19,
            PINKY_TIP = 20
        };

        IMX500HandLandmark() : handedness(0), overall_confidence(0) {}
    };

    // Represents a single camera frame
    struct Frame
    {
        std::vector<uint8_t> data; // Raw pixel data
        size_t size;           // Data size in bytes (optional, can be data.size())
        uint32_t width;        // Frame width
        uint32_t height;       // Frame height
        PixelFormat format;    // Pixel format
        uint64_t timestamp_ns; // Capture timestamp (nanoseconds)
        int stride;            // Bytes per row

        // IMX500 metadata (if available)
        std::vector<IMX500PoseDetection> imx500_detections;
        std::vector<IMX500HandLandmark> imx500_hand_landmarks;
        bool has_imx500_metadata;

        // Constructor
        Frame() : data(), size(0), width(0), height(0),
              format(PixelFormat::UNKNOWN), timestamp_ns(0), stride(0),
              has_imx500_metadata(false) {}

        // Get pixel at (x, y) for RGB888
        bool get_rgb(uint32_t x, uint32_t y, uint8_t &r, uint8_t &g, uint8_t &b) const;

        // Convert YUV to RGB at (x, y)
        bool get_rgb_from_yuv(uint32_t x, uint32_t y, uint8_t &r, uint8_t &g, uint8_t &b) const;
    };

    // Camera configuration
    struct CameraConfig
    {
        uint32_t width;     // Desired width (default: 640)
        uint32_t height;    // Desired height (default: 480)
        uint32_t framerate; // Desired FPS (default: 30)
        PixelFormat format; // Desired format (default: RGB888)
        bool verbose;       // Enable verbose logging

        CameraConfig() : width(640), height(480), framerate(30),
                         format(PixelFormat::RGB888), verbose(false) {}
    };

    // Camera interface for Raspberry Pi cameras via libcamera
    class Camera
    {
    public:
        Camera();
        ~Camera();

        // Initialize camera with configuration
        // Returns true on success
        bool init(const CameraConfig &config);

        // Start camera capture
        bool start();

        // Stop camera capture
        void stop();

        // Capture a single frame (blocking)
        // Returns pointer to frame data (valid until next capture)
        // Returns nullptr on error
        Frame *capture_frame();

        // Get current configuration
        const CameraConfig &get_config() const { return config_; }

        // Check if camera is running
        bool is_running() const { return running_; }

        // Get last error message
        const std::string &get_error() const { return last_error_; }

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
        Camera(const Camera &) = delete;
        Camera &operator=(const Camera &) = delete;
    };

    // Utility functions for image processing
    namespace utils
    {
        // Convert YUV420 to RGB888
        void yuv420_to_rgb888(const uint8_t *yuv, uint8_t *rgb,
                              uint32_t width, uint32_t height);

        // Resize image (simple nearest-neighbor)
        void resize_nearest(const uint8_t *src, uint8_t *dst,
                            uint32_t src_w, uint32_t src_h,
                            uint32_t dst_w, uint32_t dst_h,
                            int channels);

        // Convert RGB to grayscale
        void rgb_to_gray(const uint8_t *rgb, uint8_t *gray,
                         uint32_t width, uint32_t height);

        // Apply Gaussian blur (3x3 kernel)
        void gaussian_blur_3x3(const uint8_t *src, uint8_t *dst,
                               uint32_t width, uint32_t height,
                               int channels);
    }

} // namespace camera
