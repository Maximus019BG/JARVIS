#pragma once

#include "camera.hpp"
#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <memory>

namespace hand_detector {

// Forward declarations for MediaPipe types
namespace mediapipe {
    class CalculatorGraph;
    struct NormalizedLandmarkList;
}

// MediaPipe-based hand detector configuration
struct MediaPipeConfig {
    std::string model_path{"hand_landmark_full.tflite"};
    float min_detection_confidence{0.5f};
    float min_tracking_confidence{0.5f};
    int num_hands{2};
    bool static_image_mode{false};
    bool verbose{false};
    
    // Model complexity: 0 (lite), 1 (full)
    int model_complexity{1};
};

// Hand landmark indices (21 landmarks per hand)
enum class HandLandmark {
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

// Detected hand with MediaPipe landmarks
struct MediaPipeHandDetection : public HandDetection {
    // 21 hand landmarks in normalized coordinates [0, 1]
    std::vector<Point> landmarks;
    std::vector<float> landmarks_z; // Depth coordinates
    
    // Handedness (left/right)
    enum class Handedness { LEFT, RIGHT, UNKNOWN };
    Handedness handedness{Handedness::UNKNOWN};
    float handedness_confidence{0.0f};
};

// Production-ready MediaPipe hand detector
class MediaPipeHandDetector {
public:
    MediaPipeHandDetector();
    explicit MediaPipeHandDetector(const MediaPipeConfig& config);
    ~MediaPipeHandDetector();
    
    // Initialize detector with configuration
    bool init(const MediaPipeConfig& config);
    
    // Detect hands in a frame
    std::vector<MediaPipeHandDetection> detect(const camera::Frame& frame);
    
    // Update configuration
    void set_config(const MediaPipeConfig& config);
    
    // Get current configuration
    const MediaPipeConfig& get_config() const { return config_; }
    
    // Get statistics
    const DetectionStats& get_stats() const { return stats_; }
    
    // Reset statistics
    void reset_stats();
    
    // Check if MediaPipe is available (compiled with support)
    static bool is_available();
    
    // Get version information
    static std::string get_version();
    
private:
    MediaPipeConfig config_;
    DetectionStats stats_;
    
    // MediaPipe graph (implementation-specific)
    std::unique_ptr<void, void(*)(void*)> graph_;
    bool initialized_{false};
    
    // Helper functions
    Gesture classify_gesture_from_landmarks(const std::vector<Point>& landmarks,
                                           const std::vector<float>& landmarks_z);
    
    bool is_finger_extended(const std::vector<Point>& landmarks,
                           const std::vector<float>& landmarks_z,
                           int finger_idx);
    
    BoundingBox compute_bbox_from_landmarks(const std::vector<Point>& landmarks,
                                            uint32_t frame_width, uint32_t frame_height);
    
    // Disable copy
    MediaPipeHandDetector(const MediaPipeHandDetector&) = delete;
    MediaPipeHandDetector& operator=(const MediaPipeHandDetector&) = delete;
};

} // namespace hand_detector
