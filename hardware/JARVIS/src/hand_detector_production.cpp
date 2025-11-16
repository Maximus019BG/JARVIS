#include "hand_detector_production.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>

namespace hand_detector {

ProductionHandDetector::ProductionHandDetector() 
    : detector_(std::make_unique<HandDetector>()) {
    reset_stats();
    reset_tracking();
    last_detection_roi_.valid = false;
    
    // Initialize adaptive state with defaults
    adaptive_state_.hue_min = 0;
    adaptive_state_.hue_max = 30;
    adaptive_state_.sat_min = 15;
    adaptive_state_.sat_max = 220;
    adaptive_state_.val_min = 30;
    adaptive_state_.val_max = 255;
    adaptive_state_.brightness_avg = 128.0f;
    adaptive_state_.frames_processed = 0;
}

ProductionHandDetector::ProductionHandDetector(const DetectorConfig& detector_config,
                                             const ProductionConfig& production_config)
    : detector_config_(detector_config),
      production_config_(production_config),
      detector_(std::make_unique<HandDetector>(detector_config)) {
    reset_stats();
    reset_tracking();
    last_detection_roi_.valid = false;
    
    // Initialize adaptive state from config
    adaptive_state_.hue_min = detector_config.hue_min;
    adaptive_state_.hue_max = detector_config.hue_max;
    adaptive_state_.sat_min = detector_config.sat_min;
    adaptive_state_.sat_max = detector_config.sat_max;
    adaptive_state_.val_min = detector_config.val_min;
    adaptive_state_.val_max = detector_config.val_max;
    adaptive_state_.brightness_avg = 128.0f;
    adaptive_state_.frames_processed = 0;
}

ProductionHandDetector::~ProductionHandDetector() {}

bool ProductionHandDetector::init(const DetectorConfig& detector_config,
                                 const ProductionConfig& production_config) {
    detector_config_ = detector_config;
    production_config_ = production_config;
    
    detector_ = std::make_unique<HandDetector>(detector_config);
    if (!detector_->init(detector_config)) {
        return false;
    }
    
    reset_stats();
    reset_tracking();
    
    if (production_config_.verbose) {
        std::cerr << "[ProductionDetector] Initialized\n";
        std::cerr << "  Tracking: " << (production_config_.enable_tracking ? "enabled" : "disabled") << "\n";
        std::cerr << "  Adaptive lighting: " << (production_config_.adaptive_lighting ? "enabled" : "disabled") << "\n";
        std::cerr << "  ROI optimization: " << (production_config_.enable_roi_tracking ? "enabled" : "disabled") << "\n";
    }
    
    return true;
}

std::vector<HandDetection> ProductionHandDetector::detect(const camera::Frame& frame) {
    // Adaptive lighting adjustment
    if (production_config_.adaptive_lighting && 
        adaptive_state_.frames_processed % 30 == 0) {
        update_adaptive_params(frame);
    }
    
    // Detect hands using base detector
    std::vector<HandDetection> detections = detector_->detect(frame);
    
    // Update tracking if enabled
    if (production_config_.enable_tracking) {
        update_tracking(detections);
        
        // Apply stabilized gestures from tracking
        for (auto& det : detections) {
            // Find corresponding track
            for (const auto& track : tracked_hands_) {
                if (match_detection_to_track(det, track)) {
                    Gesture stabilized = stabilize_gesture(track);
                    if (stabilized != Gesture::UNKNOWN) {
                        det.gesture = stabilized;
                        det.gesture_confidence = track.tracking_confidence;
                    }
                    break;
                }
            }
        }
        
        prune_lost_tracks();
    }
    
    // Filter low confidence detections
    if (production_config_.filter_low_confidence) {
        detections.erase(
            std::remove_if(detections.begin(), detections.end(),
                [this](const HandDetection& d) {
                    return d.bbox.confidence < production_config_.min_detection_quality;
                }),
            detections.end()
        );
    }
    
    // Update ROI for next frame
    if (production_config_.enable_roi_tracking && !detections.empty()) {
        // Compute bounding box of all detections
        int min_x = detections[0].bbox.x;
        int min_y = detections[0].bbox.y;
        int max_x = detections[0].bbox.x + detections[0].bbox.width;
        int max_y = detections[0].bbox.y + detections[0].bbox.height;
        
        for (size_t i = 1; i < detections.size(); ++i) {
            min_x = std::min(min_x, detections[i].bbox.x);
            min_y = std::min(min_y, detections[i].bbox.y);
            max_x = std::max(max_x, detections[i].bbox.x + detections[i].bbox.width);
            max_y = std::max(max_y, detections[i].bbox.y + detections[i].bbox.height);
        }
        
        // Expand ROI
        const int exp = production_config_.roi_expansion_pixels;
        last_detection_roi_.x = std::max(0, min_x - exp);
        last_detection_roi_.y = std::max(0, min_y - exp);
        last_detection_roi_.width = std::min(static_cast<int>(frame.width) - last_detection_roi_.x,
                                            max_x - min_x + 2 * exp);
        last_detection_roi_.height = std::min(static_cast<int>(frame.height) - last_detection_roi_.y,
                                             max_y - min_y + 2 * exp);
        last_detection_roi_.valid = true;
    } else if (detections.empty()) {
        last_detection_roi_.valid = false;
    }
    
    // Update statistics from base detector
    stats_ = detector_->get_stats();
    adaptive_state_.frames_processed++;
    
    return detections;
}

void ProductionHandDetector::set_detector_config(const DetectorConfig& config) {
    detector_config_ = config;
    detector_->set_config(config);
    
    // Update adaptive state
    adaptive_state_.hue_min = config.hue_min;
    adaptive_state_.hue_max = config.hue_max;
    adaptive_state_.sat_min = config.sat_min;
    adaptive_state_.sat_max = config.sat_max;
    adaptive_state_.val_min = config.val_min;
    adaptive_state_.val_max = config.val_max;
}

void ProductionHandDetector::set_production_config(const ProductionConfig& config) {
    production_config_ = config;
}

void ProductionHandDetector::reset_stats() {
    stats_.reset();
    if (detector_) {
        detector_->reset_stats();
    }
}

void ProductionHandDetector::reset_tracking() {
    tracked_hands_.clear();
    next_track_id_ = 0;
}

bool ProductionHandDetector::calibrate_skin(const camera::Frame& frame, 
                                           int roi_x, int roi_y, 
                                           int roi_w, int roi_h) {
    bool result = detector_->calibrate_skin(frame, roi_x, roi_y, roi_w, roi_h);
    if (result) {
        // Update adaptive state with new calibration
        const auto& config = detector_->get_config();
        adaptive_state_.hue_min = config.hue_min;
        adaptive_state_.hue_max = config.hue_max;
        adaptive_state_.sat_min = config.sat_min;
        adaptive_state_.sat_max = config.sat_max;
        adaptive_state_.val_min = config.val_min;
        adaptive_state_.val_max = config.val_max;
    }
    return result;
}

bool ProductionHandDetector::auto_calibrate(const camera::Frame& frame) {
    // Detect hands first
    auto detections = detector_->detect(frame);
    
    if (detections.empty()) {
        return false;
    }
    
    // Use the first detected hand for calibration
    const auto& hand = detections[0];
    return calibrate_skin(frame, hand.bbox.x, hand.bbox.y, 
                         hand.bbox.width, hand.bbox.height);
}

void ProductionHandDetector::update_tracking(const std::vector<HandDetection>& detections) {
    // Mark all tracks as potentially lost
    for (auto& track : tracked_hands_) {
        track.frames_since_last_seen++;
    }
    
    // Match detections to existing tracks
    std::vector<bool> detection_matched(detections.size(), false);
    std::vector<bool> track_matched(tracked_hands_.size(), false);
    
    for (size_t i = 0; i < detections.size(); ++i) {
        float best_iou = 0.0f;
        int best_track_idx = -1;
        
        for (size_t j = 0; j < tracked_hands_.size(); ++j) {
            if (track_matched[j]) continue;
            
            float iou = compute_iou(detections[i].bbox, tracked_hands_[j].detection.bbox);
            if (iou > production_config_.tracking_iou_threshold && iou > best_iou) {
                best_iou = iou;
                best_track_idx = static_cast<int>(j);
            }
        }
        
        if (best_track_idx >= 0) {
            // Update existing track
            auto& track = tracked_hands_[best_track_idx];
            track.detection = detections[i];
            track.frames_tracked++;
            track.frames_since_last_seen = 0;
            track.gesture_history.push_back(detections[i].gesture);
            track.center_history.push_back(detections[i].center);
            
            // Limit history size
            if (track.gesture_history.size() > 
                static_cast<size_t>(production_config_.gesture_stabilization_frames)) {
                track.gesture_history.pop_front();
            }
            if (track.center_history.size() > 
                static_cast<size_t>(production_config_.tracking_history_frames)) {
                track.center_history.pop_front();
            }
            
            // Update tracking confidence
            track.tracking_confidence = std::min(1.0f, 
                track.tracking_confidence * 0.9f + 0.1f);
            
            detection_matched[i] = true;
            track_matched[best_track_idx] = true;
        }
    }
    
    // Create new tracks for unmatched detections
    for (size_t i = 0; i < detections.size(); ++i) {
        if (!detection_matched[i]) {
            TrackedHand new_track;
            new_track.detection = detections[i];
            new_track.track_id = next_track_id_++;
            new_track.frames_tracked = 1;
            new_track.frames_since_last_seen = 0;
            new_track.gesture_history.push_back(detections[i].gesture);
            new_track.center_history.push_back(detections[i].center);
            new_track.tracking_confidence = detections[i].bbox.confidence;
            
            tracked_hands_.push_back(new_track);
        }
    }
}

void ProductionHandDetector::update_adaptive_params(const camera::Frame& frame) {
    if (!frame.data || frame.format != camera::PixelFormat::RGB888) {
        return;
    }
    
    // Sample frame brightness
    const size_t sample_step = 10;
    const size_t total_pixels = frame.width * frame.height;
    float brightness_sum = 0.0f;
    int sample_count = 0;
    
    for (size_t i = 0; i < total_pixels * 3; i += sample_step * 3) {
        uint8_t r = frame.data[i];
        uint8_t g = frame.data[i + 1];
        uint8_t b = frame.data[i + 2];
        
        // Compute perceived brightness
        float brightness = 0.299f * r + 0.587f * g + 0.114f * b;
        brightness_sum += brightness;
        sample_count++;
    }
    
    if (sample_count == 0) return;
    
    float current_brightness = brightness_sum / sample_count;
    
    // Exponential moving average
    adaptive_state_.brightness_avg = 
        adaptive_state_.brightness_avg * (1.0f - production_config_.lighting_adaptation_rate) +
        current_brightness * production_config_.lighting_adaptation_rate;
    
    // Adjust value (brightness) range based on ambient light
    const float target_brightness = 128.0f;
    const float brightness_ratio = adaptive_state_.brightness_avg / target_brightness;
    
    // Adjust detector config
    DetectorConfig adjusted_config = detector_config_;
    
    if (brightness_ratio < 0.7f) {
        // Dark environment: lower thresholds
        adjusted_config.val_min = std::max(10, static_cast<int>(adaptive_state_.val_min * 0.7f));
        adjusted_config.sat_min = std::max(10, static_cast<int>(adaptive_state_.sat_min * 0.8f));
    } else if (brightness_ratio > 1.3f) {
        // Bright environment: raise thresholds
        adjusted_config.val_min = std::min(80, static_cast<int>(adaptive_state_.val_min * 1.3f));
        adjusted_config.sat_max = std::min(255, static_cast<int>(adaptive_state_.sat_max * 1.1f));
    }
    
    detector_->set_config(adjusted_config);
    
    if (production_config_.verbose && adaptive_state_.frames_processed % 30 == 0) {
        std::cerr << "[ProductionDetector] Adaptive: brightness=" << adaptive_state_.brightness_avg
                  << " val_min=" << adjusted_config.val_min 
                  << " sat_min=" << adjusted_config.sat_min << "\n";
    }
}

Gesture ProductionHandDetector::stabilize_gesture(const TrackedHand& track) {
    if (track.gesture_history.empty()) {
        return Gesture::UNKNOWN;
    }
    
    // Count occurrences of each gesture
    int counts[8] = {0};
    for (Gesture g : track.gesture_history) {
        counts[static_cast<int>(g)]++;
    }
    
    // Find most common gesture
    int max_count = 0;
    Gesture most_common = Gesture::UNKNOWN;
    for (int i = 0; i < 8; i++) {
        if (counts[i] > max_count) {
            max_count = counts[i];
            most_common = static_cast<Gesture>(i);
        }
    }
    
    // Require minimum confidence (majority vote)
    const float confidence = static_cast<float>(max_count) / track.gesture_history.size();
    if (confidence < production_config_.gesture_confidence_threshold) {
        return Gesture::UNKNOWN;
    }
    
    return most_common;
}

float ProductionHandDetector::compute_iou(const BoundingBox& a, const BoundingBox& b) {
    const int x1 = std::max(a.x, b.x);
    const int y1 = std::max(a.y, b.y);
    const int x2 = std::min(a.x + a.width, b.x + b.width);
    const int y2 = std::min(a.y + a.height, b.y + b.height);
    
    if (x2 <= x1 || y2 <= y1) {
        return 0.0f;
    }
    
    const int intersection = (x2 - x1) * (y2 - y1);
    const int union_area = a.area() + b.area() - intersection;
    
    return static_cast<float>(intersection) / std::max(1, union_area);
}

bool ProductionHandDetector::match_detection_to_track(const HandDetection& det, 
                                                     const TrackedHand& track) {
    return compute_iou(det.bbox, track.detection.bbox) > production_config_.tracking_iou_threshold;
}

void ProductionHandDetector::prune_lost_tracks() {
    // Remove tracks that haven't been seen for too long
    const int max_frames_lost = 30;
    
    tracked_hands_.erase(
        std::remove_if(tracked_hands_.begin(), tracked_hands_.end(),
            [max_frames_lost](const TrackedHand& track) {
                return track.frames_since_last_seen > max_frames_lost;
            }),
        tracked_hands_.end()
    );
}

ProductionHandDetector::ROI ProductionHandDetector::compute_search_roi(const camera::Frame& frame) {
    if (!last_detection_roi_.valid) {
        // Full frame search
        ROI roi;
        roi.x = 0;
        roi.y = 0;
        roi.width = frame.width;
        roi.height = frame.height;
        roi.valid = true;
        return roi;
    }
    
    return last_detection_roi_;
}

} // namespace hand_detector
