#include "hand_detector.hpp"
#include "hand_detector_config.hpp"
#include "hand_detector_simd.hpp"
#include <cmath>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <iostream>
#include <queue>

namespace hand_detector
{

    // Point methods
    double Point::distance(const Point &other) const
    {
        const double dx = x - other.x;
        const double dy = y - other.y;
        return std::sqrt(dx * dx + dy * dy);
    }

    // HandDetector implementation
    HandDetector::HandDetector() : config_()
    {
        reset_stats();
    }

    HandDetector::HandDetector(const DetectorConfig &config) : config_(config)
    {
        reset_stats();
    }

    HandDetector::~HandDetector() {}

    bool HandDetector::init(const DetectorConfig &config)
    {
        config_ = config;
        reset_stats();

        // Validate configuration
        if (!config_.validate())
        {
            std::cerr << "[HandDetector] ERROR: Invalid configuration\n";
            return false;
        }

        if (config_.verbose)
        {
            std::cerr << "[HandDetector] Initialized\n";
            std::cerr << "  Skin HSV range: H[" << config_.hue_min << "-" << config_.hue_max
                      << "] S[" << config_.sat_min << "-" << config_.sat_max
                      << "] V[" << config_.val_min << "-" << config_.val_max << "]\n";
            std::cerr << "  SIMD support: " << (simd::is_neon_available() ? "NEON" : "Scalar") << "\n";
        }

        return true;
    }

    void HandDetector::set_config(const DetectorConfig &config)
    {
        config_ = config;
    }

    void HandDetector::reset_stats()
    {
        stats_.reset();
        gesture_history_.clear();
        tracked_hands_.clear();
        current_frame_ = 0;
    }

    std::vector<HandDetection> HandDetector::detect(const camera::Frame &frame)
    {
        auto start_time = std::chrono::steady_clock::now();

        std::vector<HandDetection> detections;

        if (!frame.data || frame.width == 0 || frame.height == 0)
        {
            return detections;
        }

        current_frame_++;
        stats_.frames_processed++; // Count frame immediately

        const uint32_t work_width = frame.width / config_.downscale_factor;
        const uint32_t work_height = frame.height / config_.downscale_factor;
        const size_t pixel_count = work_width * work_height;

        // Ensure buffers are allocated (reuse across frames)
        if (hsv_buffer_.size() < pixel_count * 3)
        {
            hsv_buffer_.resize(pixel_count * 3);
            mask_buffer_.resize(pixel_count);
            temp_buffer_.resize(pixel_count * 3);
        }

        auto stage_start = std::chrono::steady_clock::now();

        // Step 1: Convert RGB to HSV (with SIMD if available)
        if (frame.format == camera::PixelFormat::RGB888)
        {
            if (config_.downscale_factor > 1)
            {
                camera::utils::resize_nearest(frame.data, temp_buffer_.data(),
                                              frame.width, frame.height,
                                              work_width, work_height, 3);
                if (config_.enable_simd && simd::is_neon_available())
                {
                    simd::convert_rgb_to_hsv_simd(temp_buffer_.data(), hsv_buffer_.data(), pixel_count);
                }
                else
                {
                    simd::scalar::convert_rgb_to_hsv(temp_buffer_.data(), hsv_buffer_.data(), pixel_count);
                }
            }
            else
            {
                if (config_.enable_simd && simd::is_neon_available())
                {
                    simd::convert_rgb_to_hsv_simd(frame.data, hsv_buffer_.data(), pixel_count);
                }
                else
                {
                    simd::scalar::convert_rgb_to_hsv(frame.data, hsv_buffer_.data(), pixel_count);
                }
            }
        }
        else
        {
            return detections; // Unsupported format
        }

        auto stage_end = std::chrono::steady_clock::now();
        stats_.conversion_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();

        // Step 2: Apply skin color mask (with SIMD)
        stage_start = std::chrono::steady_clock::now();
        if (config_.enable_simd && simd::is_neon_available())
        {
            simd::create_skin_mask_simd(hsv_buffer_.data(), mask_buffer_.data(), pixel_count,
                                        config_.hue_min, config_.hue_max,
                                        config_.sat_min, config_.sat_max,
                                        config_.val_min, config_.val_max);
        }
        else
        {
            simd::scalar::create_skin_mask(hsv_buffer_.data(), mask_buffer_.data(), pixel_count,
                                           config_.hue_min, config_.hue_max,
                                           config_.sat_min, config_.sat_max,
                                           config_.val_min, config_.val_max);
        }
        stage_end = std::chrono::steady_clock::now();
        stats_.masking_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();

        // Quick check: if very few skin pixels detected, skip contour finding
        uint32_t skin_pixel_count = 0;
        for (size_t i = 0; i < pixel_count; ++i)
        {
            if (mask_buffer_[i] > 0)
                skin_pixel_count++;
        }

        // If less than min_hand_area pixels are skin-colored, likely no hand present
        // More strict threshold to reduce false positives
        if (skin_pixel_count < static_cast<uint32_t>(config_.min_hand_area))
        {
            return detections; // Early exit - no hand possible
        }

        // Additional check: if too many skin pixels (>70% of frame), likely false positive
        const float skin_ratio = static_cast<float>(skin_pixel_count) / pixel_count;
        if (skin_ratio > 0.70f)
        {
            if (config_.verbose)
            {
                std::cerr << "[HandDetector] Too many skin pixels (" << (skin_ratio * 100)
                          << "%) - likely false positive\n";
            }
            return detections; // Probably not a hand, maybe background/lighting issue
        }

        // Step 3: Morphological operations
        if (config_.enable_morphology)
        {
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

        for (size_t c = 0; c < max_contours_to_check; ++c)
        {
            const auto &contour = contours[c];

            // Calculate actual contour area using shoelace formula (polygon area)
            double polygon_area = 0.0;
            for (size_t i = 0; i < contour.size(); i++)
            {
                size_t j = (i + 1) % contour.size();
                polygon_area += contour[i].x * contour[j].y;
                polygon_area -= contour[j].x * contour[i].y;
            }
            polygon_area = std::abs(polygon_area) / 2.0;

            // Filter by actual area (not just point count)
            if (polygon_area < config_.min_hand_area || polygon_area > config_.max_hand_area)
            {
                continue;
            }

            HandDetection hand = analyze_contour(contour, work_width, work_height);

            // Additional validation: check if contour is hand-like before accepting
            // Hand should have reasonable solidity (area/bounding_box_area ratio)
            const float bbox_area = static_cast<float>(hand.bbox.area());
            const float solidity = bbox_area > 0 ? static_cast<float>(polygon_area) / bbox_area : 0.0f;

            // Hand solidity typically 0.45-0.85 (stricter range to reduce false positives)
            if (solidity < 0.45f || solidity > 0.85f)
            {
                if (config_.verbose)
                {
                    std::cerr << "[HandDetector] Rejected: solidity=" << solidity << " (expected 0.45-0.85)\n";
                }
                continue;
            }

            // Check aspect ratio is reasonable for a hand (not too elongated or square)
            const float aspect_ratio = static_cast<float>(hand.bbox.width) / std::max(1, hand.bbox.height);
            if (aspect_ratio < 0.3f || aspect_ratio > 3.0f)
            {
                if (config_.verbose)
                {
                    std::cerr << "[HandDetector] Rejected: aspect_ratio=" << aspect_ratio << " (expected 0.3-3.0)\n";
                }
                continue;
            }

            // Store actual area
            hand.contour_area = static_cast<uint32_t>(polygon_area);

            // Scale back to original resolution
            if (config_.downscale_factor > 1)
            {
                hand.bbox.x *= config_.downscale_factor;
                hand.bbox.y *= config_.downscale_factor;
                hand.bbox.width *= config_.downscale_factor;
                hand.bbox.height *= config_.downscale_factor;
                hand.center.x *= config_.downscale_factor;
                hand.center.y *= config_.downscale_factor;

                for (auto &pt : hand.contour)
                {
                    pt.x *= config_.downscale_factor;
                    pt.y *= config_.downscale_factor;
                }
                for (auto &pt : hand.fingertips)
                {
                    pt.x *= config_.downscale_factor;
                    pt.y *= config_.downscale_factor;
                }
            }

            // Gesture recognition
            if (config_.enable_gesture && hand.bbox.confidence >= config_.min_confidence)
            {
                hand.gesture = classify_gesture(hand);
                hand.gesture = stabilize_gesture(hand.gesture);
            }

            if (config_.verbose)
            {
                std::cerr << "[Hand] Area:" << polygon_area
                          << " Solidity:" << solidity
                          << " Fingers:" << hand.num_fingers
                          << " Conf:" << hand.bbox.confidence
                          << " Gesture:" << gesture_to_string(hand.gesture) << "\n";
            }

            // Temporal filtering: only accept detections that are stable
            if (config_.enable_tracking && hand.bbox.confidence >= config_.min_confidence)
            {
                bool matched_existing = false;

                // Try to match with existing tracked hands using IOU
                for (auto &tracked : tracked_hands_)
                {
                    float iou = compute_iou(hand.bbox, tracked.last_bbox);

                    if (iou >= config_.tracking_iou_threshold)
                    {
                        // Matched with existing track
                        tracked.consecutive_frames++;
                        tracked.last_bbox = hand.bbox;
                        tracked.last_seen_frame = current_frame_;
                        tracked.avg_confidence = (tracked.avg_confidence * 0.7f + hand.bbox.confidence * 0.3f);

                        // Only output if confirmed over multiple frames
                        if (tracked.consecutive_frames >= config_.temporal_filter_frames)
                        {
                            hand.bbox.confidence = tracked.avg_confidence;
                            detections.push_back(hand);
                        }
                        matched_existing = true;
                        break;
                    }
                }

                // New detection - start tracking
                if (!matched_existing)
                {
                    TrackedHand new_track;
                    new_track.last_bbox = hand.bbox;
                    new_track.consecutive_frames = 1;
                    new_track.last_seen_frame = current_frame_;
                    new_track.avg_confidence = hand.bbox.confidence;
                    tracked_hands_.push_back(new_track);

                    // Only output immediately if confidence is very high
                    if (hand.bbox.confidence >= 0.85f)
                    {
                        detections.push_back(hand);
                    }
                }
            }
            else if (hand.bbox.confidence >= config_.min_confidence)
            {
                // Tracking disabled - add directly
                detections.push_back(hand);
            }
        }

        // Remove stale tracks (not seen for 30 frames)
        tracked_hands_.erase(
            std::remove_if(tracked_hands_.begin(), tracked_hands_.end(),
                           [this](const TrackedHand &t)
                           { return (current_frame_ - t.last_seen_frame) > 30; }),
            tracked_hands_.end());
        stage_end = std::chrono::steady_clock::now();
        stats_.analysis_ms = std::chrono::duration<double, std::milli>(stage_end - stage_start).count();

        // Update statistics (frames_processed already incremented at start)
        stats_.hands_detected += detections.size();
        stats_.last_detection_timestamp = frame.timestamp_ns;

        auto end_time = std::chrono::steady_clock::now();
        const double process_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();

        // Running average
        stats_.avg_process_time_ms =
            (stats_.avg_process_time_ms * (stats_.frames_processed - 1) + process_time) /
            stats_.frames_processed;

        if (config_.verbose && !detections.empty())
        {
            std::cerr << "[HandDetector] Detected " << detections.size() << " hand(s) in "
                      << process_time << " ms (HSV:" << stats_.conversion_ms
                      << " Mask:" << stats_.masking_ms
                      << " Morph:" << stats_.morphology_ms
                      << " Cont:" << stats_.contours_ms
                      << " Anal:" << stats_.analysis_ms << ")\n";
        }

        return detections;
    }

    bool HandDetector::calibrate_skin(const camera::Frame &frame,
                                      int roi_x, int roi_y,
                                      int roi_w, int roi_h)
    {
        if (!frame.data || frame.format != camera::PixelFormat::RGB888)
        {
            return false;
        }

        // Sample pixels in ROI and compute HSV statistics
        int h_min = 180, h_max = 0;
        int s_min = 255, s_max = 0;
        int v_min = 255, v_max = 0;

        int sample_count = 0;

        for (int y = roi_y; y < roi_y + roi_h && y < (int)frame.height; y++)
        {
            for (int x = roi_x; x < roi_x + roi_w && x < (int)frame.width; x++)
            {
                uint8_t r, g, b;
                if (!frame.get_rgb(x, y, r, g, b))
                    continue;

                // Convert RGB to HSV
                float rf = r / 255.0f;
                float gf = g / 255.0f;
                float bf = b / 255.0f;

                float cmax = std::max({rf, gf, bf});
                float cmin = std::min({rf, gf, bf});
                float delta = cmax - cmin;

                // Hue
                float h = 0;
                if (delta > 0)
                {
                    if (cmax == rf)
                        h = 60 * std::fmod((gf - bf) / delta, 6.0f);
                    else if (cmax == gf)
                        h = 60 * ((bf - rf) / delta + 2);
                    else
                        h = 60 * ((rf - gf) / delta + 4);
                }
                if (h < 0)
                    h += 360;

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

        if (sample_count == 0)
            return false;

        // Add some tolerance
        config_.hue_min = std::max(0, h_min - 10);
        config_.hue_max = std::min(179, h_max + 10);
        config_.sat_min = std::max(0, s_min - 30);
        config_.sat_max = std::min(255, s_max + 30);
        config_.val_min = std::max(0, v_min - 30);
        config_.val_max = std::min(255, v_max + 30);

        if (config_.verbose)
        {
            std::cerr << "[HandDetector] Calibrated skin: H[" << config_.hue_min
                      << "-" << config_.hue_max << "] S[" << config_.sat_min
                      << "-" << config_.sat_max << "] V[" << config_.val_min
                      << "-" << config_.val_max << "]\n";
        }

        return true;
    }

    // Internal processing functions - removed, now using SIMD versions

    void HandDetector::morphological_operations(uint8_t *mask,
                                                uint32_t width, uint32_t height)
    {
        // Enhanced morphological operations: erosion then dilation (opening) to remove noise
        // Then dilation followed by erosion (closing) to fill holes
        std::vector<uint8_t> temp(width * height);

        // Opening: Erosion (3x3 kernel) - removes small white noise
        for (uint32_t y = 1; y < height - 1; y++)
        {
            for (uint32_t x = 1; x < width - 1; x++)
            {
                uint8_t min_val = 255;
                for (int ky = -1; ky <= 1; ky++)
                {
                    for (int kx = -1; kx <= 1; kx++)
                    {
                        min_val = std::min(min_val, mask[(y + ky) * width + (x + kx)]);
                    }
                }
                temp[y * width + x] = min_val;
            }
        }

        // Dilation (3x3 kernel)
        std::memcpy(mask, temp.data(), width * height);
        for (uint32_t y = 1; y < height - 1; y++)
        {
            for (uint32_t x = 1; x < width - 1; x++)
            {
                uint8_t max_val = 0;
                for (int ky = -1; ky <= 1; ky++)
                {
                    for (int kx = -1; kx <= 1; kx++)
                    {
                        max_val = std::max(max_val, mask[(y + ky) * width + (x + kx)]);
                    }
                }
                temp[y * width + x] = max_val;
            }
        }

        // Closing: Dilation first
        std::memcpy(mask, temp.data(), width * height);
        for (uint32_t y = 1; y < height - 1; y++)
        {
            for (uint32_t x = 1; x < width - 1; x++)
            {
                uint8_t max_val = 0;
                for (int ky = -1; ky <= 1; ky++)
                {
                    for (int kx = -1; kx <= 1; kx++)
                    {
                        max_val = std::max(max_val, mask[(y + ky) * width + (x + kx)]);
                    }
                }
                temp[y * width + x] = max_val;
            }
        }

        // Then Erosion
        for (uint32_t y = 1; y < height - 1; y++)
        {
            for (uint32_t x = 1; x < width - 1; x++)
            {
                uint8_t min_val = 255;
                for (int ky = -1; ky <= 1; ky++)
                {
                    for (int kx = -1; kx <= 1; kx++)
                    {
                        min_val = std::min(min_val, temp[(y + ky) * width + (x + kx)]);
                    }
                }
                mask[y * width + x] = min_val;
            }
        }
    }

    std::vector<std::vector<Point>> HandDetector::find_contours(const uint8_t *mask,
                                                                uint32_t width, uint32_t height)
    {
        std::vector<std::vector<Point>> contours;
        std::vector<bool> visited(width * height, false);

        // Simple flood-fill based contour detection
        for (uint32_t y = 0; y < height; y++)
        {
            for (uint32_t x = 0; x < width; x++)
            {
                size_t idx = y * width + x;

                if (mask[idx] > 0 && !visited[idx])
                {
                    std::vector<Point> contour;
                    std::queue<Point> queue;
                    queue.push(Point(x, y));
                    visited[idx] = true;

                    while (!queue.empty())
                    {
                        Point p = queue.front();
                        queue.pop();
                        contour.push_back(p);

                        // Check 8-connected neighbors
                        for (int dy = -1; dy <= 1; dy++)
                        {
                            for (int dx = -1; dx <= 1; dx++)
                            {
                                if (dx == 0 && dy == 0)
                                    continue;

                                int nx = p.x + dx;
                                int ny = p.y + dy;

                                if (nx >= 0 && nx < (int)width && ny >= 0 && ny < (int)height)
                                {
                                    size_t nidx = ny * width + nx;
                                    if (mask[nidx] > 0 && !visited[nidx])
                                    {
                                        visited[nidx] = true;
                                        queue.push(Point(nx, ny));
                                    }
                                }
                            }
                        }
                    }

                    // Only keep contours with minimum point count (filter noise early)
                    // A hand should have at least 30 perimeter points even when downscaled
                    if (contour.size() >= 30)
                    {
                        contours.push_back(contour);
                    }
                }
            }
        }

        // Sort contours by size (largest first) to prioritize main hand blob
        std::sort(contours.begin(), contours.end(),
                  [](const std::vector<Point> &a, const std::vector<Point> &b)
                  {
                      return a.size() > b.size();
                  });

        return contours;
    }

    HandDetection HandDetector::analyze_contour(const std::vector<Point> &contour,
                                                uint32_t frame_width, uint32_t frame_height)
    {
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
        for (size_t i = 0; i < contour.size(); i += step)
        {
            hand.contour.push_back(contour[i]);
        }

        // Compute confidence based on shape properties
        const float area_ratio = static_cast<float>(hand.bbox.area()) / (frame_width * frame_height);
        const float aspect_ratio = static_cast<float>(hand.bbox.width) / std::max(1, hand.bbox.height);

        // Start with moderate base confidence
        hand.bbox.confidence = 0.50f;

        // Hand-like properties (stricter validation for better precision)
        // 1. Area should be reasonable (2-40% of frame) - stricter range
        if (area_ratio >= 0.02f && area_ratio <= 0.40f)
        {
            hand.bbox.confidence += 0.20f;
        }
        else if (area_ratio < 0.01f || area_ratio > 0.60f)
        {
            hand.bbox.confidence *= 0.3f; // Strong penalty for extreme sizes
        }
        else
        {
            hand.bbox.confidence *= 0.6f; // Moderate penalty
        }

        // 2. Aspect ratio should be reasonable (hands vary from 0.6 to 1.7) - stricter
        if (aspect_ratio >= 0.6f && aspect_ratio <= 1.7f)
        {
            hand.bbox.confidence += 0.20f;
        }
        else
        {
            hand.bbox.confidence *= 0.5f;
        }

        // 3. Finger count validation (algorithm provides useful signal)
        if (hand.num_fingers >= 0 && hand.num_fingers <= 5)
        {
            hand.bbox.confidence += 0.05f;
            // Bonus for very likely finger counts (0, 1, or 5)
            if (hand.num_fingers == 0 || hand.num_fingers == 1 || hand.num_fingers == 5)
            {
                hand.bbox.confidence += 0.05f;
            }
        }
        else if (hand.num_fingers > 5)
        {
            hand.bbox.confidence *= 0.4f; // Penalize impossible counts
        }

        // 4. Having reasonable number of fingertips is a good sign
        if (hand.fingertips.size() >= 1 && hand.fingertips.size() <= 5)
        {
            hand.bbox.confidence += 0.10f;
            // Bonus if fingertips match finger count roughly
            if (std::abs(static_cast<int>(hand.fingertips.size()) - hand.num_fingers) <= 1)
            {
                hand.bbox.confidence += 0.05f;
            }
        }
        else if (hand.fingertips.size() > 6)
        {
            hand.bbox.confidence *= 0.5f;
        }

        // Clamp confidence to [0, 1]
        hand.bbox.confidence = std::min(1.0f, std::max(0.0f, hand.bbox.confidence));

        hand.gesture_confidence = hand.bbox.confidence;

        return hand;
    }

    BoundingBox HandDetector::compute_bounding_box(const std::vector<Point> &contour)
    {
        BoundingBox box;

        if (contour.empty())
            return box;

        int min_x = contour[0].x, max_x = contour[0].x;
        int min_y = contour[0].y, max_y = contour[0].y;

        for (const auto &pt : contour)
        {
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

    Point HandDetector::compute_centroid(const std::vector<Point> &contour)
    {
        if (contour.empty())
            return Point(0, 0);

        long long sum_x = 0, sum_y = 0;
        for (const auto &pt : contour)
        {
            sum_x += pt.x;
            sum_y += pt.y;
        }

        return Point(sum_x / contour.size(), sum_y / contour.size());
    }

    // Convex hull via monotonic chain (returns hull in CCW order without duplicate last point)
    std::vector<Point> HandDetector::compute_convex_hull(const std::vector<Point> &points)
    {
        std::vector<Point> pts = points;
        if (pts.size() < 3)
            return pts;

        std::sort(pts.begin(), pts.end(), [](const Point &a, const Point &b)
                  {
        if (a.x == b.x) return a.y < b.y;
        return a.x < b.x; });
        pts.erase(std::unique(pts.begin(), pts.end(), [](const Point &a, const Point &b)
                              { return a.x == b.x && a.y == b.y; }),
                  pts.end());
        if (pts.size() < 3)
            return pts;

        auto cross = [](const Point &O, const Point &A, const Point &B)
        {
            long long dx1 = A.x - O.x;
            long long dy1 = A.y - O.y;
            long long dx2 = B.x - O.x;
            long long dy2 = B.y - O.y;
            return dx1 * dy2 - dy1 * dx2; // z-component of cross product
        };

        std::vector<Point> lower;
        lower.reserve(pts.size());
        for (const auto &p : pts)
        {
            while (lower.size() >= 2 && cross(lower[lower.size() - 2], lower.back(), p) <= 0)
            {
                lower.pop_back();
            }
            lower.push_back(p);
        }

        std::vector<Point> upper;
        upper.reserve(pts.size());
        for (auto it = pts.rbegin(); it != pts.rend(); ++it)
        {
            while (upper.size() >= 2 && cross(upper[upper.size() - 2], upper.back(), *it) <= 0)
            {
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

    int HandDetector::count_fingers(const std::vector<Point> &contour, const Point &center)
    {
        // Convex-hull based finger counting: more stable across poses
        if (contour.size() < 15)
            return 0;

        auto hull = compute_convex_hull(contour);
        if (hull.size() < 5)
            return 0; // not enough structure

        // Compute distances of hull vertices from center
        std::vector<double> dists(hull.size());
        double avg = 0.0, maxd = 0.0;
        for (size_t i = 0; i < hull.size(); ++i)
        {
            dists[i] = hull[i].distance(center);
            avg += dists[i];
            maxd = std::max(maxd, dists[i]);
        }
        avg /= hull.size();

        // Improved threshold for candidate fingertips: more sensitive to catch open palm
        const double dist_threshold = avg + (maxd - avg) * 0.35; // lowered from 0.40 for better open palm detection

        // Helper lambda to compute angle at hull vertex i
        auto angle_at = [&](size_t i)
        {
            size_t prev = (i + hull.size() - 1) % hull.size();
            size_t next = (i + 1) % hull.size();
            double ax = hull[prev].x - hull[i].x;
            double ay = hull[prev].y - hull[i].y;
            double bx = hull[next].x - hull[i].x;
            double by = hull[next].y - hull[i].y;
            double dot = ax * bx + ay * by;
            double magA = std::sqrt(ax * ax + ay * ay);
            double magB = std::sqrt(bx * bx + by * by);
            if (magA < 1e-3 || magB < 1e-3)
                return 180.0; // degenerate
            double cosang = std::max(-1.0, std::min(1.0, dot / (magA * magB)));
            return std::acos(cosang) * 180.0 / M_PI;
        };

        std::vector<Point> fingertip_candidates;
        for (size_t i = 0; i < hull.size(); ++i)
        {
            if (dists[i] < dist_threshold)
                continue; // not protruding enough
            double angle = angle_at(i);
            // Relaxed angle threshold to catch tight finger clusters in open palm (increased to 90°)
            if (angle > 90.0)
                continue;
            fingertip_candidates.push_back(hull[i]);
        }

        // Sort candidates by distance descending
        std::sort(fingertip_candidates.begin(), fingertip_candidates.end(), [&](const Point &a, const Point &b)
                  { return a.distance(center) > b.distance(center); });

        // Non-maximum suppression based on spatial separation
        std::vector<Point> final_tips;
        const double min_sep = std::max(12.0, maxd * 0.14); // reduced from 0.16 to allow closer fingers in open palm
        for (const auto &p : fingertip_candidates)
        {
            bool close = false;
            for (const auto &q : final_tips)
            {
                if (p.distance(q) < min_sep)
                {
                    close = true;
                    break;
                }
            }
            if (!close)
                final_tips.push_back(p);
            if (final_tips.size() >= 5)
                break;
        }

        // Fingertip clustering: merge tightly clustered tips (< 25px) for pointing detection
        const double cluster_threshold = 25.0;
        std::vector<Point> merged_tips;
        std::vector<bool> used(final_tips.size(), false);

        for (size_t i = 0; i < final_tips.size(); ++i)
        {
            if (used[i])
                continue;

            Point cluster_center = final_tips[i];
            int cluster_count = 1;
            used[i] = true;

            for (size_t j = i + 1; j < final_tips.size(); ++j)
            {
                if (used[j])
                    continue;
                if (final_tips[i].distance(final_tips[j]) < cluster_threshold)
                {
                    cluster_center.x += final_tips[j].x;
                    cluster_center.y += final_tips[j].y;
                    cluster_count++;
                    used[j] = true;
                }
            }

            cluster_center.x /= cluster_count;
            cluster_center.y /= cluster_count;
            merged_tips.push_back(cluster_center);
        }

        final_tips = merged_tips;

        int count = static_cast<int>(final_tips.size());

        // Fingertip hierarchy: if one fingertip is significantly longer than others, it's likely pointing
        if (count >= 2)
        {
            std::vector<double> tip_dists;
            for (const auto &tip : final_tips)
            {
                tip_dists.push_back(tip.distance(center));
            }
            std::sort(tip_dists.rbegin(), tip_dists.rend()); // descending

            // If longest fingertip is 1.8x longer than second longest, treat as pointing (count = 1)
            if (tip_dists[0] > tip_dists[1] * 1.8)
            {
                count = 1;
            }
        }

        // Improved heuristic refinement for better open palm detection
        double spread_ratio = maxd / std::max(1.0, avg);
        if (count <= 2 && spread_ratio > 1.50)
        {
            // Likely open palm miscount - lowered threshold from 1.55 to 1.50
            count = std::min(5, count + 2);
        }
        else if (count == 3 && spread_ratio > 1.60)
        {
            // Might be missing some fingers in open palm
            count = std::min(5, count + 1);
        }
        else if (count == 0 && spread_ratio < 1.2)
        {
            // Very compact, likely fist
            count = 0;
        }

        return std::min(5, std::max(0, count));
    }

    std::vector<Point> HandDetector::find_fingertips(const std::vector<Point> &contour,
                                                     const Point &center)
    {
        std::vector<Point> tips;
        if (contour.size() < 20)
            return tips;

        auto hull = compute_convex_hull(contour);
        if (hull.size() < 5)
            return tips;

        // Reuse angle and distance logic similar to count_fingers but keep actual points
        std::vector<double> dists(hull.size());
        double avg = 0.0, maxd = 0.0;
        for (size_t i = 0; i < hull.size(); ++i)
        {
            dists[i] = hull[i].distance(center);
            avg += dists[i];
            maxd = std::max(maxd, dists[i]);
        }
        avg /= hull.size();
        const double dist_threshold = avg + (maxd - avg) * 0.35; // match count_fingers improvement

        auto angle_at = [&](size_t i)
        {
            size_t prev = (i + hull.size() - 1) % hull.size();
            size_t next = (i + 1) % hull.size();
            double ax = hull[prev].x - hull[i].x;
            double ay = hull[prev].y - hull[i].y;
            double bx = hull[next].x - hull[i].x;
            double by = hull[next].y - hull[i].y;
            double dot = ax * bx + ay * by;
            double magA = std::sqrt(ax * ax + ay * ay);
            double magB = std::sqrt(bx * bx + by * by);
            if (magA < 1e-3 || magB < 1e-3)
                return 180.0; // degenerate
            double cosang = std::max(-1.0, std::min(1.0, dot / (magA * magB)));
            return std::acos(cosang) * 180.0 / M_PI;
        };

        std::vector<Point> candidates;
        for (size_t i = 0; i < hull.size(); ++i)
        {
            if (dists[i] < dist_threshold)
                continue;
            double angle = angle_at(i);
            if (angle > 90.0)
                continue; // match count_fingers improvement
            candidates.push_back(hull[i]);
        }

        std::sort(candidates.begin(), candidates.end(), [&](const Point &a, const Point &b)
                  { return a.distance(center) > b.distance(center); });

        const double min_sep = std::max(12.0, maxd * 0.14); // match count_fingers improvement
        for (const auto &p : candidates)
        {
            bool close = false;
            for (const auto &q : tips)
            {
                if (p.distance(q) < min_sep)
                {
                    close = true;
                    break;
                }
            }
            if (!close)
                tips.push_back(p);
            if (tips.size() >= 5)
                break;
        }
        return tips;
    }

    Gesture HandDetector::classify_gesture(const HandDetection &hand)
    {
        // Improved gesture classification: prioritize shape metrics over finger count
        // This avoids misclassification from finger counting errors

        const int fingers = hand.num_fingers;
        const float aspect = static_cast<float>(hand.bbox.width) / std::max(1, hand.bbox.height);
        const float area_ratio = static_cast<float>(hand.contour_area) / std::max(1.0f, static_cast<float>(hand.bbox.area()));

        // Shape characteristics (prioritized over finger count)
        const bool is_compact = (area_ratio > 0.70f); // Raised from 0.65 for stricter fist detection
        const bool is_spread = (area_ratio < 0.60f);  // New: very spread hand for open palm
        const bool is_square = (aspect >= 0.85f && aspect <= 1.2f);
        const bool is_elongated = (aspect < 0.55f || aspect > 1.7f); // Adjusted thresholds for better pointing
        const bool is_moderately_elongated = (aspect < 0.65f || aspect > 1.55f);

        // PRIORITY 1: Strong shape indicators (most reliable)

        // POINTING: Elongated shape is primary indicator
        if (is_elongated)
        {
            // Very elongated = pointing, regardless of finger count issues
            if (fingers <= 2)
            {
                return Gesture::POINTING;
            }
            // If elongated but many fingers, check fingertip hierarchy
            if (hand.fingertips.size() >= 2)
            {
                double max_dist = 0.0, second_max_dist = 0.0;
                for (const auto &tip : hand.fingertips)
                {
                    double d = tip.distance(hand.center);
                    if (d > max_dist)
                    {
                        second_max_dist = max_dist;
                        max_dist = d;
                    }
                    else if (d > second_max_dist)
                    {
                        second_max_dist = d;
                    }
                }
                // If one fingertip is 2x farther, it's pointing
                if (max_dist > second_max_dist * 2.0)
                {
                    return Gesture::POINTING;
                }
            }
        }

        // FIST: Compact + square shape
        if (is_compact && is_square && fingers <= 1)
        {
            return Gesture::FIST;
        }

        // OPEN_PALM: Very spread hand (primary indicator)
        if (is_spread)
        {
            return Gesture::OPEN_PALM;
        }

        // PRIORITY 2: Finger count with confidence weighting

        // OPEN_PALM: 4+ fingers OR 3 fingers with spread hand
        if (fingers >= 4)
        {
            return Gesture::OPEN_PALM;
        }
        if (fingers == 3 && area_ratio < 0.65f)
        {
            // 3 fingers but very spread = likely open palm with miscounting
            return Gesture::OPEN_PALM;
        }
        if (fingers == 3 && !is_compact && !is_elongated)
        {
            // 3 fingers, medium spread, moderate shape = open palm
            return Gesture::OPEN_PALM;
        }

        // POINTING: 1 finger with moderate elongation
        if (fingers == 1)
        {
            if (is_moderately_elongated || !is_square)
            {
                return Gesture::POINTING;
            }
        }

        // POINTING: 2 fingers but one is significantly more prominent
        if (fingers == 2 && hand.fingertips.size() >= 2)
        {
            double d0 = hand.fingertips[0].distance(hand.center);
            double d1 = hand.fingertips[1].distance(hand.center);
            double dist_ratio = std::max(d0, d1) / std::max(1.0, std::min(d0, d1));

            // If one fingertip is 2x farther than other, it's pointing (not peace)
            if (dist_ratio > 2.0)
            {
                return Gesture::POINTING;
            }

            // Check if elongated with close fingertips
            if (is_moderately_elongated)
            {
                double hand_size = std::sqrt(hand.bbox.width * hand.bbox.width + hand.bbox.height * hand.bbox.height);
                if (dist_ratio > 1.5 || std::abs(d0 - d1) > hand_size * 0.35)
                {
                    return Gesture::POINTING;
                }
            }
        }

        // FIST: 0 fingers or very compact
        if (fingers == 0)
        {
            return Gesture::FIST;
        }

        // PRIORITY 3: Special gestures (PEACE, OK_SIGN)

        if ((fingers == 2 || fingers == 3) && hand.fingertips.size() >= 2)
        {
            const double tip_dist = hand.fingertips[0].distance(hand.fingertips[1]);
            const double hand_size = std::sqrt(hand.bbox.width * hand.bbox.width + hand.bbox.height * hand.bbox.height);

            // OK sign: two prominent points very close together + compact
            if (tip_dist < hand_size * 0.25 && is_compact)
            {
                return Gesture::OK_SIGN;
            }

            // PEACE: fingertips close together, not elongated, not compact
            if (tip_dist < hand_size * 0.6 && !is_elongated && !is_compact)
            {
                return Gesture::PEACE;
            }
        }

        // FALLBACK: Shape-based classification
        if (is_compact && is_square)
        {
            return Gesture::FIST;
        }
        else if (is_elongated || is_moderately_elongated)
        {
            return Gesture::POINTING;
        }
        else if (!is_compact || fingers >= 2)
        {
            // Default to open palm for spread or multi-finger hands
            return Gesture::OPEN_PALM;
        }
        else
        {
            // Ultimate fallback based on compactness
            return is_compact ? Gesture::FIST : Gesture::OPEN_PALM;
        }
    }

    Gesture HandDetector::stabilize_gesture(Gesture current)
    {
        gesture_history_.push_back(current);

        if (gesture_history_.size() > static_cast<size_t>(config_.gesture_history))
        {
            gesture_history_.erase(gesture_history_.begin());
        }

        // Count occurrences
        int counts[8] = {0};
        for (Gesture g : gesture_history_)
        {
            counts[static_cast<int>(g)]++;
        }

        // Find most common
        int max_count = 0;
        Gesture most_common = Gesture::UNKNOWN;
        for (int i = 0; i < 8; i++)
        {
            if (counts[i] > max_count)
            {
                max_count = counts[i];
                most_common = static_cast<Gesture>(i);
            }
        }

        return most_common;
    }

    float HandDetector::compute_iou(const BoundingBox &a, const BoundingBox &b)
    {
        // Compute intersection
        int x1 = std::max(a.x, b.x);
        int y1 = std::max(a.y, b.y);
        int x2 = std::min(a.x + a.width, b.x + b.width);
        int y2 = std::min(a.y + a.height, b.y + b.height);

        if (x2 <= x1 || y2 <= y1)
        {
            return 0.0f; // No intersection
        }

        int intersection = (x2 - x1) * (y2 - y1);
        int union_area = a.area() + b.area() - intersection;

        if (union_area <= 0)
        {
            return 0.0f;
        }

        return static_cast<float>(intersection) / union_area;
    }

    std::string HandDetector::gesture_to_string(Gesture g)
    {
        switch (g)
        {
        case Gesture::OPEN_PALM:
            return "Open Palm";
        case Gesture::FIST:
            return "Fist";
        case Gesture::POINTING:
            return "Pointing";
        case Gesture::THUMBS_UP:
            return "Thumbs Up";
        case Gesture::PEACE:
            return "Peace";
        case Gesture::OK_SIGN:
            return "OK Sign";
        case Gesture::CUSTOM:
            return "Custom";
        default:
            return "Unknown";
        }
    }

    Gesture HandDetector::string_to_gesture(const std::string &s)
    {
        if (s == "Open Palm")
            return Gesture::OPEN_PALM;
        if (s == "Fist")
            return Gesture::FIST;
        if (s == "Pointing")
            return Gesture::POINTING;
        if (s == "Thumbs Up")
            return Gesture::THUMBS_UP;
        if (s == "Peace")
            return Gesture::PEACE;
        if (s == "OK Sign")
            return Gesture::OK_SIGN;
        if (s == "Custom")
            return Gesture::CUSTOM;
        return Gesture::UNKNOWN;
    }

    // Utility functions for visualization
    namespace utils
    {

        void draw_box(uint8_t *rgb, uint32_t width, uint32_t height,
                      const BoundingBox &box,
                      uint8_t r, uint8_t g, uint8_t b)
        {
            // Draw rectangle
            for (int x = box.x; x < box.x + box.width && x < (int)width; x++)
            {
                for (int t = 0; t < 2; t++)
                { // Thickness
                    if (box.y + t < (int)height)
                    {
                        size_t idx = ((box.y + t) * width + x) * 3;
                        rgb[idx] = r;
                        rgb[idx + 1] = g;
                        rgb[idx + 2] = b;
                    }
                    if (box.y + box.height - 1 - t >= 0 && box.y + box.height - 1 - t < (int)height)
                    {
                        size_t idx = ((box.y + box.height - 1 - t) * width + x) * 3;
                        rgb[idx] = r;
                        rgb[idx + 1] = g;
                        rgb[idx + 2] = b;
                    }
                }
            }

            for (int y = box.y; y < box.y + box.height && y < (int)height; y++)
            {
                for (int t = 0; t < 2; t++)
                { // Thickness
                    if (box.x + t < (int)width)
                    {
                        size_t idx = (y * width + box.x + t) * 3;
                        rgb[idx] = r;
                        rgb[idx + 1] = g;
                        rgb[idx + 2] = b;
                    }
                    if (box.x + box.width - 1 - t >= 0 && box.x + box.width - 1 - t < (int)width)
                    {
                        size_t idx = (y * width + box.x + box.width - 1 - t) * 3;
                        rgb[idx] = r;
                        rgb[idx + 1] = g;
                        rgb[idx + 2] = b;
                    }
                }
            }
        }

        void draw_point(uint8_t *rgb, uint32_t width, uint32_t height,
                        const Point &point, int radius,
                        uint8_t r, uint8_t g, uint8_t b)
        {
            for (int dy = -radius; dy <= radius; dy++)
            {
                for (int dx = -radius; dx <= radius; dx++)
                {
                    if (dx * dx + dy * dy <= radius * radius)
                    {
                        int x = point.x + dx;
                        int y = point.y + dy;
                        if (x >= 0 && x < (int)width && y >= 0 && y < (int)height)
                        {
                            size_t idx = (y * width + x) * 3;
                            rgb[idx] = r;
                            rgb[idx + 1] = g;
                            rgb[idx + 2] = b;
                        }
                    }
                }
            }
        }

        void draw_contour(uint8_t *rgb, uint32_t width, uint32_t height,
                          const std::vector<Point> &contour,
                          uint8_t r, uint8_t g, uint8_t b)
        {
            for (const auto &pt : contour)
            {
                if (pt.x >= 0 && pt.x < (int)width && pt.y >= 0 && pt.y < (int)height)
                {
                    size_t idx = (pt.y * width + pt.x) * 3;
                    rgb[idx] = r;
                    rgb[idx + 1] = g;
                    rgb[idx + 2] = b;
                }
            }
        }

        void draw_text(uint8_t *rgb, uint32_t width, uint32_t height,
                       const std::string &text, int x, int y,
                       uint8_t r, uint8_t g, uint8_t b)
        {
            // Simple 5x7 bitmap font for numbers and basic letters
            // For production, use a proper font rendering library

            int char_width = 6;
            int char_height = 8;
            int cursor_x = x;

            for (size_t i = 0; i < text.length(); i++)
            {
                if (cursor_x + char_width >= (int)width)
                    break;

                // Draw character placeholder (simple vertical line for demo)
                for (int py = 0; py < char_height && y + py < (int)height; py++)
                {
                    if (cursor_x >= 0 && cursor_x < (int)width && y + py >= 0)
                    {
                        size_t idx = ((y + py) * width + cursor_x) * 3;
                        rgb[idx] = r;
                        rgb[idx + 1] = g;
                        rgb[idx + 2] = b;
                    }
                }

                cursor_x += char_width;
            }
        }

    } // namespace utils

} // namespace hand_detector
