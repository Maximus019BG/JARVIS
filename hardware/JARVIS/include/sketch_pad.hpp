#pragma once

#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <deque>
#include <cmath>

namespace sketch {

// High-precision point for enterprise drawing
struct Point {
    float x, y;  // Sub-pixel precision for architects
    Point() : x(0.0f), y(0.0f) {}
    Point(float x_, float y_) : x(x_), y(y_) {}
    Point(int x_, int y_) : x(static_cast<float>(x_)), y(static_cast<float>(y_)) {}
    
    // Distance to another point
    float distance(const Point& other) const {
        float dx = x - other.x;
        float dy = y - other.y;
        return std::sqrt(dx * dx + dy * dy);
    }
};

// A line segment (enterprise point-to-point drawing)
struct Line {
    Point start;
    Point end;
    uint32_t color;
    int thickness;
    uint64_t timestamp;  // When line was created
    
    Line() : color(0x00FFFFFF), thickness(3), timestamp(0) {}
};

// A complete sketch with metadata
struct Sketch {
    std::string name;
    std::vector<Line> lines;  // Changed from strokes to lines
    uint32_t width;
    uint32_t height;
    uint64_t created_timestamp;
    
    Sketch() : width(640), height(480), created_timestamp(0) {}
    
    // Save to .jarvis file (JSON format)
    bool save(const std::string& filename) const;
    
    // Load from .jarvis file
    bool load(const std::string& filename);
    
    // Convert to JSON string
    std::string to_json() const;
    
    // Parse from JSON string
    bool from_json(const std::string& json);
};

// Projector calibration for table-mounted setup
struct ProjectorCalibration {
    // 4-point perspective transform (src -> dst mapping)
    Point camera_corners[4];  // What camera sees
    Point display_corners[4];  // Where to map on display
    bool calibrated;
    float transform_matrix[9]; // 3x3 homography matrix
    
    ProjectorCalibration() : calibrated(false) {
        for (int i = 0; i < 9; ++i) transform_matrix[i] = 0.0f;
        // Default identity
        transform_matrix[0] = transform_matrix[4] = transform_matrix[8] = 1.0f;
    }
    
    // Apply perspective transformation
    Point transform(const Point& p) const;
    void compute_homography();
};

// Enterprise drawing state machine
enum class DrawingState {
    WAITING_FOR_START,      // Waiting for 5 consecutive pointing frames
    START_CONFIRMED,        // Start point locked, waiting for gesture change
    WAITING_FOR_END,        // Gesture changed, waiting for 5 consecutive pointing frames
    END_CONFIRMED           // End point confirmed, line will be drawn
};

// Gesture tracking for confirmation
struct GestureConfirmation {
    hand_detector::Gesture gesture;
    int consecutive_frames;
    Point position;
    float confidence_sum;
    
    GestureConfirmation() : gesture(hand_detector::Gesture::UNKNOWN), 
                           consecutive_frames(0), confidence_sum(0.0f) {}
    
    void reset() {
        gesture = hand_detector::Gesture::UNKNOWN;
        consecutive_frames = 0;
        position = Point();
        confidence_sum = 0.0f;
    }
    
    float avg_confidence() const {
        return consecutive_frames > 0 ? confidence_sum / consecutive_frames : 0.0f;
    }
};

// Enterprise drawing state machine for architects
class SketchPad {
public:
    SketchPad();
    explicit SketchPad(uint32_t width, uint32_t height);
    ~SketchPad();
    
    // Initialize with sketch name
    void init(const std::string& name, uint32_t width, uint32_t height);
    
    // Update with hand detection (returns true if drawing)
    bool update(const std::vector<hand_detector::HandDetection>& hands);
    
    // Get current sketch
    const Sketch& get_sketch() const { return sketch_; }
    
    // Clear current sketch
    void clear();
    
    // Save sketch to file
    bool save(const std::string& base_filename);
    
    // Load sketch from file
    bool load(const std::string& base_filename);
    
    // Render sketch to buffer with anti-aliasing
    void render(void* map, uint32_t stride, uint32_t width, uint32_t height);
    
    // Get statistics
    int get_stroke_count() const { return sketch_.lines.size(); }
    int get_total_points() const { return sketch_.lines.size() * 2; }
    
    // Drawing parameters
    void set_color(uint32_t color) { current_color_ = color; }
    void set_thickness(int thickness) { current_thickness_ = thickness; }
    void set_confirmation_frames(int frames) { required_confirmation_frames_ = frames; }
    void set_jitter_threshold(float threshold) { jitter_threshold_ = threshold; }
    
    // Enterprise features
    void enable_anti_aliasing(bool enable) { anti_aliasing_enabled_ = enable; }
    void enable_subpixel_rendering(bool enable) { subpixel_rendering_ = enable; }
    void enable_predictive_smoothing(bool enable) { predictive_smoothing_ = enable; }
    void enable_projector_calibration(bool enable) { use_projector_calibration_ = enable; }
    
    // Projector calibration for table setup
    void set_calibration_points(const Point camera_pts[4], const Point display_pts[4]);
    void calibrate_projector();
    bool is_calibrated() const { return calibration_.calibrated; }
    
    // Get current state for debugging
    DrawingState get_state() const { return state_; }
    const Point& get_start_point() const { return start_point_; }
    const Point& get_preview_end_point() const { return preview_end_point_; }
    bool has_preview() const { return state_ == DrawingState::START_CONFIRMED || 
                                      state_ == DrawingState::WAITING_FOR_END; }
    
private:
    Sketch sketch_;
    
    // Enterprise state machine
    DrawingState state_;
    Point start_point_;
    Point preview_end_point_;
    
    // Drawing parameters
    uint32_t current_color_;
    int current_thickness_;
    
    // Gesture confirmation tracking
    GestureConfirmation current_confirmation_;
    int required_confirmation_frames_;  // Default 5
    bool gesture_changed_since_start_;
    
    // High-precision smoothing for jitter reduction
    std::deque<Point> position_buffer_;
    int smoothing_window_;
    float jitter_threshold_;  // Minimum movement to register (prevents micro-jitter)
    
    // Enterprise rendering features
    bool anti_aliasing_enabled_;
    bool subpixel_rendering_;
    bool predictive_smoothing_;
    bool use_projector_calibration_;
    
    // Projector calibration
    ProjectorCalibration calibration_;
    
    // Statistics
    uint64_t last_line_timestamp_;
    
    // Helper functions
    Point get_smoothed_position();
    Point get_predictive_smoothed_position();
    Point apply_jitter_filter(const Point& new_pos, const Point& last_pos);
    Point apply_calibration(const Point& p) const;
    bool is_pointing_gesture(hand_detector::Gesture g) const {
        return g == hand_detector::Gesture::POINTING;
    }
    bool gesture_is_different(hand_detector::Gesture g1, hand_detector::Gesture g2) const {
        return g1 != g2 && g1 != hand_detector::Gesture::UNKNOWN && 
               g2 != hand_detector::Gesture::UNKNOWN;
    }
    
    void update_state_machine(const std::vector<hand_detector::HandDetection>& hands);
    void finalize_line();
    
    // Anti-aliased line drawing (Xiaolin Wu algorithm)
    void draw_aa_line(void* map, uint32_t stride, uint32_t width, uint32_t height,
                     const Point& p0, const Point& p1, uint32_t color, int thickness);
};

} // namespace sketch
