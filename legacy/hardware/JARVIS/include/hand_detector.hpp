#pragma once

#include "camera.hpp"
#include "hand_detector_config.hpp"
#include <vector>
#include <string>
#include <cstdint>
#include <memory>

namespace hand_detector {

// Represents a 2D point
struct Point {
    int x;
    int y;
    
    Point() : x(0), y(0) {}
    Point(int x_, int y_) : x(x_), y(y_) {}
    
    // Distance to another point
    double distance(const Point& other) const;
};

// Arithmetic for averaging (needed for RingBuffer)
inline Point operator+(const Point& a, const Point& b) {
    return Point(a.x + b.x, a.y + b.y);
}
inline Point operator/(const Point& a, float val) {
    return Point(static_cast<int>(a.x / val), static_cast<int>(a.y / val));
}

// Represents a bounding box
struct BoundingBox {
    int x, y;          // Top-left corner
    int width, height; // Dimensions
    float confidence;  // Detection confidence (0.0 - 1.0)
    
    BoundingBox() : x(0), y(0), width(0), height(0), confidence(0.0f) {}
    
    // Get center point
    Point center() const { return Point(x + width/2, y + height/2); }
    
    // Get area
    int area() const { return width * height; }
};

// Hand gesture types
enum class Gesture {
    UNKNOWN,
    OPEN_PALM,      // All fingers extended
    FIST,           // All fingers closed
    POINTING,       // Index finger extended
    THUMBS_UP,      // Thumb up
    PEACE,          // Index and middle finger extended
    OK_SIGN,        // Thumb and index forming circle
    CUSTOM          // Custom gesture
};

// Detected hand information
struct HandDetection {
    BoundingBox bbox;           // Bounding box of hand
    Point center;               // Center of hand mass
    Gesture gesture;            // Detected gesture
    float gesture_confidence;   // Gesture classification confidence
    int num_fingers;            // Number of extended fingers detected
    uint32_t contour_area;      // Actual polygon area of contour
    std::vector<Point> contour; // Hand contour points (optional)
    std::vector<Point> fingertips; // Detected fingertip positions
    
    // Visualization request (for overlay)
    bool overlay_requested = true;
    
    HandDetection() : gesture(Gesture::UNKNOWN), 
                     gesture_confidence(0.0f), num_fingers(0), contour_area(0) {}
};

// Main hand detector class
class HandDetector {
public:
    HandDetector();
    explicit HandDetector(const DetectorConfig& config);
    ~HandDetector();
    
    // Initialize detector with configuration
    bool init(const DetectorConfig& config);
    
    // Detect hands in a frame
    // Returns vector of detected hands (may be empty)
    std::vector<HandDetection> detect(const camera::Frame& frame);
    
    // Update detector configuration
    void set_config(const DetectorConfig& config);
    
    // Get current configuration
    const DetectorConfig& get_config() const { return config_; }
    
    // Calibrate skin color from a region of interest
    // roi_x, roi_y, roi_w, roi_h: region containing skin
    bool calibrate_skin(const camera::Frame& frame, 
                       int roi_x, int roi_y, 
                       int roi_w, int roi_h);
    
    // Get statistics from last detection
    const DetectionStats& get_stats() const { return stats_; }
    
    // Reset statistics
    void reset_stats();
    
    // Gesture name string conversion
    static std::string gesture_to_string(Gesture g);
    static Gesture string_to_gesture(const std::string& s);
    
private:
    DetectorConfig config_;
    DetectionStats stats_;
    
    // Internal processing buffers
    std::vector<uint8_t> hsv_buffer_;
    std::vector<uint8_t> mask_buffer_;
    std::vector<uint8_t> gray_buffer_;
    std::vector<uint8_t> temp_buffer_;
    
    // Gesture history for stabilization
    std::vector<Gesture> gesture_history_;
    
    // Temporal tracking for false positive/negative reduction
    struct TrackedHand {
        BoundingBox last_bbox;
        int consecutive_frames;
        uint64_t last_seen_frame;
        float avg_confidence;
    };
    std::vector<TrackedHand> tracked_hands_;
    uint64_t current_frame_{0};
    
    // Internal processing functions
    void rgb_to_hsv(const uint8_t* rgb, uint8_t* hsv, 
                   uint32_t width, uint32_t height);
    
    void apply_skin_mask(const uint8_t* hsv, uint8_t* mask,
                        uint32_t width, uint32_t height);
    
    void morphological_operations(uint8_t* mask, 
                                 uint32_t width, uint32_t height);
    
    std::vector<std::vector<Point>> find_contours(const uint8_t* mask,
                                                   uint32_t width, uint32_t height);
    
    HandDetection analyze_contour(const std::vector<Point>& contour,
                                 uint32_t frame_width, uint32_t frame_height);
    
    Gesture classify_gesture(const HandDetection& hand);
    
    Gesture stabilize_gesture(Gesture current);
    
    int count_fingers(const std::vector<Point>& contour, const Point& center);
    
    std::vector<Point> find_fingertips(const std::vector<Point>& contour, 
                                       const Point& center);
    
    BoundingBox compute_bounding_box(const std::vector<Point>& contour);
    
    Point compute_centroid(const std::vector<Point>& contour);

    // Convex hull (monotonic chain) for robust fingertip detection
    std::vector<Point> compute_convex_hull(const std::vector<Point>& points);
    
    // IoU (Intersection over Union) for tracking
    float compute_iou(const BoundingBox& a, const BoundingBox& b);
    
    // Disable copy
    HandDetector(const HandDetector&) = delete;
    HandDetector& operator=(const HandDetector&) = delete;
};

// Utility functions
namespace utils {
    // Draw bounding box on RGB frame
    void draw_box(uint8_t* rgb, uint32_t width, uint32_t height,
                 const BoundingBox& box, 
                 uint8_t r, uint8_t g, uint8_t b);
    
    // Draw point on RGB frame
    void draw_point(uint8_t* rgb, uint32_t width, uint32_t height,
                   const Point& point, int radius,
                   uint8_t r, uint8_t g, uint8_t b);
    
    // Draw contour on RGB frame
    void draw_contour(uint8_t* rgb, uint32_t width, uint32_t height,
                     const std::vector<Point>& contour,
                     uint8_t r, uint8_t g, uint8_t b);
    
    // Draw text on RGB frame (simple bitmap font)
    void draw_text(uint8_t* rgb, uint32_t width, uint32_t height,
                  const std::string& text, int x, int y,
                  uint8_t r, uint8_t g, uint8_t b);
}

} // namespace hand_detector
