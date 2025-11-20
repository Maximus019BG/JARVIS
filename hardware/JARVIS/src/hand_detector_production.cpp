#include "hand_detector_production.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <numeric>
#include <map>

namespace hand_detector
{

    ProductionHandDetector::ProductionHandDetector()
        : detector_(std::make_unique<HandDetector>())
    {
        reset_stats();
        reset_tracking();
        last_detection_roi_.valid = false;

        // Initialize adaptive state with optimized defaults for IMX500
        adaptive_state_.hue_min = 0;
        adaptive_state_.hue_max = 25;
        adaptive_state_.sat_min = 20;
        adaptive_state_.sat_max = 200;
        adaptive_state_.val_min = 40;
        adaptive_state_.val_max = 255;
        adaptive_state_.brightness_avg = 128.0f;
        adaptive_state_.frames_processed = 0;

        // Initialize production config with enterprise defaults
        production_config_.enable_tracking = true;
        production_config_.tracking_history_frames = 7;
        production_config_.tracking_iou_threshold = 0.25f;
        production_config_.adaptive_lighting = true;
        production_config_.lighting_adaptation_rate = 0.08f;
        production_config_.gesture_stabilization_frames = 12;
        production_config_.gesture_confidence_threshold = 0.65f;
        production_config_.enable_roi_tracking = true;
        production_config_.roi_expansion_pixels = 60;
        production_config_.filter_low_confidence = true;
        production_config_.min_detection_quality = 0.4f;
        production_config_.verbose = false;
    }

    ProductionHandDetector::ProductionHandDetector(const DetectorConfig &detector_config,
                                                   const ProductionConfig &production_config)
        : detector_config_(detector_config),
          production_config_(production_config),
          detector_(std::make_unique<HandDetector>(detector_config))
    {
        reset_stats();
        reset_tracking();
        last_detection_roi_.valid = false;

        // Initialize adaptive state from config with optimizations
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

    bool ProductionHandDetector::init(const DetectorConfig &detector_config,
                                      const ProductionConfig &production_config)
    {
        detector_config_ = detector_config;
        production_config_ = production_config;

        detector_ = std::make_unique<HandDetector>(detector_config);
        if (!detector_->init(detector_config))
        {
            return false;
        }

        reset_stats();
        reset_tracking();

        if (production_config_.verbose)
        {
            std::cerr << "[ProductionDetector] Initialized\n";
            std::cerr << "  Tracking: " << (production_config_.enable_tracking ? "enabled" : "disabled") << "\n";
            std::cerr << "  Adaptive lighting: " << (production_config_.adaptive_lighting ? "enabled" : "disabled") << "\n";
            std::cerr << "  ROI optimization: " << (production_config_.enable_roi_tracking ? "enabled" : "disabled") << "\n";
        }

        return true;
    }

    std::vector<HandDetection> ProductionHandDetector::detect(const camera::Frame &frame)
    {
        // Adaptive lighting adjustment (every 30 frames for efficiency)
        if (production_config_.adaptive_lighting &&
            adaptive_state_.frames_processed % 30 == 0)
        {
            update_adaptive_params(frame);
        }

        // Detect hands using base detector
        std::vector<HandDetection> detections = detector_->detect(frame);

        // ENTERPRISE ENHANCEMENT 1: Multi-stage confidence boosting
        // Boost confidence of detections in tracked regions
        if (production_config_.enable_tracking && !tracked_hands_.empty())
        {
            for (auto &det : detections)
            {
                for (const auto &track : tracked_hands_)
                {
                    float iou = compute_iou(det.bbox, track.detection.bbox);
                    if (iou > 0.3f)
                    {
                        // Temporal confidence boost: stable tracks get higher confidence
                        float boost_factor = std::min(1.2f, 1.0f + (track.frames_tracked * 0.02f));
                        det.bbox.confidence = std::min(1.0f, det.bbox.confidence * boost_factor);
                    }
                }
            }
        }

        // Update tracking if enabled
        if (production_config_.enable_tracking)
        {
            update_tracking(detections);

            // ENTERPRISE ENHANCEMENT 2: Apply stabilized gestures with temporal filtering
            for (auto &det : detections)
            {
                // Find corresponding track
                for (auto &track : tracked_hands_)
                {
                    if (match_detection_to_track(det, track))
                    {
                        // Get stabilized gesture from temporal history
                        Gesture stabilized = stabilize_gesture(track);
                        if (stabilized != Gesture::UNKNOWN)
                        {
                            det.gesture = stabilized;

                            // Smooth confidence with track history
                            float gesture_stability = static_cast<float>(
                                                          std::count(track.gesture_history.begin(),
                                                                     track.gesture_history.end(), stabilized)) /
                                                      track.gesture_history.size();

                            det.gesture_confidence = gesture_stability * track.tracking_confidence;
                        }

                        // ENTERPRISE ENHANCEMENT 3: Smoothed position for jitter reduction
                        if (track.center_history.size() >= 3)
                        {
                            // Average last N positions for smooth tracking
                            int sum_x = 0, sum_y = 0;
                            size_t count = std::min(track.center_history.size(), size_t(5));
                            auto it = track.center_history.rbegin();
                            for (size_t i = 0; i < count; ++i, ++it)
                            {
                                sum_x += it->x;
                                sum_y += it->y;
                            }
                            det.center.x = sum_x / count;
                            det.center.y = sum_y / count;
                        }

                        break;
                    }
                }
            }

            prune_lost_tracks();
        }

        // ENTERPRISE ENHANCEMENT 4: Adaptive confidence filtering
        // Lower threshold for tracked hands, higher for new detections
        if (production_config_.filter_low_confidence)
        {
            detections.erase(
                std::remove_if(detections.begin(), detections.end(),
                               [this](const HandDetection &d)
                               {
                                   // Check if this detection matches a stable track
                                   for (const auto &track : tracked_hands_)
                                   {
                                       if (compute_iou(d.bbox, track.detection.bbox) > 0.3f &&
                                           track.frames_tracked > 5)
                                       {
                                           // Tracked hand: more lenient threshold
                                           return d.bbox.confidence < (production_config_.min_detection_quality * 0.7f);
                                       }
                                   }
                                   // New detection: standard threshold
                                   return d.bbox.confidence < production_config_.min_detection_quality;
                               }),
                detections.end());
        }

        // Update ROI for next frame (performance optimization)
        if (production_config_.enable_roi_tracking && !detections.empty())
        {
            // Compute bounding box of all detections
            int min_x = detections[0].bbox.x;
            int min_y = detections[0].bbox.y;
            int max_x = detections[0].bbox.x + detections[0].bbox.width;
            int max_y = detections[0].bbox.y + detections[0].bbox.height;

            for (size_t i = 1; i < detections.size(); ++i)
            {
                min_x = std::min(min_x, detections[i].bbox.x);
                min_y = std::min(min_y, detections[i].bbox.y);
                max_x = std::max(max_x, detections[i].bbox.x + detections[i].bbox.width);
                max_y = std::max(max_y, detections[i].bbox.y + detections[i].bbox.height);
            }

            // Expand ROI with adaptive expansion based on motion
            int exp = production_config_.roi_expansion_pixels;

            // If we have tracking data, expand more for fast-moving hands
            for (const auto &track : tracked_hands_)
            {
                if (track.center_history.size() >= 2)
                {
                    auto it = track.center_history.rbegin();
                    Point curr = *it++;
                    Point prev = *it;
                    int motion = std::abs(curr.x - prev.x) + std::abs(curr.y - prev.y);
                    exp = std::max(exp, std::min(120, exp + motion / 2));
                }
            }

            last_detection_roi_.x = std::max(0, min_x - exp);
            last_detection_roi_.y = std::max(0, min_y - exp);
            last_detection_roi_.width = std::min(static_cast<int>(frame.width) - last_detection_roi_.x,
                                                 max_x - min_x + 2 * exp);
            last_detection_roi_.height = std::min(static_cast<int>(frame.height) - last_detection_roi_.y,
                                                  max_y - min_y + 2 * exp);
            last_detection_roi_.valid = true;
        }
        else if (detections.empty())
        {
            // Gradually expand search area when hand is lost
            if (last_detection_roi_.valid)
            {
                int exp = 20;
                last_detection_roi_.x = std::max(0, last_detection_roi_.x - exp);
                last_detection_roi_.y = std::max(0, last_detection_roi_.y - exp);
                last_detection_roi_.width = std::min(static_cast<int>(frame.width) - last_detection_roi_.x,
                                                     last_detection_roi_.width + 2 * exp);
                last_detection_roi_.height = std::min(static_cast<int>(frame.height) - last_detection_roi_.y,
                                                      last_detection_roi_.height + 2 * exp);
            }
        }

        // Update statistics from base detector
        stats_ = detector_->get_stats();
        adaptive_state_.frames_processed++;

        return detections;
    }

    void ProductionHandDetector::set_detector_config(const DetectorConfig &config)
    {
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

    void ProductionHandDetector::set_production_config(const ProductionConfig &config)
    {
        production_config_ = config;
    }

    void ProductionHandDetector::reset_stats()
    {
        stats_.reset();
        if (detector_)
        {
            detector_->reset_stats();
        }
    }

    void ProductionHandDetector::reset_tracking()
    {
        tracked_hands_.clear();
        next_track_id_ = 0;
    }

    bool ProductionHandDetector::calibrate_skin(const camera::Frame &frame,
                                                int roi_x, int roi_y,
                                                int roi_w, int roi_h)
    {
        bool result = detector_->calibrate_skin(frame, roi_x, roi_y, roi_w, roi_h);
        if (result)
        {
            // Update adaptive state with new calibration
            const auto &config = detector_->get_config();
            adaptive_state_.hue_min = config.hue_min;
            adaptive_state_.hue_max = config.hue_max;
            adaptive_state_.sat_min = config.sat_min;
            adaptive_state_.sat_max = config.sat_max;
            adaptive_state_.val_min = config.val_min;
            adaptive_state_.val_max = config.val_max;
        }
        return result;
    }

    bool ProductionHandDetector::auto_calibrate(const camera::Frame &frame)
    {
        // Detect hands first
        auto detections = detector_->detect(frame);

        if (detections.empty())
        {
            return false;
        }

        // Use the first detected hand for calibration
        const auto &hand = detections[0];
        return calibrate_skin(frame, hand.bbox.x, hand.bbox.y,
                              hand.bbox.width, hand.bbox.height);
    }

    void ProductionHandDetector::update_tracking(const std::vector<HandDetection> &detections)
    {
        // Mark all tracks as potentially lost
        for (auto &track : tracked_hands_)
        {
            track.frames_since_last_seen++;
        }

        // Match detections to existing tracks
        std::vector<bool> detection_matched(detections.size(), false);
        std::vector<bool> track_matched(tracked_hands_.size(), false);

        for (size_t i = 0; i < detections.size(); ++i)
        {
            float best_iou = 0.0f;
            int best_track_idx = -1;

            for (size_t j = 0; j < tracked_hands_.size(); ++j)
            {
                if (track_matched[j])
                    continue;

                float iou = compute_iou(detections[i].bbox, tracked_hands_[j].detection.bbox);
                if (iou > production_config_.tracking_iou_threshold && iou > best_iou)
                {
                    best_iou = iou;
                    best_track_idx = static_cast<int>(j);
                }
            }

            if (best_track_idx >= 0)
            {
                // Update existing track
                auto &track = tracked_hands_[best_track_idx];
                track.detection = detections[i];
                track.frames_tracked++;
                track.frames_since_last_seen = 0;
                track.gesture_history.push_back(detections[i].gesture);
                track.center_history.push_back(detections[i].center);

                // Limit history size
                if (track.gesture_history.size() >
                    static_cast<size_t>(production_config_.gesture_stabilization_frames))
                {
                    track.gesture_history.pop_front();
                }
                if (track.center_history.size() >
                    static_cast<size_t>(production_config_.tracking_history_frames))
                {
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
        for (size_t i = 0; i < detections.size(); ++i)
        {
            if (!detection_matched[i])
            {
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

    void ProductionHandDetector::update_adaptive_params(const camera::Frame &frame)
    {
        if (!frame.data || frame.format != camera::PixelFormat::RGB888)
        {
            return;
        }

        // ENTERPRISE ENHANCEMENT: Stratified sampling for better representation
        // Sample different regions of the frame
        const int num_regions = 9; // 3x3 grid
        const int region_w = frame.width / 3;
        const int region_h = frame.height / 3;

        float brightness_sum = 0.0f;
        float saturation_sum = 0.0f;
        int sample_count = 0;

        // Sample from center of each region
        for (int ry = 0; ry < 3; ++ry)
        {
            for (int rx = 0; rx < 3; ++rx)
            {
                int cx = rx * region_w + region_w / 2;
                int cy = ry * region_h + region_h / 2;

                // Sample a small window around center point
                for (int dy = -5; dy <= 5; dy += 2)
                {
                    for (int dx = -5; dx <= 5; dx += 2)
                    {
                        int px = std::max(0, std::min(static_cast<int>(frame.width) - 1, cx + dx));
                        int py = std::max(0, std::min(static_cast<int>(frame.height) - 1, cy + dy));
                        int idx = (py * frame.stride) + (px * 3);

                        if (idx + 2 >= static_cast<int>(frame.stride * frame.height))
                            continue;

                        uint8_t r = frame.data[idx];
                        uint8_t g = frame.data[idx + 1];
                        uint8_t b = frame.data[idx + 2];

                        // Compute perceived brightness (ITU-R BT.709)
                        float brightness = 0.2126f * r + 0.7152f * g + 0.0722f * b;
                        brightness_sum += brightness;

                        // Compute saturation for skin tone adaptation
                        uint8_t max_rgb = std::max({r, g, b});
                        uint8_t min_rgb = std::min({r, g, b});
                        float sat = (max_rgb == 0) ? 0.0f : ((max_rgb - min_rgb) / static_cast<float>(max_rgb)) * 255.0f;
                        saturation_sum += sat;

                        sample_count++;
                    }
                }
            }
        }

        if (sample_count == 0)
            return;

        float current_brightness = brightness_sum / sample_count;
        float current_saturation = saturation_sum / sample_count;

        // Exponential moving average with slower adaptation for stability
        const float alpha = production_config_.lighting_adaptation_rate;
        adaptive_state_.brightness_avg =
            adaptive_state_.brightness_avg * (1.0f - alpha) + current_brightness * alpha;

        // Adjust detector config based on lighting conditions
        DetectorConfig adjusted_config = detector_config_;

        const float target_brightness = 128.0f;
        const float brightness_ratio = adaptive_state_.brightness_avg / target_brightness;

        // Multi-stage adaptive threshold adjustment
        if (brightness_ratio < 0.5f)
        {
            // Very dark: aggressive threshold reduction
            adjusted_config.val_min = std::max(15, static_cast<int>(adaptive_state_.val_min * 0.5f));
            adjusted_config.sat_min = std::max(10, static_cast<int>(adaptive_state_.sat_min * 0.65f));
            adjusted_config.val_max = 255;
        }
        else if (brightness_ratio < 0.75f)
        {
            // Dark: moderate threshold reduction
            adjusted_config.val_min = std::max(25, static_cast<int>(adaptive_state_.val_min * 0.75f));
            adjusted_config.sat_min = std::max(15, static_cast<int>(adaptive_state_.sat_min * 0.85f));
        }
        else if (brightness_ratio > 1.5f)
        {
            // Very bright: raise thresholds significantly
            adjusted_config.val_min = std::min(90, static_cast<int>(adaptive_state_.val_min * 1.5f));
            adjusted_config.sat_max = std::min(255, static_cast<int>(adaptive_state_.sat_max * 1.15f));
            adjusted_config.sat_min = std::max(15, static_cast<int>(adaptive_state_.sat_min * 1.1f));
        }
        else if (brightness_ratio > 1.2f)
        {
            // Bright: moderate threshold increase
            adjusted_config.val_min = std::min(70, static_cast<int>(adaptive_state_.val_min * 1.2f));
            adjusted_config.sat_max = std::min(255, static_cast<int>(adaptive_state_.sat_max * 1.08f));
        }

        // Adaptive hue range based on observed saturation
        // Low saturation environments need wider hue tolerance
        if (current_saturation < 30.0f)
        {
            adjusted_config.hue_max = std::min(35, adaptive_state_.hue_max + 5);
        }

        detector_->set_config(adjusted_config);

        if (production_config_.verbose && adaptive_state_.frames_processed % 90 == 0)
        {
            std::cerr << "[ProductionDetector] Adaptive Lighting:\n";
            std::cerr << "  Brightness: " << adaptive_state_.brightness_avg
                      << " (ratio: " << brightness_ratio << ")\n";
            std::cerr << "  Saturation: " << current_saturation << "\n";
            std::cerr << "  HSV range: H[" << adjusted_config.hue_min << "-" << adjusted_config.hue_max
                      << "] S[" << adjusted_config.sat_min << "-" << adjusted_config.sat_max
                      << "] V[" << adjusted_config.val_min << "-" << adjusted_config.val_max << "]\n";
        }
    }

    Gesture ProductionHandDetector::stabilize_gesture(const TrackedHand &track)
    {
        if (track.gesture_history.empty())
        {
            return Gesture::UNKNOWN;
        }

        // ENTERPRISE ENHANCEMENT: Weighted voting with recency bias
        // Recent gestures have more weight
        std::map<Gesture, float> gesture_scores;

        float total_weight = 0.0f;
        size_t hist_size = track.gesture_history.size();

        for (size_t i = 0; i < hist_size; ++i)
        {
            Gesture g = track.gesture_history[i];

            // Exponential weight: recent frames have more influence
            // Most recent = index (hist_size - 1), oldest = index 0
            float recency_factor = static_cast<float>(i) / hist_size;
            float weight = 0.5f + (recency_factor * 0.5f); // Weight from 0.5 to 1.0

            gesture_scores[g] += weight;
            total_weight += weight;
        }

        // Find gesture with highest weighted score
        Gesture best_gesture = Gesture::UNKNOWN;
        float best_score = 0.0f;

        for (const auto &entry : gesture_scores)
        {
            if (entry.second > best_score)
            {
                best_score = entry.second;
                best_gesture = entry.first;
            }
        }

        // Require minimum confidence (weighted threshold)
        float confidence = best_score / total_weight;

        // Lower threshold for stable gestures (POINTING, FIST, OPEN_PALM)
        // Higher threshold for complex gestures (PEACE, OK, THUMBS_UP)
        float threshold = production_config_.gesture_confidence_threshold;

        if (best_gesture == Gesture::POINTING ||
            best_gesture == Gesture::FIST ||
            best_gesture == Gesture::OPEN_PALM)
        {
            threshold *= 0.85f; // More lenient for common gestures
        }

        if (confidence < threshold)
        {
            return Gesture::UNKNOWN;
        }

        // Consistency override: Align gesture with current finger count if clearly inconsistent.
        // Prevent OPEN_PALM label when only one finger is extended (should be POINTING), etc.
        int fingers = track.detection.num_fingers;
        Gesture expected = Gesture::UNKNOWN;
        switch (fingers)
        {
        case 0:
            expected = Gesture::FIST;
            break;
        case 1:
            expected = Gesture::POINTING;
            break;
        case 2:
            expected = Gesture::PEACE;
            break;
        case 5:
            expected = Gesture::OPEN_PALM;
            break;
        default:
            break; // Leave complex / partial gestures to history voting
        }

        // Override if mismatch and we have reasonable confidence.
        if (expected != Gesture::UNKNOWN && best_gesture != expected)
        {
            // Hysteresis: require slightly lower threshold for correction.
            if (confidence > threshold * 0.75f)
            {
                best_gesture = expected;
            }
        }

        return best_gesture;
    }

    float ProductionHandDetector::compute_iou(const BoundingBox &a, const BoundingBox &b)
    {
        const int x1 = std::max(a.x, b.x);
        const int y1 = std::max(a.y, b.y);
        const int x2 = std::min(a.x + a.width, b.x + b.width);
        const int y2 = std::min(a.y + a.height, b.y + b.height);

        if (x2 <= x1 || y2 <= y1)
        {
            return 0.0f;
        }

        const int intersection = (x2 - x1) * (y2 - y1);
        const int union_area = a.area() + b.area() - intersection;

        return static_cast<float>(intersection) / std::max(1, union_area);
    }

    bool ProductionHandDetector::match_detection_to_track(const HandDetection &det,
                                                          const TrackedHand &track)
    {
        return compute_iou(det.bbox, track.detection.bbox) > production_config_.tracking_iou_threshold;
    }

    void ProductionHandDetector::prune_lost_tracks()
    {
        // Remove tracks that haven't been seen for too long
        const int max_frames_lost = 30;

        tracked_hands_.erase(
            std::remove_if(tracked_hands_.begin(), tracked_hands_.end(),
                           [max_frames_lost](const TrackedHand &track)
                           {
                               return track.frames_since_last_seen > max_frames_lost;
                           }),
            tracked_hands_.end());
    }

    ProductionHandDetector::ROI ProductionHandDetector::compute_search_roi(const camera::Frame &frame)
    {
        if (!last_detection_roi_.valid)
        {
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
