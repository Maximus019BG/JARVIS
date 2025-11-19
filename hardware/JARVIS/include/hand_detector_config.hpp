#pragma once

#include <cstdint>
#include <string>

namespace hand_detector {

// Named constants for better readability
namespace constants {
    constexpr int kMorphKernelSize = 3;
    constexpr int kMinContourPoints = 10;
    constexpr int kMaxFingers = 5;
    constexpr float kDefectDepthThreshold = 10.0f;
    constexpr float kFingertipDistanceFactor = 0.85f;
    constexpr float kDefectProximityFactor = 0.6f;
    constexpr float kRecip255 = 1.0f / 255.0f;
} // namespace constants

// Configuration for hand detection
struct DetectorConfig {
    // Skin detection parameters (HSV color space)
    // Improved defaults for better hand detection across lighting conditions
    int hue_min{0};        // Minimum hue (0-179)
    int hue_max{20};       // Maximum hue (0-179) - narrower range to reduce false positives
    int sat_min{25};       // Minimum saturation (0-255) - raised to avoid pale backgrounds
    int sat_max{200};      // Maximum saturation (0-255) - lowered to avoid orange objects
    int val_min{40};       // Minimum value (0-255) - raised to avoid shadows
    int val_max{255};      // Maximum value (0-255)
    
    // Detection parameters
    int min_hand_area{3500};    // Minimum contour area for hand (raised to reduce noise)
    int max_hand_area{120000};  // Maximum contour area for hand (lowered to avoid large false positives)
    float min_confidence{0.50f}; // Minimum detection confidence (raised from 0.32 for better precision)
    
    // Processing parameters
    bool enable_morphology{true}; // Apply morphological operations
    int morph_iterations{2};      // Number of morphology passes
    
    // Gesture recognition
    bool enable_gesture{true};  // Enable gesture recognition
    int gesture_history{7};     // Number of frames for gesture stabilization
    
    // Performance
    int downscale_factor{1};    // Downscale factor for processing (1=no downscale)
    bool verbose{false};        // Enable verbose logging
    bool enable_simd{true};     // Enable SIMD optimizations
    bool enable_threading{true}; // Enable multi-threading
    
    // Adaptive thresholding
    bool adaptive_hsv{false};   // Dynamically adjust HSV based on histogram
    float hsv_smoothing{0.1f};  // Exponential smoothing factor for adaptive HSV
    
    // Temporal stability
    bool enable_tracking{true}; // Track hands frame-to-frame (ENABLED by default)
    float tracking_iou_threshold{0.3f}; // IOU threshold for tracking
    int temporal_filter_frames{3};  // Number of frames to confirm detection
    float detection_persistence{0.7f}; // Persistence threshold for stable detection
    
    // Load from JSON/file
    [[nodiscard]] bool load_from_file(const std::string& path);
    void save_to_file(const std::string& path) const;
    
    // Validation
    [[nodiscard]] bool validate() const noexcept;
};

// Detection statistics
struct DetectionStats {
    uint64_t frames_processed{0};
    uint64_t hands_detected{0};
    double avg_process_time_ms{0.0};
    uint64_t last_detection_timestamp{0};
    
    // Per-stage timing
    double conversion_ms{0.0};
    double masking_ms{0.0};
    double morphology_ms{0.0};
    double contours_ms{0.0};
    double analysis_ms{0.0};
    
    void reset() noexcept {
        frames_processed = 0;
        hands_detected = 0;
        avg_process_time_ms = 0.0;
        last_detection_timestamp = 0;
        conversion_ms = 0.0;
        masking_ms = 0.0;
        morphology_ms = 0.0;
        contours_ms = 0.0;
        analysis_ms = 0.0;
    }
};

} // namespace hand_detector
