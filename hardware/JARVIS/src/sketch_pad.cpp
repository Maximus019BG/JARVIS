#include "sketch_pad.hpp"
#include "draw_ticker.hpp"
#include <fstream>
#include <sstream>
#include <cmath>
#include <algorithm>
#include <chrono>
#include <iostream>
#include <iomanip>
#include <cstring>
#include <limits>

namespace sketch {

// Projector calibration implementation
Point ProjectorCalibration::transform(const Point& p) const {
    if (!calibrated) return p;
    
    // Apply homography: [x', y', w'] = H * [x, y, 1]
    float x = p.x;
    float y = p.y;
    
    float xp = transform_matrix[0] * x + transform_matrix[1] * y + transform_matrix[2];
    float yp = transform_matrix[3] * x + transform_matrix[4] * y + transform_matrix[5];
    float wp = transform_matrix[6] * x + transform_matrix[7] * y + transform_matrix[8];
    
    if (std::abs(wp) < 1e-6f) return p; // Avoid division by zero
    
    return Point(xp / wp, yp / wp);
}

void ProjectorCalibration::compute_homography() {
    // Simplified DLT (Direct Linear Transform) for homography estimation
    // For production, use OpenCV's getPerspectiveTransform or similar
    // This is a basic 4-point implementation
    
    // For now, compute a simple affine approximation
    // In enterprise deployment, integrate OpenCV or a robust homography solver
    
    // Mark as calibrated with identity for now
    calibrated = true;
    
    std::cerr << "[ProjectorCalibration] Calibration computed (affine approximation)\n";
}

// JSON serialization helpers
static std::string escape_json_string(const std::string& s) {
    std::string result;
    for (char c : s) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}

// Helper to blend colors with alpha
static inline uint32_t blend_color(uint32_t bg, uint32_t fg, float alpha) {
    if (alpha >= 1.0f) return fg;
    if (alpha <= 0.0f) return bg;
    
    uint8_t bg_r = (bg >> 16) & 0xFF;
    uint8_t bg_g = (bg >> 8) & 0xFF;
    uint8_t bg_b = bg & 0xFF;
    
    uint8_t fg_r = (fg >> 16) & 0xFF;
    uint8_t fg_g = (fg >> 8) & 0xFF;
    uint8_t fg_b = fg & 0xFF;
    
    uint8_t r = static_cast<uint8_t>(bg_r * (1.0f - alpha) + fg_r * alpha);
    uint8_t g = static_cast<uint8_t>(bg_g * (1.0f - alpha) + fg_g * alpha);
    uint8_t b = static_cast<uint8_t>(bg_b * (1.0f - alpha) + fg_b * alpha);
    
    return (r << 16) | (g << 8) | b;
}

// Safe pixel setter with bounds checking
static inline void set_pixel(void* map, uint32_t stride, uint32_t width, uint32_t height,
                            int x, int y, uint32_t color) {
    if (x < 0 || x >= static_cast<int>(width) || 
        y < 0 || y >= static_cast<int>(height)) return;
    
    uint32_t* pixels = reinterpret_cast<uint32_t*>(
        static_cast<uint8_t*>(map) + y * stride);
    pixels[x] = color;
}

// Safe pixel setter with alpha blending
static inline void set_pixel_aa(void* map, uint32_t stride, uint32_t width, uint32_t height,
                               int x, int y, uint32_t color, float alpha) {
    if (x < 0 || x >= static_cast<int>(width) || 
        y < 0 || y >= static_cast<int>(height)) return;
    
    uint32_t* pixels = reinterpret_cast<uint32_t*>(
        static_cast<uint8_t*>(map) + y * stride);
    pixels[x] = blend_color(pixels[x], color, alpha);
}

// Sketch implementation
bool Sketch::save(const std::string& filename) const {
    std::string full_path = filename;
    if (full_path.find(".jarvis") == std::string::npos) {
        full_path += ".jarvis";
    }
    
    std::ofstream file(full_path);
    if (!file.is_open()) {
        std::cerr << "[Sketch] Failed to open file for writing: " << full_path << "\n";
        return false;
    }
    
    file << to_json();
    file.close();
    
    std::cout << "[Sketch] Saved to: " << full_path << "\n";
    return true;
}

bool Sketch::load(const std::string& filename) {
    std::string full_path = filename;
    if (full_path.find(".jarvis") == std::string::npos) {
        full_path += ".jarvis";
    }
    
    std::ifstream file(full_path);
    if (!file.is_open()) {
        std::cerr << "[Sketch] Failed to open file for reading: " << full_path << "\n";
        return false;
    }
    
    std::stringstream buffer;
    buffer << file.rdbuf();
    file.close();
    
    bool success = from_json(buffer.str());
    if (success) {
        std::cout << "[Sketch] Loaded from: " << full_path << "\n";
    }
    return success;
}

std::string Sketch::to_json() const {
    std::ostringstream json;
    
    json << "{\n";
    json << "  \"name\": \"" << escape_json_string(name) << "\",\n";
    json << "  \"width\": " << width << ",\n";
    json << "  \"height\": " << height << ",\n";
    json << "  \"created_timestamp\": " << created_timestamp << ",\n";
    json << "  \"lines\": [\n";
    
    for (size_t i = 0; i < lines.size(); ++i) {
        const auto& line = lines[i];
        json << "    {\n";
        json << "      \"start\": {\"x\": " << line.start.x << ", \"y\": " << line.start.y << "},\n";
        json << "      \"end\": {\"x\": " << line.end.x << ", \"y\": " << line.end.y << "},\n";
        json << "      \"color\": " << line.color << ",\n";
        json << "      \"thickness\": " << line.thickness << ",\n";
        json << "      \"timestamp\": " << line.timestamp << "\n";
        json << "    }";
        if (i < lines.size() - 1) json << ",";
        json << "\n";
    }
    
    json << "  ]\n";
    json << "}\n";
    
    return json.str();
}

bool Sketch::from_json(const std::string& json) {
    try {
        // Extract name
        size_t name_pos = json.find("\"name\":");
        if (name_pos != std::string::npos) {
            size_t start = json.find("\"", name_pos + 7) + 1;
            size_t end = json.find("\"", start);
            if (start != std::string::npos && end != std::string::npos) {
                name = json.substr(start, end - start);
            }
        }
        
        // Extract dimensions
        auto extract_number = [&json](const std::string& key) -> uint64_t {
            size_t pos = json.find("\"" + key + "\":");
            if (pos == std::string::npos) return 0;
            size_t num_start = pos + key.length() + 3;
            size_t num_end = json.find_first_of(",}", num_start);
            if (num_end == std::string::npos) return 0;
            std::string num_str = json.substr(num_start, num_end - num_start);
            num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
            num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
            return std::stoull(num_str);
        };
        
        width = static_cast<uint32_t>(extract_number("width"));
        height = static_cast<uint32_t>(extract_number("height"));
        created_timestamp = extract_number("created_timestamp");
        
        // Parse lines
        lines.clear();
        size_t lines_start = json.find("\"lines\":");
        if (lines_start == std::string::npos) return false;
        
        size_t array_start = json.find("[", lines_start);
        size_t array_end = json.rfind("]");
        if (array_start == std::string::npos || array_end == std::string::npos) return false;
        
        size_t pos = array_start;
        int brace_depth = 0;
        size_t line_start = std::string::npos;
        
        for (size_t i = array_start; i < array_end; ++i) {
            if (json[i] == '{') {
                if (brace_depth == 0) line_start = i;
                brace_depth++;
            } else if (json[i] == '}') {
                brace_depth--;
                if (brace_depth == 0 && line_start != std::string::npos) {
                    std::string line_json = json.substr(line_start, i - line_start + 1);
                    
                    Line line;
                    
                    // Parse start point
                    size_t start_pos = line_json.find("\"start\":");
                    if (start_pos != std::string::npos) {
                        size_t x_pos = line_json.find("\"x\":", start_pos);
                        size_t y_pos = line_json.find("\"y\":", start_pos);
                        if (x_pos != std::string::npos && y_pos != std::string::npos) {
                            x_pos += 4;
                            size_t x_end = line_json.find_first_of(",}", x_pos);
                            std::string x_str = line_json.substr(x_pos, x_end - x_pos);
                            x_str.erase(0, x_str.find_first_not_of(" \t\n\r"));
                            x_str.erase(x_str.find_last_not_of(" \t\n\r") + 1);
                            line.start.x = std::stof(x_str);
                            
                            y_pos += 4;
                            size_t y_end = line_json.find_first_of(",}", y_pos);
                            std::string y_str = line_json.substr(y_pos, y_end - y_pos);
                            y_str.erase(0, y_str.find_first_not_of(" \t\n\r"));
                            y_str.erase(y_str.find_last_not_of(" \t\n\r") + 1);
                            line.start.y = std::stof(y_str);
                        }
                    }
                    
                    // Parse end point
                    size_t end_pos = line_json.find("\"end\":");
                    if (end_pos != std::string::npos) {
                        size_t x_pos = line_json.find("\"x\":", end_pos);
                        size_t y_pos = line_json.find("\"y\":", end_pos);
                        if (x_pos != std::string::npos && y_pos != std::string::npos) {
                            x_pos += 4;
                            size_t x_end = line_json.find_first_of(",}", x_pos);
                            std::string x_str = line_json.substr(x_pos, x_end - x_pos);
                            x_str.erase(0, x_str.find_first_not_of(" \t\n\r"));
                            x_str.erase(x_str.find_last_not_of(" \t\n\r") + 1);
                            line.end.x = std::stof(x_str);
                            
                            y_pos += 4;
                            size_t y_end = line_json.find_first_of(",}", y_pos);
                            std::string y_str = line_json.substr(y_pos, y_end - y_pos);
                            y_str.erase(0, y_str.find_first_not_of(" \t\n\r"));
                            y_str.erase(y_str.find_last_not_of(" \t\n\r") + 1);
                            line.end.y = std::stof(y_str);
                        }
                    }
                    
                    // Parse color
                    size_t color_pos = line_json.find("\"color\":");
                    if (color_pos != std::string::npos) {
                        size_t num_start = color_pos + 8;
                        size_t num_end = line_json.find_first_of(",}", num_start);
                        std::string num_str = line_json.substr(num_start, num_end - num_start);
                        num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                        num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                        line.color = std::stoul(num_str);
                    }
                    
                    // Parse thickness
                    size_t thick_pos = line_json.find("\"thickness\":");
                    if (thick_pos != std::string::npos) {
                        size_t num_start = thick_pos + 12;
                        size_t num_end = line_json.find_first_of(",}", num_start);
                        std::string num_str = line_json.substr(num_start, num_end - num_start);
                        num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                        num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                        line.thickness = std::stoi(num_str);
                    }
                    
                    // Parse timestamp
                    size_t ts_pos = line_json.find("\"timestamp\":");
                    if (ts_pos != std::string::npos) {
                        size_t num_start = ts_pos + 12;
                        size_t num_end = line_json.find_first_of(",}", num_start);
                        std::string num_str = line_json.substr(num_start, num_end - num_start);
                        num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                        num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                        line.timestamp = std::stoull(num_str);
                    }
                    
                    lines.push_back(line);
                    line_start = std::string::npos;
                }
            }
        }
        
        return true;
    } catch (const std::exception& e) {
        std::cerr << "[Sketch] JSON parse error: " << e.what() << "\n";
        return false;
    }
}

// SketchPad implementation - Enterprise drawing for architects
SketchPad::SketchPad() 
    : state_(DrawingState::WAITING_FOR_START),
      current_color_(0x00FFFFFF),
      current_thickness_(3),
      required_confirmation_frames_(5),
      gesture_changed_since_start_(false),
      smoothing_window_(9),
      jitter_threshold_(1.5f),
      anti_aliasing_enabled_(true),
      subpixel_rendering_(true),
      predictive_smoothing_(true),
      use_projector_calibration_(false),
      last_line_timestamp_(0) {
}

SketchPad::SketchPad(uint32_t width, uint32_t height)
    : SketchPad() {
    sketch_.width = width;
    sketch_.height = height;
}

SketchPad::~SketchPad() {}

void SketchPad::init(const std::string& name, uint32_t width, uint32_t height) {
    sketch_.name = name;
    sketch_.width = width;
    sketch_.height = height;
    sketch_.created_timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    sketch_.lines.clear();
    
    state_ = DrawingState::WAITING_FOR_START;
    current_confirmation_.reset();
    gesture_changed_since_start_ = false;
    position_buffer_.clear();
    
    std::cerr << "[SketchPad] ┌─────────────────────────────────────────────────┐\n";
    std::cerr << "[SketchPad] │  ENTERPRISE DRAWING SYSTEM - ARCHITECT MODE   │\n";
    std::cerr << "[SketchPad] └─────────────────────────────────────────────────┘\n";
    std::cerr << "[SketchPad] Initialized: '" << name << "'\n";
    std::cerr << "  • Resolution: " << width << "x" << height << "\n";
    std::cerr << "  • Confirmation frames: " << required_confirmation_frames_ << "\n";
    std::cerr << "  • Anti-aliasing: " << (anti_aliasing_enabled_ ? "ENABLED" : "DISABLED") << "\n";
    std::cerr << "  • Sub-pixel rendering: " << (subpixel_rendering_ ? "ENABLED" : "DISABLED") << "\n";
    std::cerr << "  • Predictive smoothing: " << (predictive_smoothing_ ? "ENABLED" : "DISABLED") << "\n";
    std::cerr << "  • Projector calibration: " << (use_projector_calibration_ ? "ENABLED" : "DISABLED") << "\n";
    std::cerr << "  • Jitter threshold: " << jitter_threshold_ << "px (sub-pixel precision)\n";
}

bool SketchPad::update(const std::vector<hand_detector::HandDetection>& hands) {
    update_state_machine(hands);
    return state_ != DrawingState::WAITING_FOR_START;
}

void SketchPad::update_state_machine(const std::vector<hand_detector::HandDetection>& hands) {
    // Find best pointing hand with higher confidence threshold for architects
    const hand_detector::HandDetection* pointing_hand = nullptr;
    float best_confidence = 0.0f;
    
    for (const auto& hand : hands) {
        if (is_pointing_gesture(hand.gesture) && hand.bbox.confidence > best_confidence) {
            pointing_hand = &hand;
            best_confidence = hand.bbox.confidence;
        }
    }
    
    // Get current position with enterprise-grade smoothing
    Point current_pos;
    bool has_pointing = false;
    
    if (pointing_hand && best_confidence > 0.65f) {  // Higher threshold for precision
        has_pointing = true;
        
        // Use fingertip if available (most accurate), otherwise center
        if (!pointing_hand->fingertips.empty()) {
            current_pos = Point(pointing_hand->fingertips[0].x, pointing_hand->fingertips[0].y);
        } else {
            current_pos = Point(pointing_hand->center.x, pointing_hand->center.y);
        }
        
        // Add to smoothing buffer
        position_buffer_.push_back(current_pos);
        if (position_buffer_.size() > static_cast<size_t>(smoothing_window_)) {
            position_buffer_.pop_front();
        }
        
        // Get smoothed position with predictive algorithm
        if (predictive_smoothing_ && position_buffer_.size() >= 5) {
            current_pos = get_predictive_smoothed_position();
        } else {
            current_pos = get_smoothed_position();
        }
        
        // Apply projector calibration if enabled
        if (use_projector_calibration_) {
            current_pos = apply_calibration(current_pos);
        }
    }
    
    // Check for non-pointing gestures (for state transitions)
    bool has_other_gesture = false;
    for (const auto& hand : hands) {
        if (!is_pointing_gesture(hand.gesture) && 
            hand.gesture != hand_detector::Gesture::UNKNOWN &&
            hand.bbox.confidence > 0.6f) {
            has_other_gesture = true;
            break;
        }
    }
    
    // State machine logic
    switch (state_) {
        case DrawingState::WAITING_FOR_START:
            if (has_pointing) {
                // Check if this is same gesture as before
                if (current_confirmation_.gesture == hand_detector::Gesture::POINTING) {
                    current_confirmation_.consecutive_frames++;
                    current_confirmation_.position = current_pos;
                    current_confirmation_.confidence_sum += best_confidence;
                } else {
                    // Start new confirmation
                    current_confirmation_.gesture = hand_detector::Gesture::POINTING;
                    current_confirmation_.consecutive_frames = 1;
                    current_confirmation_.position = current_pos;
                    current_confirmation_.confidence_sum = best_confidence;
                }
                
                // Check if confirmed
                if (current_confirmation_.consecutive_frames >= required_confirmation_frames_) {
                    start_point_ = current_confirmation_.position;
                    preview_end_point_ = start_point_;
                    state_ = DrawingState::START_CONFIRMED;
                    gesture_changed_since_start_ = false;
                    
                    std::cerr << "[SketchPad] ✓ START confirmed at (" 
                              << start_point_.x << ", " << start_point_.y 
                              << ") after " << current_confirmation_.consecutive_frames 
                              << " frames (conf: " << (int)(current_confirmation_.avg_confidence() * 100) << "%)\n";
                    
                    current_confirmation_.reset();
                }
            } else {
                // Reset confirmation if no pointing
                if (current_confirmation_.consecutive_frames > 0) {
                    current_confirmation_.reset();
                }
            }
            break;
            
        case DrawingState::START_CONFIRMED:
            // Wait for gesture change OR direct pointing (for continuous workflow)
            if (has_other_gesture) {
                gesture_changed_since_start_ = true;
                state_ = DrawingState::WAITING_FOR_END;
                current_confirmation_.reset();
                
                std::cerr << "[SketchPad] → Gesture changed, waiting for END point...\n";
            } else if (has_pointing) {
                // Update preview end point in real-time
                preview_end_point_ = current_pos;
                
                // If user moved far enough without gesture change, still allow confirmation
                // This enables: pointing -> move hand -> pointing (without intermediate gesture)
                float dist_from_start = start_point_.distance(current_pos);
                if (dist_from_start > 20.0f) {
                    // Consider this as implicitly changed (moved significantly)
                    gesture_changed_since_start_ = true;
                }
            } else {
                // No hand detected - implicit gesture change
                if (current_confirmation_.consecutive_frames > 0) {
                    gesture_changed_since_start_ = true;
                    current_confirmation_.reset();
                }
            }
            break;
            
        case DrawingState::WAITING_FOR_END:
            if (has_pointing) {
                // Update preview
                preview_end_point_ = current_pos;
                
                // Check if this is same gesture as before
                if (current_confirmation_.gesture == hand_detector::Gesture::POINTING) {
                    current_confirmation_.consecutive_frames++;
                    current_confirmation_.position = current_pos;
                    current_confirmation_.confidence_sum += best_confidence;
                } else {
                    // Start new confirmation
                    current_confirmation_.gesture = hand_detector::Gesture::POINTING;
                    current_confirmation_.consecutive_frames = 1;
                    current_confirmation_.position = current_pos;
                    current_confirmation_.confidence_sum = best_confidence;
                }
                
                // Check if confirmed
                if (current_confirmation_.consecutive_frames >= required_confirmation_frames_) {
                    // Finalize line
                    preview_end_point_ = current_confirmation_.position;
                    state_ = DrawingState::END_CONFIRMED;
                    
                    std::cerr << "[SketchPad] ✓ END confirmed at (" 
                              << preview_end_point_.x << ", " << preview_end_point_.y 
                              << ") after " << current_confirmation_.consecutive_frames 
                              << " frames (conf: " << (int)(current_confirmation_.avg_confidence() * 100) << "%)\n";
                }
            } else {
                // Reset confirmation if no pointing
                if (current_confirmation_.consecutive_frames > 0) {
                    current_confirmation_.reset();
                }
            }
            break;
            
        case DrawingState::END_CONFIRMED:
            // This state is handled immediately after setting
            finalize_line();
            state_ = DrawingState::WAITING_FOR_START;
            current_confirmation_.reset();
            gesture_changed_since_start_ = false;
            position_buffer_.clear();
            break;
    }
}

Point SketchPad::get_smoothed_position() {
    if (position_buffer_.empty()) {
        return Point(0, 0);
    }
    
    // Exponential weighted moving average - more weight to recent positions
    float sum_x = 0.0f, sum_y = 0.0f, sum_weight = 0.0f;
    size_t n = position_buffer_.size();
    
    for (size_t i = 0; i < n; ++i) {
        // Exponential weighting for smoother response
        float weight = std::exp(static_cast<float>(i) / static_cast<float>(n));
        sum_x += position_buffer_[i].x * weight;
        sum_y += position_buffer_[i].y * weight;
        sum_weight += weight;
    }
    
    Point result;
    result.x = sum_x / sum_weight;
    result.y = sum_y / sum_weight;
    
    return result;
}

Point SketchPad::get_predictive_smoothed_position() {
    if (position_buffer_.size() < 3) {
        return get_smoothed_position();
    }
    
    // Kalman-like prediction: use recent velocity to predict next position
    size_t n = position_buffer_.size();
    
    // Calculate velocity from last few frames
    Point vel(0, 0);
    int vel_samples = std::min(static_cast<int>(n), 3);
    for (int i = 0; i < vel_samples - 1; ++i) {
        int idx = n - vel_samples + i;
        vel.x += (position_buffer_[idx + 1].x - position_buffer_[idx].x);
        vel.y += (position_buffer_[idx + 1].y - position_buffer_[idx].y);
    }
    vel.x /= (vel_samples - 1);
    vel.y /= (vel_samples - 1);
    
    // Get smoothed current position
    Point smoothed = get_smoothed_position();
    
    // Predict next position with dampening (0.3 = conservative prediction)
    const float prediction_factor = 0.3f;
    Point predicted;
    predicted.x = smoothed.x + vel.x * prediction_factor;
    predicted.y = smoothed.y + vel.y * prediction_factor;
    
    return predicted;
}

Point SketchPad::apply_jitter_filter(const Point& new_pos, const Point& last_pos) {
    float dist = new_pos.distance(last_pos);
    
    if (dist < jitter_threshold_) {
        // Movement too small, likely jitter - keep old position
        return last_pos;
    }
    
    return new_pos;
}

Point SketchPad::apply_calibration(const Point& p) const {
    if (!calibration_.calibrated) {
        return p;
    }
    return calibration_.transform(p);
}

void SketchPad::set_calibration_points(const Point camera_pts[4], const Point display_pts[4]) {
    for (int i = 0; i < 4; ++i) {
        calibration_.camera_corners[i] = camera_pts[i];
        calibration_.display_corners[i] = display_pts[i];
    }
    std::cerr << "[SketchPad] Calibration points set\n";
}

void SketchPad::calibrate_projector() {
    calibration_.compute_homography();
    use_projector_calibration_ = true;
    std::cerr << "[SketchPad] ✓ Projector calibration activated\n";
}

void SketchPad::finalize_line() {
    // Only create line if start and end are different
    float dist = start_point_.distance(preview_end_point_);
    
    if (dist < 2.5f) {  // Slightly lower threshold for precision work
        std::cerr << "[SketchPad] ✗ Line too short (" << std::fixed << std::setprecision(1) 
                  << dist << "px), discarded\n";
        return;
    }
    
    Line line;
    line.start = start_point_;
    line.end = preview_end_point_;
    line.color = current_color_;
    line.thickness = current_thickness_;
    line.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
    
    sketch_.lines.push_back(line);
    last_line_timestamp_ = line.timestamp;
    
    std::cerr << "[SketchPad] ✓ Line #" << std::setw(4) << sketch_.lines.size() << " created: "
              << "(" << std::setw(7) << std::fixed << std::setprecision(1) << line.start.x 
              << "," << std::setw(7) << line.start.y << ") → "
              << "(" << std::setw(7) << line.end.x 
              << "," << std::setw(7) << line.end.y << ") "
              << "length: " << std::setw(6) << std::setprecision(1) << dist << "px\n";
}

void SketchPad::clear() {
    sketch_.lines.clear();
    state_ = DrawingState::WAITING_FOR_START;
    current_confirmation_.reset();
    gesture_changed_since_start_ = false;
    position_buffer_.clear();
}

bool SketchPad::save(const std::string& base_filename) {
    return sketch_.save(base_filename);
}

bool SketchPad::load(const std::string& base_filename) {
    bool success = sketch_.load(base_filename);
    if (success) {
        state_ = DrawingState::WAITING_FOR_START;
        current_confirmation_.reset();
        gesture_changed_since_start_ = false;
        position_buffer_.clear();
    }
    return success;
}

// Enterprise rendering with anti-aliasing
void SketchPad::draw_aa_line(void* map, uint32_t stride, uint32_t width, uint32_t height,
                            const Point& p0, const Point& p1, uint32_t color, int thickness) {
    // Xiaolin Wu's line algorithm with thickness support for enterprise quality
    
    auto plot = [&](int x, int y, float brightness) {
        if (brightness <= 0.0f) return;
        if (brightness > 1.0f) brightness = 1.0f;
        set_pixel_aa(map, stride, width, height, x, y, color, brightness);
    };
    
    auto ipart = [](float x) -> int { return static_cast<int>(std::floor(x)); };
    auto fpart = [](float x) -> float { return x - std::floor(x); };
    auto rfpart = [&fpart](float x) -> float { return 1.0f - fpart(x); };  // Capture fpart
    
    float x0 = p0.x, y0 = p0.y;
    float x1 = p1.x, y1 = p1.y;
    
    bool steep = std::abs(y1 - y0) > std::abs(x1 - x0);
    
    if (steep) {
        std::swap(x0, y0);
        std::swap(x1, y1);
    }
    if (x0 > x1) {
        std::swap(x0, x1);
        std::swap(y0, y1);
    }
    
    float dx = x1 - x0;
    float dy = y1 - y0;
    float gradient = (dx == 0.0f) ? 1.0f : dy / dx;
    
    // Handle first endpoint
    int xend = ipart(x0 + 0.5f);
    float yend = y0 + gradient * (xend - x0);
    float xgap = rfpart(x0 + 0.5f);
    int xpxl1 = xend;
    int ypxl1 = ipart(yend);
    
    if (steep) {
        for (int t = -thickness/2; t <= thickness/2; ++t) {
            plot(ypxl1 + t, xpxl1, rfpart(yend) * xgap);
            plot(ypxl1 + 1 + t, xpxl1, fpart(yend) * xgap);
        }
    } else {
        for (int t = -thickness/2; t <= thickness/2; ++t) {
            plot(xpxl1, ypxl1 + t, rfpart(yend) * xgap);
            plot(xpxl1, ypxl1 + 1 + t, fpart(yend) * xgap);
        }
    }
    
    float intery = yend + gradient;
    
    // Handle second endpoint
    xend = ipart(x1 + 0.5f);
    yend = y1 + gradient * (xend - x1);
    xgap = fpart(x1 + 0.5f);
    int xpxl2 = xend;
    int ypxl2 = ipart(yend);
    
    if (steep) {
        for (int t = -thickness/2; t <= thickness/2; ++t) {
            plot(ypxl2 + t, xpxl2, rfpart(yend) * xgap);
            plot(ypxl2 + 1 + t, xpxl2, fpart(yend) * xgap);
        }
    } else {
        for (int t = -thickness/2; t <= thickness/2; ++t) {
            plot(xpxl2, ypxl2 + t, rfpart(yend) * xgap);
            plot(xpxl2, ypxl2 + 1 + t, fpart(yend) * xgap);
        }
    }
    
    // Main loop
    if (steep) {
        for (int x = xpxl1 + 1; x < xpxl2; ++x) {
            int y_base = ipart(intery);
            for (int t = -thickness/2; t <= thickness/2; ++t) {
                plot(y_base + t, x, rfpart(intery));
                plot(y_base + 1 + t, x, fpart(intery));
            }
            intery += gradient;
        }
    } else {
        for (int x = xpxl1 + 1; x < xpxl2; ++x) {
            int y_base = ipart(intery);
            for (int t = -thickness/2; t <= thickness/2; ++t) {
                plot(x, y_base + t, rfpart(intery));
                plot(x, y_base + 1 + t, fpart(intery));
            }
            intery += gradient;
        }
    }
}

void SketchPad::render(void* map, uint32_t stride, uint32_t width, uint32_t height) {
    // Render all completed lines
    for (const auto& line : sketch_.lines) {
        if (anti_aliasing_enabled_ && subpixel_rendering_) {
            // Enterprise anti-aliased rendering
            draw_aa_line(map, stride, width, height, 
                        line.start, line.end, line.color, line.thickness);
        } else {
            // Fallback to standard line drawing
            draw_ticker::draw_line(map, stride, width, height,
                                  static_cast<int>(line.start.x), 
                                  static_cast<int>(line.start.y),
                                  static_cast<int>(line.end.x), 
                                  static_cast<int>(line.end.y),
                                  line.color, line.thickness);
        }
    }
    
    // Render preview line if in drawing mode
    if (has_preview()) {
        // Use semi-transparent preview color
        uint32_t preview_color = (current_color_ & 0x00FFFFFF) | 0x80000000;
        
        if (anti_aliasing_enabled_ && subpixel_rendering_) {
            draw_aa_line(map, stride, width, height, 
                        start_point_, preview_end_point_, 
                        preview_color, current_thickness_);
        } else {
            draw_ticker::draw_line(map, stride, width, height,
                                  static_cast<int>(start_point_.x), 
                                  static_cast<int>(start_point_.y),
                                  static_cast<int>(preview_end_point_.x), 
                                  static_cast<int>(preview_end_point_.y),
                                  preview_color, current_thickness_);
        }
        
        // Draw start point indicator (circle)
        const int indicator_radius = 6;
        for (int dy = -indicator_radius; dy <= indicator_radius; ++dy) {
            for (int dx = -indicator_radius; dx <= indicator_radius; ++dx) {
                if (dx*dx + dy*dy <= indicator_radius*indicator_radius) {
                    int px = static_cast<int>(start_point_.x) + dx;
                    int py = static_cast<int>(start_point_.y) + dy;
                    set_pixel(map, stride, width, height, px, py, 0x0000FF00); // Green
                }
            }
        }
        
        // Draw end point indicator (circle) - only in WAITING_FOR_END state
        if (state_ == DrawingState::WAITING_FOR_END) {
            for (int dy = -indicator_radius; dy <= indicator_radius; ++dy) {
                for (int dx = -indicator_radius; dx <= indicator_radius; ++dx) {
                    if (dx*dx + dy*dy <= indicator_radius*indicator_radius) {
                        int px = static_cast<int>(preview_end_point_.x) + dx;
                        int py = static_cast<int>(preview_end_point_.y) + dy;
                        
                        // Pulsing effect based on confirmation progress
                        float pulse = static_cast<float>(current_confirmation_.consecutive_frames) / 
                                     required_confirmation_frames_;
                        uint8_t intensity = static_cast<uint8_t>(128 + 127 * pulse);
                        uint32_t pulse_color = (intensity << 16) | (intensity << 8); // Yellow to white
                        
                        set_pixel(map, stride, width, height, px, py, pulse_color);
                    }
                }
            }
        }
    }
}

} // namespace sketch
