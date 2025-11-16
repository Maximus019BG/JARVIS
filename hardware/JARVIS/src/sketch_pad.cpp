#include "sketch_pad.hpp"
#include "draw_ticker.hpp"
#include <fstream>
#include <sstream>
#include <cmath>
#include <algorithm>
#include <chrono>
#include <iostream>
#include <iomanip>

namespace sketch {

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
    json << "  \"strokes\": [\n";
    
    for (size_t i = 0; i < strokes.size(); ++i) {
        const auto& stroke = strokes[i];
        json << "    {\n";
        json << "      \"color\": " << stroke.color << ",\n";
        json << "      \"thickness\": " << stroke.thickness << ",\n";
        json << "      \"points\": [";
        
        for (size_t j = 0; j < stroke.points.size(); ++j) {
            if (j > 0) json << ", ";
            json << "{\"x\": " << stroke.points[j].x << ", \"y\": " << stroke.points[j].y << "}";
        }
        
        json << "]\n";
        json << "    }";
        if (i < strokes.size() - 1) json << ",";
        json << "\n";
    }
    
    json << "  ]\n";
    json << "}\n";
    
    return json.str();
}

bool Sketch::from_json(const std::string& json) {
    // Simple JSON parser for our specific format
    // This is a minimal implementation - for production, use a proper JSON library
    
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
        size_t width_pos = json.find("\"width\":");
        if (width_pos != std::string::npos) {
            size_t num_start = width_pos + 8;
            size_t num_end = json.find_first_of(",}", num_start);
            if (num_end != std::string::npos) {
                std::string num_str = json.substr(num_start, num_end - num_start);
                // Trim whitespace
                num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                width = std::stoul(num_str);
            }
        }
        
        size_t height_pos = json.find("\"height\":");
        if (height_pos != std::string::npos) {
            size_t num_start = height_pos + 9;
            size_t num_end = json.find_first_of(",}", num_start);
            if (num_end != std::string::npos) {
                std::string num_str = json.substr(num_start, num_end - num_start);
                num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                height = std::stoul(num_str);
            }
        }
        
        size_t timestamp_pos = json.find("\"created_timestamp\":");
        if (timestamp_pos != std::string::npos) {
            size_t num_start = timestamp_pos + 20;
            size_t num_end = json.find_first_of(",}", num_start);
            if (num_end != std::string::npos) {
                std::string num_str = json.substr(num_start, num_end - num_start);
                num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                created_timestamp = std::stoull(num_str);
            }
        }
        
        // Parse strokes (simplified)
        strokes.clear();
        size_t strokes_start = json.find("\"strokes\":");
        if (strokes_start == std::string::npos) return false;
        
        size_t array_start = json.find("[", strokes_start);
        size_t array_end = json.rfind("]");
        if (array_start == std::string::npos || array_end == std::string::npos) return false;
        
        size_t pos = array_start;
        int brace_depth = 0;
        size_t stroke_start = std::string::npos;
        
        for (size_t i = array_start; i < array_end; ++i) {
            if (json[i] == '{') {
                if (brace_depth == 0) stroke_start = i;
                brace_depth++;
            } else if (json[i] == '}') {
                brace_depth--;
                if (brace_depth == 0 && stroke_start != std::string::npos) {
                    // Parse this stroke
                    std::string stroke_json = json.substr(stroke_start, i - stroke_start + 1);
                    
                    Stroke stroke;
                    
                    // Parse color
                    size_t color_pos = stroke_json.find("\"color\":");
                    if (color_pos != std::string::npos) {
                        size_t num_start = color_pos + 8;
                        size_t num_end = stroke_json.find_first_of(",}", num_start);
                        if (num_end != std::string::npos) {
                            std::string num_str = stroke_json.substr(num_start, num_end - num_start);
                            num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                            num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                            stroke.color = std::stoul(num_str);
                        }
                    }
                    
                    // Parse thickness
                    size_t thick_pos = stroke_json.find("\"thickness\":");
                    if (thick_pos != std::string::npos) {
                        size_t num_start = thick_pos + 12;
                        size_t num_end = stroke_json.find_first_of(",}", num_start);
                        if (num_end != std::string::npos) {
                            std::string num_str = stroke_json.substr(num_start, num_end - num_start);
                            num_str.erase(0, num_str.find_first_not_of(" \t\n\r"));
                            num_str.erase(num_str.find_last_not_of(" \t\n\r") + 1);
                            stroke.thickness = std::stoi(num_str);
                        }
                    }
                    
                    // Parse points array
                    size_t points_start = stroke_json.find("\"points\":");
                    if (points_start != std::string::npos) {
                        size_t pts_array_start = stroke_json.find("[", points_start);
                        size_t pts_array_end = stroke_json.find("]", pts_array_start);
                        
                        if (pts_array_start != std::string::npos && pts_array_end != std::string::npos) {
                            size_t pt_pos = pts_array_start;
                            while (true) {
                                pt_pos = stroke_json.find("{\"x\":", pt_pos);
                                if (pt_pos == std::string::npos || pt_pos > pts_array_end) break;
                                
                                Point pt;
                                size_t x_pos = pt_pos + 5;
                                size_t x_end = stroke_json.find(",", x_pos);
                                if (x_end != std::string::npos) {
                                    std::string x_str = stroke_json.substr(x_pos, x_end - x_pos);
                                    x_str.erase(0, x_str.find_first_not_of(" \t\n\r"));
                                    x_str.erase(x_str.find_last_not_of(" \t\n\r") + 1);
                                    pt.x = std::stoi(x_str);
                                }
                                
                                size_t y_pos = stroke_json.find("\"y\":", pt_pos);
                                if (y_pos != std::string::npos) {
                                    y_pos += 4;
                                    size_t y_end = stroke_json.find("}", y_pos);
                                    if (y_end != std::string::npos) {
                                        std::string y_str = stroke_json.substr(y_pos, y_end - y_pos);
                                        y_str.erase(0, y_str.find_first_not_of(" \t\n\r"));
                                        y_str.erase(y_str.find_last_not_of(" \t\n\r") + 1);
                                        pt.y = std::stoi(y_str);
                                    }
                                }
                                
                                stroke.points.push_back(pt);
                                pt_pos = stroke_json.find("}", pt_pos) + 1;
                            }
                        }
                    }
                    
                    strokes.push_back(stroke);
                    stroke_start = std::string::npos;
                }
            }
        }
        
        return true;
    } catch (const std::exception& e) {
        std::cerr << "[Sketch] JSON parse error: " << e.what() << "\n";
        return false;
    }
}

// SketchPad implementation
SketchPad::SketchPad() 
    : is_drawing_(false),
      current_color_(0x00FFFFFF),
      current_thickness_(3),
      smoothing_window_(3),
      frames_since_last_point_(0),
      was_pointing_(false) {
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
    sketch_.strokes.clear();
    
    is_drawing_ = false;
    was_pointing_ = false;
    recent_points_.clear();
}

bool SketchPad::update(const std::vector<hand_detector::HandDetection>& hands) {
    frames_since_last_point_++;
    
    // Find pointing hand
    bool is_pointing = false;
    Point finger_tip;
    
    for (const auto& hand : hands) {
        if (hand.gesture == hand_detector::Gesture::POINTING && 
            hand.bbox.confidence > 0.6f) {
            is_pointing = true;
            
            // Use the index finger tip if available
            if (!hand.fingertips.empty()) {
                finger_tip.x = hand.fingertips[0].x;
                finger_tip.y = hand.fingertips[0].y;
            } else {
                // Fall back to center
                finger_tip.x = hand.center.x;
                finger_tip.y = hand.center.y;
            }
            break;
        }
    }
    
    // State machine: start/continue/end drawing
    if (is_pointing) {
        // Add to smoothing buffer
        recent_points_.push_back(finger_tip);
        if (recent_points_.size() > static_cast<size_t>(smoothing_window_)) {
            recent_points_.pop_front();
        }
        
        Point smoothed = get_smoothed_point();
        
        if (!was_pointing_) {
            // Start new stroke
            current_stroke_ = Stroke();
            current_stroke_.color = current_color_;
            current_stroke_.thickness = current_thickness_;
            current_stroke_.points.push_back(smoothed);
            last_point_ = smoothed;
            is_drawing_ = true;
            frames_since_last_point_ = 0;
        } else if (is_drawing_ && should_add_point(smoothed)) {
            // Continue stroke
            current_stroke_.points.push_back(smoothed);
            last_point_ = smoothed;
            frames_since_last_point_ = 0;
        }
    } else {
        if (was_pointing_ && is_drawing_) {
            // End current stroke
            finish_current_stroke();
        }
        recent_points_.clear();
    }
    
    was_pointing_ = is_pointing;
    
    // Auto-finish stroke if hand hasn't moved in a while
    if (is_drawing_ && frames_since_last_point_ > 30) {
        finish_current_stroke();
    }
    
    return is_drawing_;
}

Point SketchPad::get_smoothed_point() {
    if (recent_points_.empty()) {
        return last_point_;
    }
    
    // Simple moving average
    int sum_x = 0, sum_y = 0;
    for (const auto& p : recent_points_) {
        sum_x += p.x;
        sum_y += p.y;
    }
    
    Point result;
    result.x = sum_x / recent_points_.size();
    result.y = sum_y / recent_points_.size();
    return result;
}

bool SketchPad::should_add_point(const Point& new_point) {
    // Minimum distance threshold to avoid too many points
    const int min_dist = 5;
    
    int dx = new_point.x - last_point_.x;
    int dy = new_point.y - last_point_.y;
    int dist_sq = dx * dx + dy * dy;
    
    return dist_sq >= min_dist * min_dist;
}

void SketchPad::finish_current_stroke() {
    if (is_drawing_ && current_stroke_.points.size() > 1) {
        sketch_.strokes.push_back(current_stroke_);
        std::cout << "[SketchPad] Stroke complete: " << current_stroke_.points.size() 
                  << " points\n";
    }
    is_drawing_ = false;
    current_stroke_.points.clear();
}

void SketchPad::clear() {
    sketch_.strokes.clear();
    is_drawing_ = false;
    current_stroke_.points.clear();
    recent_points_.clear();
    was_pointing_ = false;
}

bool SketchPad::save(const std::string& base_filename) {
    return sketch_.save(base_filename);
}

bool SketchPad::load(const std::string& base_filename) {
    bool success = sketch_.load(base_filename);
    if (success) {
        is_drawing_ = false;
        current_stroke_.points.clear();
        recent_points_.clear();
        was_pointing_ = false;
    }
    return success;
}

void SketchPad::render(void* map, uint32_t stride, uint32_t width, uint32_t height) {
    // Render all completed strokes
    for (const auto& stroke : sketch_.strokes) {
        for (size_t i = 1; i < stroke.points.size(); ++i) {
            draw_ticker::draw_line(map, stride, width, height,
                                  stroke.points[i-1].x, stroke.points[i-1].y,
                                  stroke.points[i].x, stroke.points[i].y,
                                  stroke.color, stroke.thickness);
        }
    }
    
    // Render current stroke being drawn
    if (is_drawing_ && current_stroke_.points.size() > 1) {
        for (size_t i = 1; i < current_stroke_.points.size(); ++i) {
            draw_ticker::draw_line(map, stride, width, height,
                                  current_stroke_.points[i-1].x, current_stroke_.points[i-1].y,
                                  current_stroke_.points[i].x, current_stroke_.points[i].y,
                                  current_stroke_.color, current_stroke_.thickness);
        }
    }
}

int SketchPad::get_total_points() const {
    int total = 0;
    for (const auto& stroke : sketch_.strokes) {
        total += stroke.points.size();
    }
    return total;
}

} // namespace sketch
