#include "hand_detector.hpp"
#include "hand_detector_config.hpp"
#include "hand_detector_simd.hpp"
#include <cmath>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <iostream>
#include <queue>

namespace hand_detector {

// Point methods
double Point::distance(const Point& other) const {
    const double dx = x - other.x;
    const double dy = y - other.y;
    return std::sqrt(dx * dx + dy * dy);
}

// HandDetector implementation
HandDetector::HandDetector() : config_() {
    reset_stats();
}

HandDetector::HandDetector(const DetectorConfig& config) : config_(config) {
    reset_stats();
}

HandDetector::~HandDetector() {}

bool HandDetector::init(const DetectorConfig& config) {
    config_ = config;
    reset_stats();
    
    // Validate configuration
    if (!config_.validate()) {
        std::cerr << "[HandDetector] ERROR: Invalid configuration\n";
        return false;
    }
    
    if (config_.verbose) {
        std::cerr << "[HandDetector] Initialized\n";
        std::cerr << "  Skin HSV range: H[" << config_.hue_min << "-" << config_.hue_max 
                  << "] S[" << config_.sat_min << "-" << config_.sat_max
                  << "] V[" << config_.val_min << "-" << config_.val_max << "]\n";
        std::cerr << "  SIMD support: " << (simd::is_neon_available() ? "NEON" : "Scalar") << "\n";
    }
    
    return true;
}

void HandDetector::set_config(const DetectorConfig& config) {
    config_ = config;
}

void HandDetector::reset_stats() {
    stats_.reset();
    gesture_history_.clear();
}

std::vector<HandDetection> HandDetector::detect(const camera::Frame& frame) {
    auto start_time = std::chrono::steady_clock::now();
    
    std::vector<HandDetection> detections;
    
    if (!frame.data || frame.width == 0 || frame.height == 0) {
        return detections;
    }
    
    const uint32_t work_width = frame.width / config_.downscale_factor;
    const uint32_t work_height = frame.height / config_.downscale_factor;
    const size_t pixel_count = work_width * work_height;
    
    // Ensure buffers are allocated (reuse across frames)
    if (hsv_buffer_.size() < pixel_count * 3) {
        hsv_buffer_.resize(pixel_count * 3);
        mask_buffer_.resize(pixel_count);
        temp_buffer_.resize(pixel_count * 3);
    }
    
    auto stage_start = std::chrono::steady_clock::now();
    
    // Step 1: Convert RGB to HSV (with SIMD if available)
    if (frame.format == camera::PixelFormat::RGB888) {
        if (config_.downscale_factor > 1) {
            camera::utils::resize_nearest(frame.data, temp_buffer_.data(),
                                         frame.width, frame.height,
                                         work_width, work_height, 3);
            if (config_.enable_simd && simd::is_neon_available()) {
                simd::convert_rgb_to_hsv_simd(temp_buffer_.data(), hsv_buffer_.data(), pixel_count);
            } else {
                simd::scalar::convert_rgb_to_hsv(temp_buffer_.data(), hsv_buffer_.data(), pixel_count);
            }
        } else {
            if (config_.enable_simd && simd::is_neon_available()) {
                simd::convert_rgb_to_hsv_simd(frame.data, hsv_buffer_.data(), pixel_count);
            } else {
                simd::scalar::convert_rgb_to_hsv(frame.data, hsv_buffer_.data(), pixel_count);
            }
        }
    } else {
        return detections; // Unsupported format
    }
    
    auto stage_end = std::chrono::steady_clock::now();
    stats_.conversion_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();
    
    // Step 2: Apply skin color mask (with SIMD)
    stage_start = std::chrono::steady_clock::now();
    if (config_.enable_simd && simd::is_neon_available()) {
        simd::create_skin_mask_simd(hsv_buffer_.data(), mask_buffer_.data(), pixel_count,
                                    config_.hue_min, config_.hue_max,
                                    config_.sat_min, config_.sat_max,
                                    config_.val_min, config_.val_max);
    } else {
        simd::scalar::create_skin_mask(hsv_buffer_.data(), mask_buffer_.data(), pixel_count,
                                       config_.hue_min, config_.hue_max,
                                       config_.sat_min, config_.sat_max,
                                       config_.val_min, config_.val_max);
    }
    stage_end = std::chrono::steady_clock::now();
    stats_.masking_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();
    
    // Quick check: if very few skin pixels detected, skip contour finding
    uint32_t skin_pixel_count = 0;
    for (size_t i = 0; i < pixel_count; ++i) {
        if (mask_buffer_[i] > 0) skin_pixel_count++;
    }
    
    // If less than min_hand_area/3 pixels are skin-colored, likely no hand present
    // Use 1/3 threshold (more permissive) since morphology will reduce area further
    if (skin_pixel_count < static_cast<uint32_t>(config_.min_hand_area / 3)) {
        return detections; // Early exit - no hand possible
    }
    
    // Step 3: Morphological operations
    if (config_.enable_morphology) {
        stage_start = std::chrono::steady_clock::now();
        morphological_operations(mask_buffer_.data(), work_width, work_height);
        stage_end = std::chrono::steady_clock::now();
        stats_.morphology_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();
    }
    
    // Step 4: Find contours
    stage_start = std::chrono::steady_clock::now();
    auto contours = find_contours(mask_buffer_.data(), work_width, work_height);
    stage_end = std::chrono::steady_clock::now();
    stats_.contours_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();
    
    // Step 5: Analyze each contour
    stage_start = std::chrono::steady_clock::now();
    
    // Only process top 3 largest contours to avoid wasting time on noise
    const size_t max_contours_to_check = std::min(size_t(3), contours.size());
    
    for (size_t c = 0; c < max_contours_to_check; ++c) {
        const auto& contour = contours[c];
        
        // Calculate actual contour area using shoelace formula (polygon area)
        double polygon_area = 0.0;
        for (size_t i = 0; i < contour.size(); i++) {
            size_t j = (i + 1) % contour.size();
            polygon_area += contour[i].x * contour[j].y;
            polygon_area -= contour[j].x * contour[i].y;
        }
        polygon_area = std::abs(polygon_area) / 2.0;
        
        // Filter by actual area (not just point count)
        if (polygon_area < config_.min_hand_area || polygon_area > config_.max_hand_area) {
            continue;
        }
        
        HandDetection hand = analyze_contour(contour, work_width, work_height);
        
        // Additional validation: check if contour is hand-like before accepting
        // Hand should have reasonable solidity (area/bounding_box_area ratio)
        const float bbox_area = static_cast<float>(hand.bbox.area());
        const float solidity = bbox_area > 0 ? static_cast<float>(polygon_area) / bbox_area : 0.0f;
        
        // Hand solidity typically 0.3-0.95 (more relaxed range to catch all hand poses and angles)
        if (solidity < 0.30f || solidity > 0.98f) {
            continue;
        }
        
        // Store actual area
        hand.contour_area = static_cast<uint32_t>(polygon_area);
        
        // Scale back to original resolution
        if (config_.downscale_factor > 1) {
            hand.bbox.x *= config_.downscale_factor;
            hand.bbox.y *= config_.downscale_factor;
            hand.bbox.width *= config_.downscale_factor;
            hand.bbox.height *= config_.downscale_factor;
            hand.center.x *= config_.downscale_factor;
            hand.center.y *= config_.downscale_factor;
            
            for (auto& pt : hand.contour) {
                pt.x *= config_.downscale_factor;
                pt.y *= config_.downscale_factor;
            }
            for (auto& pt : hand.fingertips) {
                pt.x *= config_.downscale_factor;
                pt.y *= config_.downscale_factor;
            }
        }
        
        // Gesture recognition
        if (config_.enable_gesture && hand.bbox.confidence >= config_.min_confidence) {
            hand.gesture = classify_gesture(hand);
            hand.gesture = stabilize_gesture(hand.gesture);
        }
        
        if (config_.verbose) {
            std::cerr << "[Hand] Area:" << polygon_area 
                      << " Solidity:" << solidity 
                      << " Fingers:" << hand.num_fingers
                      << " Conf:" << hand.bbox.confidence
                      << " Gesture:" << gesture_to_string(hand.gesture) << "\n";
        }
        
        if (hand.bbox.confidence >= config_.min_confidence) {
            detections.push_back(hand);
        }
    }
    stage_end = std::chrono::steady_clock::now();
    stats_.analysis_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();
    
    // Update statistics
    stats_.frames_processed++;
    stats_.hands_detected += detections.size();
    stats_.last_detection_timestamp = frame.timestamp_ns;
    
    auto end_time = std::chrono::steady_clock::now();
    const double process_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    
    // Running average
    stats_.avg_process_time_ms = 
        (stats_.avg_process_time_ms * (stats_.frames_processed - 1) + process_time) / 
        stats_.frames_processed;
    
    if (config_.verbose && !detections.empty()) {
        std::cerr << "[HandDetector] Detected " << detections.size() << " hand(s) in " 
                  << process_time << " ms (HSV:" << stats_.conversion_ms 
                  << " Mask:" << stats_.masking_ms 
                  << " Morph:" << stats_.morphology_ms 
                  << " Cont:" << stats_.contours_ms 
                  << " Anal:" << stats_.analysis_ms << ")\n";
    }
    
    return detections;
}

bool HandDetector::calibrate_skin(const camera::Frame& frame, 
                                 int roi_x, int roi_y, 
                                 int roi_w, int roi_h) {
    if (!frame.data || frame.format != camera::PixelFormat::RGB888) {
        return false;
    }
    
    // Sample pixels in ROI and compute HSV statistics
    int h_min = 180, h_max = 0;
    int s_min = 255, s_max = 0;
    int v_min = 255, v_max = 0;
    
    int sample_count = 0;
    
    for (int y = roi_y; y < roi_y + roi_h && y < (int)frame.height; y++) {
        for (int x = roi_x; x < roi_x + roi_w && x < (int)frame.width; x++) {
            uint8_t r, g, b;
            if (!frame.get_rgb(x, y, r, g, b)) continue;
            
            // Convert RGB to HSV
            float rf = r / 255.0f;
            float gf = g / 255.0f;
            float bf = b / 255.0f;
            
            float cmax = std::max({rf, gf, bf});
            float cmin = std::min({rf, gf, bf});
            float delta = cmax - cmin;
            
            // Hue
            float h = 0;
            if (delta > 0) {
                if (cmax == rf) h = 60 * std::fmod((gf - bf) / delta, 6.0f);
                else if (cmax == gf) h = 60 * ((bf - rf) / delta + 2);
                else h = 60 * ((rf - gf) / delta + 4);
            }
            if (h < 0) h += 360;
            
            // Saturation
            float s = (cmax == 0) ? 0 : (delta / cmax);
            
            // Value
            float v = cmax;
            
            int h_int = static_cast<int>(h / 2); // OpenCV uses 0-179
            int s_int = static_cast<int>(s * 255);
            int v_int = static_cast<int>(v * 255);
            
            h_min = std::min(h_min, h_int);
            h_max = std::max(h_max, h_int);
            s_min = std::min(s_min, s_int);
            s_max = std::max(s_max, s_int);
            v_min = std::min(v_min, v_int);
            v_max = std::max(v_max, v_int);
            
            sample_count++;
        }
    }
    
    if (sample_count == 0) return false;
    
    // Add some tolerance
    config_.hue_min = std::max(0, h_min - 10);
    config_.hue_max = std::min(179, h_max + 10);
    config_.sat_min = std::max(0, s_min - 30);
    config_.sat_max = std::min(255, s_max + 30);
    config_.val_min = std::max(0, v_min - 30);
    config_.val_max = std::min(255, v_max + 30);
    
    if (config_.verbose) {
        std::cerr << "[HandDetector] Calibrated skin: H[" << config_.hue_min 
                  << "-" << config_.hue_max << "] S[" << config_.sat_min 
                  << "-" << config_.sat_max << "] V[" << config_.val_min 
                  << "-" << config_.val_max << "]\n";
    }
    
    return true;
}

// Internal processing functions - removed, now using SIMD versions

void HandDetector::morphological_operations(uint8_t* mask, 
                                            uint32_t width, uint32_t height) {
    // Enhanced morphological operations: erosion then dilation (opening) to remove noise
    // Then dilation followed by erosion (closing) to fill holes
    std::vector<uint8_t> temp(width * height);
    
    // Opening: Erosion (3x3 kernel) - removes small white noise
    for (uint32_t y = 1; y < height - 1; y++) {
        for (uint32_t x = 1; x < width - 1; x++) {
            uint8_t min_val = 255;
            for (int ky = -1; ky <= 1; ky++) {
                for (int kx = -1; kx <= 1; kx++) {
                    min_val = std::min(min_val, mask[(y + ky) * width + (x + kx)]);
                }
            }
            temp[y * width + x] = min_val;
        }
    }
    
    // Dilation (3x3 kernel)
    std::memcpy(mask, temp.data(), width * height);
    for (uint32_t y = 1; y < height - 1; y++) {
        for (uint32_t x = 1; x < width - 1; x++) {
            uint8_t max_val = 0;
            for (int ky = -1; ky <= 1; ky++) {
                for (int kx = -1; kx <= 1; kx++) {
                    max_val = std::max(max_val, mask[(y + ky) * width + (x + kx)]);
                }
            }
            temp[y * width + x] = max_val;
        }
    }
    
    // Closing: Dilation first
    std::memcpy(mask, temp.data(), width * height);
    for (uint32_t y = 1; y < height - 1; y++) {
        for (uint32_t x = 1; x < width - 1; x++) {
            uint8_t max_val = 0;
            for (int ky = -1; ky <= 1; ky++) {
                for (int kx = -1; kx <= 1; kx++) {
                    max_val = std::max(max_val, mask[(y + ky) * width + (x + kx)]);
                }
            }
            temp[y * width + x] = max_val;
        }
    }
    
    // Then Erosion
    for (uint32_t y = 1; y < height - 1; y++) {
        for (uint32_t x = 1; x < width - 1; x++) {
            uint8_t min_val = 255;
            for (int ky = -1; ky <= 1; ky++) {
                for (int kx = -1; kx <= 1; kx++) {
                    min_val = std::min(min_val, temp[(y + ky) * width + (x + kx)]);
                }
            }
            mask[y * width + x] = min_val;
        }
    }
}

std::vector<std::vector<Point>> HandDetector::find_contours(const uint8_t* mask,
                                                             uint32_t width, uint32_t height) {
    std::vector<std::vector<Point>> contours;
    std::vector<bool> visited(width * height, false);
    
    // Simple flood-fill based contour detection
    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width; x++) {
            size_t idx = y * width + x;
            
            if (mask[idx] > 0 && !visited[idx]) {
                std::vector<Point> contour;
                std::queue<Point> queue;
                queue.push(Point(x, y));
                visited[idx] = true;
                
                while (!queue.empty()) {
                    Point p = queue.front();
                    queue.pop();
                    contour.push_back(p);
                    
                    // Check 8-connected neighbors
                    for (int dy = -1; dy <= 1; dy++) {
                        for (int dx = -1; dx <= 1; dx++) {
                            if (dx == 0 && dy == 0) continue;
                            
                            int nx = p.x + dx;
                            int ny = p.y + dy;
                            
                            if (nx >= 0 && nx < (int)width && ny >= 0 && ny < (int)height) {
                                size_t nidx = ny * width + nx;
                                if (mask[nidx] > 0 && !visited[nidx]) {
                                    visited[nidx] = true;
                                    queue.push(Point(nx, ny));
                                }
                            }
                        }
                    }
                }
                
                // Only keep contours with minimum point count (filter noise early)
                // A hand should have at least 30 perimeter points even when downscaled
                if (contour.size() >= 30) {
                    contours.push_back(contour);
                }
            }
        }
    }
    
    // Sort contours by size (largest first) to prioritize main hand blob
    std::sort(contours.begin(), contours.end(), 
              [](const std::vector<Point>& a, const std::vector<Point>& b) {
                  return a.size() > b.size();
              });
    
    return contours;
}

HandDetection HandDetector::analyze_contour(const std::vector<Point>& contour,
                                           uint32_t frame_width, uint32_t frame_height) {
    HandDetection hand;
    
    // Compute bounding box
    hand.bbox = compute_bounding_box(contour);
    
    // Compute centroid
    hand.center = compute_centroid(contour);
    
    // Count fingers
    hand.num_fingers = count_fingers(contour, hand.center);
    
    // Find fingertips
    hand.fingertips = find_fingertips(contour, hand.center);
    
    // Store contour (downsampled for efficiency)
    hand.contour.clear();
    int step = std::max(1, static_cast<int>(contour.size()) / 50);
    for (size_t i = 0; i < contour.size(); i += step) {
        hand.contour.push_back(contour[i]);
    }
    
    // Compute confidence based on shape properties
    const float area_ratio = static_cast<float>(hand.bbox.area()) / (frame_width * frame_height);
    const float aspect_ratio = static_cast<float>(hand.bbox.width) / std::max(1, hand.bbox.height);
    
    // Start with moderate base confidence
    hand.bbox.confidence = 0.55f; // slightly lower to be more permissive
    
    // Hand-like properties (more lenient validation to catch all hands)
    // 1. Area should be reasonable (0.5-60% of frame) - very lenient range
    if (area_ratio >= 0.005f && area_ratio <= 0.6f) {
        hand.bbox.confidence += 0.20f; // larger boost for valid area
    } else if (area_ratio < 0.003f || area_ratio > 0.8f) {
        hand.bbox.confidence *= 0.35f; // Penalize extreme sizes
    } else {
        hand.bbox.confidence *= 0.65f; // Moderate penalty
    }
    
    // 2. Aspect ratio should be reasonable (hands vary from 0.4 to 2.5)
    if (aspect_ratio >= 0.4f && aspect_ratio <= 2.5f) {
        hand.bbox.confidence += 0.15f;
    } else if (aspect_ratio < 0.3f || aspect_ratio > 3.0f) {
        hand.bbox.confidence *= 0.5f;
    } else {
        hand.bbox.confidence *= 0.7f;
    }
    
    // 3. Finger count validation is lenient (algorithm isn't perfect)
    if (hand.num_fingers >= 0 && hand.num_fingers <= 6) {
        hand.bbox.confidence += 0.05f; // slight boost for reasonable count
    } else if (hand.num_fingers > 8) {
        hand.bbox.confidence *= 0.6f; // Only penalize very wrong counts
    }
    
    // 4. Having fingertips is a good sign but not required
    if (hand.fingertips.size() > 0 && hand.fingertips.size() <= 7) {
        hand.bbox.confidence += 0.05f;
    }
    
    // Clamp confidence to [0, 1]
    hand.bbox.confidence = std::min(1.0f, std::max(0.0f, hand.bbox.confidence));
    
    hand.gesture_confidence = hand.bbox.confidence;
    
    return hand;
}

BoundingBox HandDetector::compute_bounding_box(const std::vector<Point>& contour) {
    BoundingBox box;
    
    if (contour.empty()) return box;
    
    int min_x = contour[0].x, max_x = contour[0].x;
    int min_y = contour[0].y, max_y = contour[0].y;
    
    for (const auto& pt : contour) {
        min_x = std::min(min_x, pt.x);
        max_x = std::max(max_x, pt.x);
        min_y = std::min(min_y, pt.y);
        max_y = std::max(max_y, pt.y);
    }
    
    box.x = min_x;
    box.y = min_y;
    box.width = max_x - min_x;
    box.height = max_y - min_y;
    box.confidence = 0.8f;
    
    return box;
}

Point HandDetector::compute_centroid(const std::vector<Point>& contour) {
    if (contour.empty()) return Point(0, 0);
    
    long long sum_x = 0, sum_y = 0;
    for (const auto& pt : contour) {
        sum_x += pt.x;
        sum_y += pt.y;
    }
    
    return Point(sum_x / contour.size(), sum_y / contour.size());
}

// Convex hull via monotonic chain (returns hull in CCW order without duplicate last point)
std::vector<Point> HandDetector::compute_convex_hull(const std::vector<Point>& points) {
    std::vector<Point> pts = points;
    if (pts.size() < 3) return pts;

    std::sort(pts.begin(), pts.end(), [](const Point& a, const Point& b){
        if (a.x == b.x) return a.y < b.y;
        return a.x < b.x;
    });
    pts.erase(std::unique(pts.begin(), pts.end(), [](const Point& a, const Point& b){ return a.x==b.x && a.y==b.y; }), pts.end());
    if (pts.size() < 3) return pts;

    auto cross = [](const Point& O, const Point& A, const Point& B){
        long long dx1 = A.x - O.x; long long dy1 = A.y - O.y;
        long long dx2 = B.x - O.x; long long dy2 = B.y - O.y;
        return dx1 * dy2 - dy1 * dx2; // z-component of cross product
    };

    std::vector<Point> lower;
    lower.reserve(pts.size());
    for (const auto& p : pts) {
        while (lower.size() >= 2 && cross(lower[lower.size()-2], lower.back(), p) <= 0) {
            lower.pop_back();
        }
        lower.push_back(p);
    }

    std::vector<Point> upper;
    upper.reserve(pts.size());
    for (auto it = pts.rbegin(); it != pts.rend(); ++it) {
        while (upper.size() >= 2 && cross(upper[upper.size()-2], upper.back(), *it) <= 0) {
            upper.pop_back();
        }
        upper.push_back(*it);
    }

    // Concatenate lower and upper (omit last of each because it repeats start point)
    lower.pop_back();
    upper.pop_back();
    lower.insert(lower.end(), upper.begin(), upper.end());
    return lower;
}

int HandDetector::count_fingers(const std::vector<Point>& contour, const Point& center) {
    // Convex-hull based finger counting: more stable across poses
    if (contour.size() < 15) return 0;

    auto hull = compute_convex_hull(contour);
    if (hull.size() < 5) return 0; // not enough structure

    // Compute distances of hull vertices from center
    std::vector<double> dists(hull.size());
    double avg = 0.0, maxd = 0.0;
    for (size_t i = 0; i < hull.size(); ++i) {
        dists[i] = hull[i].distance(center);
        avg += dists[i];
        maxd = std::max(maxd, dists[i]);
    }
    avg /= hull.size();

    // Improved threshold for candidate fingertips: more sensitive to catch all fingers in open palm
    const double dist_threshold = avg + (maxd - avg) * 0.35; // further lowered to 0.35 for maximum sensitivity

    // Helper lambda to compute angle at hull vertex i
    auto angle_at = [&](size_t i) {
        size_t prev = (i + hull.size() - 1) % hull.size();
        size_t next = (i + 1) % hull.size();
        double ax = hull[prev].x - hull[i].x;
        double ay = hull[prev].y - hull[i].y;
        double bx = hull[next].x - hull[i].x;
        double by = hull[next].y - hull[i].y;
        double dot = ax * bx + ay * by;
        double magA = std::sqrt(ax * ax + ay * ay);
        double magB = std::sqrt(bx * bx + by * by);
        if (magA < 1e-3 || magB < 1e-3) return 180.0; // degenerate
        double cosang = std::max(-1.0, std::min(1.0, dot / (magA * magB)));
        return std::acos(cosang) * 180.0 / M_PI;
    };

    std::vector<Point> fingertip_candidates;
    for (size_t i = 0; i < hull.size(); ++i) {
        if (dists[i] < dist_threshold) continue; // not protruding enough
        double angle = angle_at(i);
        // Further relaxed angle threshold to catch more fingertips in various poses (increased to 85)
        if (angle > 85.0) continue;
        fingertip_candidates.push_back(hull[i]);
    }

    // Sort candidates by distance descending
    std::sort(fingertip_candidates.begin(), fingertip_candidates.end(), [&](const Point& a, const Point& b){
        return a.distance(center) > b.distance(center);
    });

    // Non-maximum suppression based on spatial separation
    std::vector<Point> final_tips;
    const double min_sep = std::max(10.0, maxd * 0.14); // further reduced separation for detecting all fingers
    for (const auto& p : fingertip_candidates) {
        bool close = false;
        for (const auto& q : final_tips) {
            if (p.distance(q) < min_sep) { close = true; break; }
        }
        if (!close) final_tips.push_back(p);
        if (final_tips.size() >= 5) break;
    }

    int count = static_cast<int>(final_tips.size());

    // Enhanced heuristic refinement for detecting all fingers in every gesture
    double spread_ratio = maxd / std::max(1.0, avg);
    if (count <= 2 && spread_ratio > 1.45) {
        // Likely open palm with missed fingers - further lowered threshold
        count = std::min(5, count + 2);
    } else if (count == 3 && spread_ratio > 1.55) {
        // Probably missing 1-2 fingers in open palm
        count = std::min(5, count + 1);
    } else if (count == 4 && spread_ratio > 1.65) {
        // Likely all 5 fingers but one was missed
        count = 5;
    } else if (count == 0 && spread_ratio < 1.2) {
        // Very compact, likely fist
        count = 0;
    } else if (count == 1 && spread_ratio > 1.4) {
        // Single detected finger but wide spread suggests more fingers
        count = std::min(5, count + 1);
    }

    return std::min(5, std::max(0, count));
}

std::vector<Point> HandDetector::find_fingertips(const std::vector<Point>& contour, 
                                                 const Point& center) {
    std::vector<Point> tips;
    if (contour.size() < 20) return tips;

    auto hull = compute_convex_hull(contour);
    if (hull.size() < 5) return tips;

    // Reuse angle and distance logic similar to count_fingers but keep actual points
    std::vector<double> dists(hull.size());
    double avg = 0.0, maxd = 0.0;
    for (size_t i = 0; i < hull.size(); ++i) {
        dists[i] = hull[i].distance(center);
        avg += dists[i];
        maxd = std::max(maxd, dists[i]);
    }
    avg /= hull.size();
    const double dist_threshold = avg + (maxd - avg) * 0.35; // match count_fingers improvement

    auto angle_at = [&](size_t i) {
        size_t prev = (i + hull.size() - 1) % hull.size();
        size_t next = (i + 1) % hull.size();
        double ax = hull[prev].x - hull[i].x;
        double ay = hull[prev].y - hull[i].y;
        double bx = hull[next].x - hull[i].x;
        double by = hull[next].y - hull[i].y;
        double dot = ax * bx + ay * by;
        double magA = std::sqrt(ax * ax + ay * ay);
        double magB = std::sqrt(bx * bx + by * by);
        if (magA < 1e-3 || magB < 1e-3) return 180.0; // degenerate
        double cosang = std::max(-1.0, std::min(1.0, dot / (magA * magB)));
        return std::acos(cosang) * 180.0 / M_PI;
    };

    std::vector<Point> candidates;
    for (size_t i = 0; i < hull.size(); ++i) {
        if (dists[i] < dist_threshold) continue;
        double angle = angle_at(i);
        if (angle > 85.0) continue; // match count_fingers improvement
        candidates.push_back(hull[i]);
    }

    std::sort(candidates.begin(), candidates.end(), [&](const Point& a, const Point& b){
        return a.distance(center) > b.distance(center);
    });

    const double min_sep = std::max(10.0, maxd * 0.14); // match count_fingers improvement
    for (const auto& p : candidates) {
        bool close = false;
        for (const auto& q : tips) {
            if (p.distance(q) < min_sep) { close = true; break; }
        }
        if (!close) tips.push_back(p);
        if (tips.size() >= 5) break;
    }
    return tips;
}

Gesture HandDetector::classify_gesture(const HandDetection& hand) {
    // Enhanced gesture classification for classical CV to detect every gesture
    // Focuses on reliable distinctions while being more permissive to catch all poses
    
    const int fingers = hand.num_fingers;
    const float aspect = static_cast<float>(hand.bbox.width) / std::max(1, hand.bbox.height);
    const float area_ratio = static_cast<float>(hand.contour_area) / std::max(1.0f, static_cast<float>(hand.bbox.area()));

    // Calculate hand compactness and shape characteristics
    const bool is_compact = (area_ratio > 0.72f); // slightly lower for more permissive fist detection
    const bool is_square = (aspect >= 0.75f && aspect <= 1.35f); // wider range for varied orientations
    const bool is_elongated = (aspect < 0.6f || aspect > 1.6f); // adjusted for better pointing detection

    // FIST: Low finger count + compact shape (prioritize to avoid misclassification)
    if (fingers == 0 || (fingers == 1 && is_compact && is_square)) {
        return Gesture::FIST;
    }

    // OPEN_PALM: High finger count or spread hand (detect all open palm variations)
    // Enhanced to catch more open palm gestures with different finger counts
    if (fingers >= 4) {
        return Gesture::OPEN_PALM;
    }
    if (fingers == 3 && !is_compact) {
        // 3 fingers with non-compact shape, likely open palm with some occlusion
        return Gesture::OPEN_PALM;
    }
    if (fingers >= 2 && area_ratio < 0.65f && !is_elongated) {
        // 2-3 fingers with low solidity (spread out), likely open palm
        return Gesture::OPEN_PALM;
    }

    // POINTING: One or two fingers with elongated shape (improved detection)
    if (fingers == 1 && (is_elongated || aspect < 0.7f || aspect > 1.5f)) {
        return Gesture::POINTING;
    }
    if (fingers == 2 && hand.fingertips.size() >= 2 && is_elongated) {
        // Two fingertips with elongated shape - check prominence
        double d0 = hand.fingertips[0].distance(hand.center);
        double d1 = hand.fingertips[1].distance(hand.center);
        double hand_size = std::sqrt(hand.bbox.width * hand.bbox.width + hand.bbox.height * hand.bbox.height);
        double dist_ratio = std::max(d0, d1) / std::max(1.0, std::min(d0, d1));
        
        // If one finger is significantly more prominent, classify as pointing
        if (dist_ratio > 1.4 || std::abs(d0 - d1) > hand_size * 0.3) {
            return Gesture::POINTING;
        }
    }

    // PEACE: 2-3 fingers close together, not elongated
    if ((fingers == 2 || fingers == 3) && hand.fingertips.size() >= 2) {
        const double tip_dist = hand.fingertips[0].distance(hand.fingertips[1]);
        const double hand_size = std::sqrt(hand.bbox.width * hand.bbox.width + hand.bbox.height * hand.bbox.height);
        
        // OK sign: two points very close together with compact shape
        if (tip_dist < hand_size * 0.28 && is_compact) {
            return Gesture::OK_SIGN;
        }
        // PEACE: fingertips moderately close, not too elongated
        if (tip_dist < hand_size * 0.65 && !is_elongated && aspect >= 0.6f && aspect <= 1.6f) {
            return Gesture::PEACE;
        }
    }

    // Enhanced fallback logic to classify every hand pose
    if (fingers <= 1) {
        if (is_compact && is_square) {
            return Gesture::FIST;
        } else if (is_elongated || aspect < 0.7f) {
            return Gesture::POINTING;
        } else {
            // Uncertain single finger - default to pointing
            return Gesture::POINTING;
        }
    } else if (fingers == 2) {
        if (is_elongated) {
            return Gesture::POINTING;
        } else if (is_square || (!is_compact && aspect >= 0.7f && aspect <= 1.4f)) {
            return Gesture::PEACE;
        } else {
            // Default 2 fingers to peace
            return Gesture::PEACE;
        }
    } else if (fingers >= 3 || !is_compact) {
        // 3+ fingers or spread hand - open palm
        return Gesture::OPEN_PALM;
    } else {
        // Final fallback based on compactness
        return is_compact ? Gesture::FIST : Gesture::OPEN_PALM;
    }
}

Gesture HandDetector::stabilize_gesture(Gesture current) {
    gesture_history_.push_back(current);
    
    if (gesture_history_.size() > static_cast<size_t>(config_.gesture_history)) {
        gesture_history_.erase(gesture_history_.begin());
    }
    
    // Count occurrences
    int counts[8] = {0};
    for (Gesture g : gesture_history_) {
        counts[static_cast<int>(g)]++;
    }
    
    // Find most common
    int max_count = 0;
    Gesture most_common = Gesture::UNKNOWN;
    for (int i = 0; i < 8; i++) {
        if (counts[i] > max_count) {
            max_count = counts[i];
            most_common = static_cast<Gesture>(i);
        }
    }
    
    return most_common;
}

std::string HandDetector::gesture_to_string(Gesture g) {
    switch (g) {
        case Gesture::OPEN_PALM: return "Open Palm";
        case Gesture::FIST: return "Fist";
        case Gesture::POINTING: return "Pointing";
        case Gesture::THUMBS_UP: return "Thumbs Up";
        case Gesture::PEACE: return "Peace";
        case Gesture::OK_SIGN: return "OK Sign";
        case Gesture::CUSTOM: return "Custom";
        default: return "Unknown";
    }
}

Gesture HandDetector::string_to_gesture(const std::string& s) {
    if (s == "Open Palm") return Gesture::OPEN_PALM;
    if (s == "Fist") return Gesture::FIST;
    if (s == "Pointing") return Gesture::POINTING;
    if (s == "Thumbs Up") return Gesture::THUMBS_UP;
    if (s == "Peace") return Gesture::PEACE;
    if (s == "OK Sign") return Gesture::OK_SIGN;
    if (s == "Custom") return Gesture::CUSTOM;
    return Gesture::UNKNOWN;
}

// Utility functions for visualization
namespace utils {

void draw_box(uint8_t* rgb, uint32_t width, uint32_t height,
             const BoundingBox& box, 
             uint8_t r, uint8_t g, uint8_t b) {
    // Draw rectangle
    for (int x = box.x; x < box.x + box.width && x < (int)width; x++) {
        for (int t = 0; t < 2; t++) { // Thickness
            if (box.y + t < (int)height) {
                size_t idx = ((box.y + t) * width + x) * 3;
                rgb[idx] = r; rgb[idx+1] = g; rgb[idx+2] = b;
            }
            if (box.y + box.height - 1 - t >= 0 && box.y + box.height - 1 - t < (int)height) {
                size_t idx = ((box.y + box.height - 1 - t) * width + x) * 3;
                rgb[idx] = r; rgb[idx+1] = g; rgb[idx+2] = b;
            }
        }
    }
    
    for (int y = box.y; y < box.y + box.height && y < (int)height; y++) {
        for (int t = 0; t < 2; t++) { // Thickness
            if (box.x + t < (int)width) {
                size_t idx = (y * width + box.x + t) * 3;
                rgb[idx] = r; rgb[idx+1] = g; rgb[idx+2] = b;
            }
            if (box.x + box.width - 1 - t >= 0 && box.x + box.width - 1 - t < (int)width) {
                size_t idx = (y * width + box.x + box.width - 1 - t) * 3;
                rgb[idx] = r; rgb[idx+1] = g; rgb[idx+2] = b;
            }
        }
    }
}

void draw_point(uint8_t* rgb, uint32_t width, uint32_t height,
               const Point& point, int radius,
               uint8_t r, uint8_t g, uint8_t b) {
    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            if (dx*dx + dy*dy <= radius*radius) {
                int x = point.x + dx;
                int y = point.y + dy;
                if (x >= 0 && x < (int)width && y >= 0 && y < (int)height) {
                    size_t idx = (y * width + x) * 3;
                    rgb[idx] = r;
                    rgb[idx+1] = g;
                    rgb[idx+2] = b;
                }
            }
        }
    }
}

void draw_contour(uint8_t* rgb, uint32_t width, uint32_t height,
                 const std::vector<Point>& contour,
                 uint8_t r, uint8_t g, uint8_t b) {
    for (const auto& pt : contour) {
        if (pt.x >= 0 && pt.x < (int)width && pt.y >= 0 && pt.y < (int)height) {
            size_t idx = (pt.y * width + pt.x) * 3;
            rgb[idx] = r;
            rgb[idx+1] = g;
            rgb[idx+2] = b;
        }
    }
}

void draw_text(uint8_t* rgb, uint32_t width, uint32_t height,
              const std::string& text, int x, int y,
              uint8_t r, uint8_t g, uint8_t b) {
    // Simple 5x7 bitmap font for numbers and basic letters
    // For production, use a proper font rendering library
    
    int char_width = 6;
    int char_height = 8;
    int cursor_x = x;
    
    for (size_t i = 0; i < text.length(); i++) {
        if (cursor_x + char_width >= (int)width) break;
        
        // Draw character placeholder (simple vertical line for demo)
        for (int py = 0; py < char_height && y + py < (int)height; py++) {
            if (cursor_x >= 0 && cursor_x < (int)width && y + py >= 0) {
                size_t idx = ((y + py) * width + cursor_x) * 3;
                rgb[idx] = r;
                rgb[idx+1] = g;
                rgb[idx+2] = b;
            }
        }
        
        cursor_x += char_width;
    }
}

} // namespace utils

} // namespace hand_detector
