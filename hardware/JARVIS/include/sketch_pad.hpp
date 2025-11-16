#pragma once

#include "hand_detector.hpp"
#include <vector>
#include <string>
#include <deque>

namespace sketch {

// A point in the drawing
struct Point {
    int x, y;
    Point() : x(0), y(0) {}
    Point(int x_, int y_) : x(x_), y(y_) {}
};

// A stroke (continuous line)
struct Stroke {
    std::vector<Point> points;
    uint32_t color;
    int thickness;
    
    Stroke() : color(0x00FFFFFF), thickness(3) {}
};

// A complete sketch with metadata
struct Sketch {
    std::string name;
    std::vector<Stroke> strokes;
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

// Drawing state machine
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
    
    // Render sketch to buffer
    void render(void* map, uint32_t stride, uint32_t width, uint32_t height);
    
    // Get statistics
    int get_stroke_count() const { return sketch_.strokes.size(); }
    int get_total_points() const;
    
    // Drawing parameters
    void set_color(uint32_t color) { current_color_ = color; }
    void set_thickness(int thickness) { current_thickness_ = thickness; }
    
private:
    Sketch sketch_;
    
    // Current stroke being drawn
    Stroke current_stroke_;
    bool is_drawing_;
    
    // Drawing parameters
    uint32_t current_color_;
    int current_thickness_;
    
    // Smoothing - track recent positions
    std::deque<Point> recent_points_;
    int smoothing_window_;
    
    // State tracking
    Point last_point_;
    int frames_since_last_point_;
    
    // Gesture state
    bool was_pointing_;
    
    // Helper functions
    Point get_smoothed_point();
    bool should_add_point(const Point& new_point);
    void finish_current_stroke();
};

} // namespace sketch
