#include "hand_detector_hybrid.hpp"
#include "hand_detector_production.hpp"
#include <iostream>
#include <algorithm>

namespace hand_detector {

HybridHandDetector::HybridHandDetector() {
}

HybridHandDetector::HybridHandDetector(const HybridDetectorConfig& config)
    : config_(config) {
    init(config);
}

HybridHandDetector::~HybridHandDetector() {
}

bool HybridHandDetector::init(const HybridDetectorConfig& config) {
    config_ = config;
    
    if (config_.verbose) {
        std::cerr << "\n╔════════════════════════════════════════════════════════════╗\n";
        std::cerr << "║     JARVIS ENTERPRISE HAND DETECTION SYSTEM v2.0           ║\n";
        std::cerr << "╚════════════════════════════════════════════════════════════╝\n\n";
    }
    
    // Try to initialize neural network first
    bool nn_success = false;
    if (config_.prefer_neural_network) {
        nn_success = init_neural_network();
    }
    
    // Initialize classical CV (always, as fallback or primary)
    bool cv_success = init_classical_cv();
    
    if (!nn_success && !cv_success) {
        std::cerr << "[Hybrid] ERROR: Failed to initialize any detection backend\n";
        return false;
    }
    
    if (config_.verbose) {
        std::cerr << "\n[Hybrid] ✓ Detector initialized successfully\n";
        std::cerr << "[Hybrid] Active backend: " << get_active_backend() << "\n";
        std::cerr << "[Hybrid] Sensor fusion: " << (config_.enable_sensor_fusion ? "ON" : "OFF") << "\n\n";
    }
    
    return true;
}

bool HybridHandDetector::init_neural_network() {
    try {
        nn_detector_ = std::make_unique<IMX500HandDetector>();
        
        if (config_.verbose) {
            std::cerr << "[Hybrid] Initializing neural network backend...\n";
        }
        
        bool success = nn_detector_->init(config_.nn_config);
        
        if (success) {
            nn_available_ = true;
            using_nn_ = true;
            
            if (config_.verbose) {
                std::cerr << "[Hybrid] ✓ Neural network backend active\n";
                std::cerr << IMX500HandDetector::get_hardware_info();
            }
            return true;
        } else {
            if (config_.verbose) {
                std::cerr << "[Hybrid] Neural network initialization failed\n";
            }
            nn_detector_.reset();
            return false;
        }
    } catch (const std::exception& e) {
        std::cerr << "[Hybrid] Neural network exception: " << e.what() << "\n";
        nn_detector_.reset();
        return false;
    }
}

bool HybridHandDetector::init_classical_cv() {
    try {
        if (config_.verbose) {
            std::cerr << "[Hybrid] Initializing classical computer vision backend...\n";
        }
        
        // Use production detector for best CV performance
        auto prod_config = ProductionConfig();
        prod_config.enable_tracking = true;
        prod_config.adaptive_lighting = true;
        prod_config.gesture_stabilization_frames = 7;
        prod_config.tracking_history_frames = 10;
        prod_config.filter_low_confidence = true;
        prod_config.min_detection_quality = 0.60f;
        prod_config.verbose = config_.verbose;
        
        auto detector = std::make_unique<ProductionHandDetector>(
            config_.cv_config, prod_config);
        
        cv_detector_ = std::make_unique<HandDetector>(config_.cv_config);
        
        if (config_.verbose) {
            std::cerr << "[Hybrid] ✓ Classical CV backend ready\n";
            std::cerr << "[Hybrid]   Adaptive lighting: ON\n";
            std::cerr << "[Hybrid]   Temporal tracking: ON\n";
            std::cerr << "[Hybrid]   Gesture stabilization: 7 frames\n";
        }
        
        return true;
    } catch (const std::exception& e) {
        std::cerr << "[Hybrid] CV backend exception: " << e.what() << "\n";
        return false;
    }
}

std::vector<HandDetection> HybridHandDetector::detect(const camera::Frame& frame) {
    std::vector<HandDetection> result;
    
    // Try neural network first if available and preferred
    if (using_nn_ && nn_detector_) {
        try {
            auto nn_dets = nn_detector_->detect(frame);
            
            // Convert enhanced detections to simple detections
            result.reserve(nn_dets.size());
            for (const auto& det : nn_dets) {
                result.push_back(static_cast<HandDetection>(det));
            }
            
            // Update stats
            combined_stats_ = nn_detector_->get_stats();
            
            // If NN returns good results, use them
            if (!result.empty()) {
                return result;
            }
            
            // NN returned nothing, fall back if enabled
            if (!config_.fallback_to_cv) {
                return result;
            }
            
        } catch (const std::exception& e) {
            std::cerr << "[Hybrid] Neural network error: " << e.what() << "\n";
            if (!config_.fallback_to_cv) {
                return result;
            }
        }
    }
    
    // Use classical CV
    if (cv_detector_) {
        result = cv_detector_->detect(frame);
        combined_stats_ = cv_detector_->get_stats();
    }
    
    return result;
}

std::vector<EnhancedHandDetection> HybridHandDetector::detect_enhanced(
    const camera::Frame& frame) {
    
    if (using_nn_ && nn_detector_) {
        return nn_detector_->detect(frame);
    }
    
    // Convert simple detections to enhanced
    auto simple = detect(frame);
    std::vector<EnhancedHandDetection> enhanced;
    enhanced.reserve(simple.size());
    
    for (const auto& det : simple) {
        EnhancedHandDetection enh;
        static_cast<HandDetection&>(enh) = det;
        enhanced.push_back(enh);
    }
    
    return enhanced;
}

bool HybridHandDetector::calibrate_skin(const camera::Frame& frame, 
                                        int x, int y, int w, int h) {
    if (cv_detector_) {
        return cv_detector_->calibrate_skin(frame, x, y, w, h);
    }
    return false;
}

bool HybridHandDetector::auto_calibrate(const camera::Frame& frame) {
    // Try to detect a hand and calibrate from it
    auto detections = detect(frame);
    
    if (detections.empty()) {
        return false;
    }
    
    // Use first detection for calibration
    const auto& hand = detections[0];
    
    if (cv_detector_) {
        return cv_detector_->calibrate_skin(frame, 
            hand.bbox.x, hand.bbox.y, 
            hand.bbox.width, hand.bbox.height);
    }
    
    return false;
}

const DetectionStats& HybridHandDetector::get_stats() const {
    return combined_stats_;
}

void HybridHandDetector::reset_stats() {
    if (nn_detector_) nn_detector_->reset_stats();
    if (cv_detector_) cv_detector_->reset_stats();
    combined_stats_ = DetectionStats();
}

void HybridHandDetector::reset_tracking() {
    // Only CV detector has tracking reset
    // NN detector tracking is internal
}

bool HybridHandDetector::is_neural_network_available() const {
    return nn_available_;
}

std::string HybridHandDetector::get_active_backend() const {
    if (using_nn_) {
        return "Neural Network (IMX500 NPU)";
    } else if (cv_detector_) {
        return "Classical Computer Vision (Optimized)";
    } else {
        return "None";
    }
}

void HybridHandDetector::set_config(const HybridDetectorConfig& config) {
    config_ = config;
    
    if (nn_detector_) {
        nn_detector_->set_config(config_.nn_config);
    }
    
    if (cv_detector_) {
        cv_detector_->set_config(config_.cv_config);
    }
}

std::vector<HandDetection> HybridHandDetector::fuse_detections(
    const std::vector<EnhancedHandDetection>& nn_dets,
    const std::vector<HandDetection>& cv_dets) {
    
    // Simple fusion: prefer NN detections, add non-overlapping CV detections
    std::vector<HandDetection> fused;
    
    // Add all NN detections
    for (const auto& nn_det : nn_dets) {
        fused.push_back(static_cast<HandDetection>(nn_det));
    }
    
    // Add CV detections that don't overlap with NN detections
    for (const auto& cv_det : cv_dets) {
        bool overlaps = false;
        
        for (const auto& fused_det : fused) {
            // Simple overlap check
            int x1 = std::max(cv_det.bbox.x, fused_det.bbox.x);
            int y1 = std::max(cv_det.bbox.y, fused_det.bbox.y);
            int x2 = std::min(cv_det.bbox.x + cv_det.bbox.width, 
                            fused_det.bbox.x + fused_det.bbox.width);
            int y2 = std::min(cv_det.bbox.y + cv_det.bbox.height, 
                            fused_det.bbox.y + fused_det.bbox.height);
            
            if (x2 > x1 && y2 > y1) {
                overlaps = true;
                break;
            }
        }
        
        if (!overlaps) {
            fused.push_back(cv_det);
        }
    }
    
    return fused;
}

} // namespace hand_detector
