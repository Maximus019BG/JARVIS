#pragma once

#include "hand_detector.hpp"
#include "camera.hpp"
#include <vector>
#include <deque>
#include <chrono>

namespace hand_detector {

// Production-ready enhancements for classical CV detector
struct ProductionConfig {
    // Multi-frame tracking for stability
    bool enable_tracking{true};
    int tracking_history_frames{5};
    float tracking_iou_threshold{0.25f}; // Lowered for better tracking across frames
    
    // Adaptive lighting compensation
    bool adaptive_lighting{true};
    float lighting_adaptation_rate{0.1f};
    
    // Gesture stabilization
    int gesture_stabilization_frames{7}; // Reduced for faster gesture response
    float gesture_confidence_threshold{0.6f}; // Lowered to accept more gestures
    
    // Performance optimization
    bool enable_roi_tracking{false}; // Disabled to scan full frame for all hands
    int roi_expansion_pixels{80}; // Increased when ROI tracking is enabled
    
    // Quality filtering
    bool filter_low_confidence{true};
    float min_detection_quality{0.40f}; // Lowered to catch more valid detections
    
    bool verbose{false};
};

// Tracked hand with temporal information
struct TrackedHand {
    HandDetection detection;
    int track_id;
    int frames_tracked;
    int frames_since_last_seen;
    std::deque<Gesture> gesture_history;
    std::deque<Point> center_history;
    float tracking_confidence;
    
    TrackedHand() : track_id(-1), frames_tracked(0), 
                    frames_since_last_seen(0), tracking_confidence(0.0f) {}
};

// Production-ready hand detector with enhanced classical CV
class ProductionHandDetector {
public:
    ProductionHandDetector();
    explicit ProductionHandDetector(const DetectorConfig& detector_config,
                                   const ProductionConfig& production_config);
    ~ProductionHandDetector();
    
    // Initialize detector
    bool init(const DetectorConfig& detector_config,
             const ProductionConfig& production_config);
    
    // Detect hands with tracking and stabilization
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    // Update configurations
    void set_detector_config(const DetectorConfig& config);
    void set_production_config(const ProductionConfig& config);
    
    // Get configurations
    const DetectorConfig& get_detector_config() const { return detector_config_; }
    const ProductionConfig& get_production_config() const { return production_config_; }
    
    // Get statistics
    const DetectionStats& get_stats() const { return stats_; }
    
    // Reset state
    void reset_stats();
    void reset_tracking();
    
    // Calibration
    bool calibrate_skin(const camera::Frame& frame, 
                       int roi_x, int roi_y, 
                       int roi_w, int roi_h);
    
    // Auto-calibration from detected hand
    bool auto_calibrate(const camera::Frame& frame);
    
private:
    DetectorConfig detector_config_;
    ProductionConfig production_config_;
    DetectionStats stats_;
    
    // Core detector
    std::unique_ptr<HandDetector> detector_;
    
    // Tracking state
    std::vector<TrackedHand> tracked_hands_;
    int next_track_id_{0};
    
    // Adaptive state
    struct AdaptiveState {
        int hue_min, hue_max;
        int sat_min, sat_max;
        int val_min, val_max;
        float brightness_avg;
        int frames_processed;
    };
    AdaptiveState adaptive_state_;
    
    // ROI for optimization
    struct ROI {
        int x, y, width, height;
        bool valid;
    };
    ROI last_detection_roi_;
    
    // Helper functions
    void update_tracking(const std::vector<HandDetection>& detections);
    void update_adaptive_params(const camera::Frame& frame);
    Gesture stabilize_gesture(const TrackedHand& track);
    float compute_iou(const BoundingBox& a, const BoundingBox& b);
    bool match_detection_to_track(const HandDetection& det, const TrackedHand& track);
    void prune_lost_tracks();
    ROI compute_search_roi(const camera::Frame& frame);
    
    // Disable copy
    ProductionHandDetector(const ProductionHandDetector&) = delete;
    ProductionHandDetector& operator=(const ProductionHandDetector&) = delete;
};

} // namespace hand_detector
