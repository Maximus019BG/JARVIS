#pragma once

#include "camera.hpp"
#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <memory>
#include <array>
#include <cstdint>

namespace hand_detector {

// IMX500 AI accelerator configuration
struct IMX500Config {
    // Model configuration
    std::string model_path{"models/hand_landmark_full.tflite"};
    float detection_confidence{0.70f};      // Higher threshold for enterprise
    float landmark_confidence{0.65f};
    float gesture_confidence{0.75f};
    
    // Performance tuning
    int num_threads{4};
    bool use_npu{true};                     // Use IMX500 NPU (Neural Processing Unit)
    bool use_xnnpack{true};                 // XNNPACK optimization
    int npu_cache_size_mb{32};
    
    // Preprocessing
    int input_width{224};                   // Model input size
    int input_height{224};
    bool normalize_input{true};
    float mean[3]{127.5f, 127.5f, 127.5f};
    float std[3]{127.5f, 127.5f, 127.5f};
    
    // Tracking and stabilization
    int temporal_smoothing_frames{5};       // Smooth landmarks over frames
    float position_smoothing_alpha{0.7f};   // Exponential smoothing
    float velocity_smoothing_alpha{0.5f};
    
    // Advanced features
    bool enable_multi_hand{true};           // Detect multiple hands
    int max_hands{2};
    bool enable_world_landmarks{true};      // 3D landmarks
    bool enable_tracking{true};             // Temporal tracking
    
    bool verbose{false};
};

// 21-point hand landmark point (MediaPipe compatible)
struct IMX500Landmark {
    float x, y, z;              // 3D coordinates (z for depth)
    float visibility;           // Confidence of landmark
    float presence;             // Presence score
};

// Enhanced hand detection with full landmarks
struct EnhancedHandDetection : public HandDetection {
    std::array<IMX500Landmark, 21> landmarks;  // 21 hand keypoints
    float handedness;                          // Left (0.0) or Right (1.0)
    bool is_right_hand;
    
    // 3D world coordinates (if enabled)
    std::array<IMX500Landmark, 21> world_landmarks;
    
    // Tracking information
    int track_id{-1};
    int frames_tracked{0};
    float tracking_confidence{0.0f};
    
    // Velocity for prediction
    float velocity_x{0.0f};
    float velocity_y{0.0f};
};

// Enterprise-grade IMX500 hand detector with neural network
class IMX500HandDetector {
public:
    IMX500HandDetector();
    explicit IMX500HandDetector(const IMX500Config& config);
    ~IMX500HandDetector();
    
    // Initialize detector with model
    bool init(const IMX500Config& config);
    
    // Detect hands in a frame (returns enhanced detections)
    std::vector<EnhancedHandDetection> detect(const camera::Frame& frame);
    
    // Simplified detect for compatibility
    std::vector<HandDetection> detect_simple(const camera::Frame& frame);
    
    // Update configuration
    void set_config(const IMX500Config& config);
    const IMX500Config& get_config() const { return config_; }
    
    // Get statistics
    const DetectionStats& get_stats() const { return stats_; }
    void reset_stats();
    
    // Check if IMX500 NPU is available
    static bool is_npu_available();
    static std::string get_hardware_info();
    
    // Model management
    bool load_model(const std::string& model_path);
    bool is_initialized() const { return initialized_; }
    
private:
    IMX500Config config_;
    DetectionStats stats_;
    bool initialized_{false};
    
    // TFLite interpreter (opaque pointer to avoid header dependencies)
    struct TFLiteState;
    std::unique_ptr<TFLiteState> tflite_state_;
    
    // Temporal tracking
    struct HandTrack {
        int id;
        EnhancedHandDetection last_detection;
        Point last_position;
        Point velocity;
        int frames_alive{0};
        int frames_lost{0};
        float confidence{0.0f};
    };
    std::vector<HandTrack> active_tracks_;
    int next_track_id_{0};
    
    // Processing pipeline
    void preprocess_frame(const camera::Frame& frame, float* input_buffer);
    std::vector<EnhancedHandDetection> postprocess_detections();
    
    // Landmark processing
    void extract_landmarks(EnhancedHandDetection& detection, const float* landmark_data);
    void smooth_landmarks(EnhancedHandDetection& detection, const HandTrack* track);
    
    // Gesture recognition from landmarks
    Gesture classify_gesture_from_landmarks(const EnhancedHandDetection& detection);
    int count_extended_fingers(const EnhancedHandDetection& detection);
    
    // Advanced gesture recognition
    bool is_finger_extended(const EnhancedHandDetection& det, int finger_idx);
    bool is_thumb_up(const EnhancedHandDetection& det);
    bool is_ok_sign(const EnhancedHandDetection& det);
    bool is_peace_sign(const EnhancedHandDetection& det);
    bool is_pointing(const EnhancedHandDetection& det);
    bool is_fist(const EnhancedHandDetection& det);
    
    // Tracking
    void update_tracking(std::vector<EnhancedHandDetection>& detections);
    HandTrack* find_matching_track(const EnhancedHandDetection& detection);
    void prune_lost_tracks();
    
    // Utility
    float calculate_iou(const BoundingBox& a, const BoundingBox& b);
    float calculate_landmark_distance(const EnhancedHandDetection& a, 
                                     const EnhancedHandDetection& b);
    
    // Disable copy
    IMX500HandDetector(const IMX500HandDetector&) = delete;
    IMX500HandDetector& operator=(const IMX500HandDetector&) = delete;
};

} // namespace hand_detector
