#pragma once

#include "camera.hpp"
#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <memory>

namespace hand_detector {

// TensorFlow Lite hand detector configuration
struct TFLiteConfig {
    std::string model_path{"hand_landmark_lite.tflite"};
    float confidence_threshold{0.5f};
    int num_threads{4}; // Number of threads for inference
    bool use_gpu{false}; // Use GPU delegate if available
    bool use_nnapi{true}; // Use NNAPI delegate on Android/Pi
    bool verbose{false};
};

// Production-ready TFLite hand detector
class TFLiteHandDetector {
public:
    TFLiteHandDetector();
    explicit TFLiteHandDetector(const TFLiteConfig& config);
    ~TFLiteHandDetector();
    
    // Initialize detector with configuration
    bool init(const TFLiteConfig& config);
    
    // Detect hands in a frame
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    // Update configuration
    void set_config(const TFLiteConfig& config);
    
    // Get current configuration
    const TFLiteConfig& get_config() const { return config_; }
    
    // Get statistics
    const DetectionStats& get_stats() const { return stats_; }
    
    // Reset statistics
    void reset_stats();
    
    // Check if TFLite is available (compiled with support)
    static bool is_available();
    
    // Get version information
    static std::string get_version();
    
private:
    TFLiteConfig config_;
    DetectionStats stats_;
    
    // TFLite interpreter (implementation-specific)
    std::unique_ptr<void, void(*)(void*)> interpreter_;
    bool initialized_{false};
    
    // Input/output tensors info
    struct TensorInfo {
        int index;
        std::vector<int> shape;
        int type;
    };
    TensorInfo input_tensor_;
    std::vector<TensorInfo> output_tensors_;
    
    // Preprocessing
    void preprocess_image(const camera::Frame& frame, float* input_data);
    
    // Postprocessing
    std::vector<HandDetection> postprocess_outputs();
    
    // Gesture classification from detection
    Gesture classify_gesture(const HandDetection& hand);
    
    // Disable copy
    TFLiteHandDetector(const TFLiteHandDetector&) = delete;
    TFLiteHandDetector& operator=(const TFLiteHandDetector&) = delete;
};

} // namespace hand_detector
