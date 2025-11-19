#pragma once

#include "hand_detector.hpp"
#include "hand_detector_imx500.hpp"
#include "camera.hpp"
#include <memory>
#include <vector>

namespace hand_detector {

// Hybrid detector configuration
struct HybridDetectorConfig {
    // Backend selection
    bool prefer_neural_network{true};      // Try neural network first
    bool fallback_to_cv{true};             // Use CV if NN fails
    
    // Classical CV config (fallback)
    DetectorConfig cv_config;
    
    // Neural network config
    IMX500Config nn_config;
    
    // Fusion settings
    bool enable_sensor_fusion{true};       // Combine NN + CV results
    float nn_weight{0.8f};                 // Weight for NN results
    float cv_weight{0.2f};                 // Weight for CV results
    
    bool verbose{false};
};

// Enterprise-grade hybrid hand detector
// Uses IMX500 neural network when available, falls back to optimized CV
class HybridHandDetector {
public:
    HybridHandDetector();
    explicit HybridHandDetector(const HybridDetectorConfig& config);
    ~HybridHandDetector();
    
    // Initialize detector
    bool init(const HybridDetectorConfig& config);
    
    // Detect hands (automatically selects best backend)
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    // Get enhanced detections (if neural network is active)
    std::vector<EnhancedHandDetection> detect_enhanced(const camera::Frame& frame);
    
    // Configuration
    void set_config(const HybridDetectorConfig& config);
    const HybridDetectorConfig& get_config() const { return config_; }
    
    // Calibration
    bool calibrate_skin(const camera::Frame& frame, int x, int y, int w, int h);
    bool auto_calibrate(const camera::Frame& frame);
    
    // Statistics
    const DetectionStats& get_stats() const;
    void reset_stats();
    void reset_tracking();
    
    // Backend status
    bool is_using_neural_network() const { return using_nn_; }
    bool is_neural_network_available() const;
    std::string get_active_backend() const;
    
private:
    HybridDetectorConfig config_;
    
    // Backends
    std::unique_ptr<IMX500HandDetector> nn_detector_;
    std::unique_ptr<HandDetector> cv_detector_;
    
    // State
    bool using_nn_{false};
    bool nn_available_{false};
    DetectionStats combined_stats_;
    
    // Initialize backends
    bool init_neural_network();
    bool init_classical_cv();
    
    // Sensor fusion
    std::vector<HandDetection> fuse_detections(
        const std::vector<EnhancedHandDetection>& nn_dets,
        const std::vector<HandDetection>& cv_dets);
    
    // Disable copy
    HybridHandDetector(const HybridHandDetector&) = delete;
    HybridHandDetector& operator=(const HybridHandDetector&) = delete;
};

} // namespace hand_detector
