/**
 * @file hand_detector_tflite.hpp
 * @brief Enterprise-grade TensorFlow Lite hand pose detection
 * 
 * Production-ready hand detection using TFLite models with 21-point tracking.
 * Optimized for Raspberry Pi 5 with IMX500 camera and hardware acceleration.
 * 
 * @author JARVIS Team
 * @date 2024
 */

#pragma once

#include "camera.hpp"
#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <memory>
#include <chrono>

namespace hand_detector {
namespace tflite {

/**
 * @brief TensorFlow Lite hand detector configuration
 */
struct TFLiteConfig {
    // Model settings
    std::string model_path{"models/hand_landmark_lite.tflite"};
    float min_detection_confidence{0.7f};   // Minimum confidence for hand presence
    float min_tracking_confidence{0.5f};     // Minimum confidence for tracking
    
    // Hardware acceleration
    int num_threads{4};                      // Number of CPU threads
    bool use_xnnpack{true};                  // XNNPACK delegate (recommended for Pi 5)
    bool use_gpu_delegate{false};            // OpenGL ES GPU delegate
    bool use_nnapi{false};                   // Neural Networks API (Android/some Pi)
    
    // Input normalization (model-specific)
    float input_normalization_scale{2.0f};   // Scale factor (e.g., 2.0 for [-1,1])
    float input_normalization_offset{-1.0f}; // Offset (e.g., -1.0 for [-1,1])
    
    // Performance
    bool enable_temporal_smoothing{true};    // Smooth landmarks over time
    int smoothing_window_size{7};            // Frames to average
    
    // Logging
    bool verbose{false};
    bool log_performance{true};
};

/**
 * @brief Enhanced hand detection with landmark tracking
 */
struct HandDetection : public hand_detector::HandDetection {
    std::vector<Point> landmarks;      // 21 hand landmarks (MediaPipe format)
    Point smoothed_fingertip;          // Temporally smoothed index fingertip
    float landmark_confidence{0.0f};   // Per-landmark average confidence
    bool is_left_hand{false};          // Handedness classification
};

// Forward declaration
struct TFLiteHandDetectorImpl;

/**
 * @brief Production-ready TensorFlow Lite hand detector
 * 
 * Features:
 * - 21-point hand landmark detection (MediaPipe-compatible)
 * - Hardware acceleration (XNNPACK, GPU, NNAPI)
 * - Temporal smoothing for jitter reduction
 * - Gesture classification (pointing, open palm, fist, etc.)
 * - Enterprise-level error handling and logging
 */
class TFLiteHandDetector {
public:
    TFLiteHandDetector();
    explicit TFLiteHandDetector(const TFLiteConfig& config);
    ~TFLiteHandDetector();
    
    /**
     * @brief Initialize detector with configuration
     * @param config Configuration settings
     * @return true if successful, false otherwise
     */
    bool init(const TFLiteConfig& config);
    
    /**
     * @brief Detect hands in a frame
     * @param frame Input camera frame (RGB888)
     * @return Vector of detected hands (may be empty)
     */
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    /**
     * @brief Get detection statistics
     * @return Current statistics
     */
    DetectionStats get_stats() const;
    
    /**
     * @brief Reset statistics
     */
    void reset_stats();
    
    /**
     * @brief Check if TFLite support is compiled in
     * @return true if TFLite is available
     */
    static bool is_available() {
#ifdef HAVE_TFLITE
        return true;
#else
        return false;
#endif
    }
    
private:
    std::unique_ptr<TFLiteHandDetectorImpl> impl_;
    
    // Preprocessing
    void prepare_input_float(const camera::Frame& frame, float* input_buffer,
                            int input_width, int input_height);
    void prepare_input_uint8(const camera::Frame& frame, uint8_t* input_buffer,
                            int input_width, int input_height);
    
    // Postprocessing
    Gesture classify_gesture(const HandDetection& detection) const;
    bool is_finger_extended(const HandDetection& detection, int tip_idx) const;
    int count_extended_fingers(const HandDetection& detection) const;
    BoundingBox compute_bbox_from_landmarks(const std::vector<Point>& landmarks) const;
    
    // Disable copy
    TFLiteHandDetector(const TFLiteHandDetector&) = delete;
    TFLiteHandDetector& operator=(const TFLiteHandDetector&) = delete;
};

} // namespace tflite
} // namespace hand_detector
