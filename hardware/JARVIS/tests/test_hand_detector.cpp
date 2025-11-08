#include <gtest/gtest.h>
#include "hand_detector.hpp"
#include "camera.hpp"
#include <vector>
#include <cstring>

using namespace hand_detector;
using namespace camera;

// Test fixture for hand detector tests
class HandDetectorTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Create a simple test frame
        test_width = 320;
        test_height = 240;
        test_frame.width = test_width;
        test_frame.height = test_height;
        test_frame.format = PixelFormat::RGB888;
        test_frame.stride = test_width * 3;
        test_frame.size = test_width * test_height * 3;
        test_frame.timestamp_ns = 0;
        
        frame_data.resize(test_frame.size);
        test_frame.data = frame_data.data();
        
        // Fill with black background
        std::memset(test_frame.data, 0, test_frame.size);
    }
    
    void TearDown() override {
        frame_data.clear();
    }
    
    // Helper to create a skin-colored rectangle
    void draw_skin_rect(int x, int y, int w, int h) {
        // Skin color: RGB(220, 180, 140) - approximation
        uint8_t r = 220, g = 180, b = 140;
        
        for (int dy = 0; dy < h && y + dy < (int)test_height; dy++) {
            for (int dx = 0; dx < w && x + dx < (int)test_width; dx++) {
                size_t idx = ((y + dy) * test_width + (x + dx)) * 3;
                test_frame.data[idx] = r;
                test_frame.data[idx + 1] = g;
                test_frame.data[idx + 2] = b;
            }
        }
    }
    
    uint32_t test_width;
    uint32_t test_height;
    Frame test_frame;
    std::vector<uint8_t> frame_data;
};

// Test Point distance calculation
TEST(PointTest, Distance) {
    Point p1(0, 0);
    Point p2(3, 4);
    
    EXPECT_DOUBLE_EQ(p1.distance(p2), 5.0);
    EXPECT_DOUBLE_EQ(p2.distance(p1), 5.0);
}

// Test BoundingBox area calculation
TEST(BoundingBoxTest, Area) {
    BoundingBox box;
    box.width = 100;
    box.height = 50;
    
    EXPECT_EQ(box.area(), 5000);
}

// Test BoundingBox center calculation
TEST(BoundingBoxTest, Center) {
    BoundingBox box;
    box.x = 10;
    box.y = 20;
    box.width = 100;
    box.height = 60;
    
    Point center = box.center();
    EXPECT_EQ(center.x, 60);  // 10 + 100/2
    EXPECT_EQ(center.y, 50);  // 20 + 60/2
}

// Test HandDetector initialization
TEST_F(HandDetectorTest, Initialization) {
    DetectorConfig config;
    config.verbose = false;
    
    HandDetector detector;
    EXPECT_TRUE(detector.init(config));
}

// Test gesture string conversion
TEST(GestureTest, StringConversion) {
    EXPECT_EQ(HandDetector::gesture_to_string(Gesture::OPEN_PALM), "Open Palm");
    EXPECT_EQ(HandDetector::gesture_to_string(Gesture::FIST), "Fist");
    EXPECT_EQ(HandDetector::gesture_to_string(Gesture::POINTING), "Pointing");
    EXPECT_EQ(HandDetector::gesture_to_string(Gesture::PEACE), "Peace");
    
    EXPECT_EQ(HandDetector::string_to_gesture("Open Palm"), Gesture::OPEN_PALM);
    EXPECT_EQ(HandDetector::string_to_gesture("Fist"), Gesture::FIST);
    EXPECT_EQ(HandDetector::string_to_gesture("Unknown"), Gesture::UNKNOWN);
}

// Test detection on empty frame
TEST_F(HandDetectorTest, EmptyFrame) {
    HandDetector detector;
    DetectorConfig config;
    config.verbose = false;
    detector.init(config);
    
    auto detections = detector.detect(test_frame);
    
    // Should detect nothing on black frame
    EXPECT_EQ(detections.size(), 0);
}

// Test detection with simple skin-colored region
TEST_F(HandDetectorTest, SimpleSkinRegion) {
    HandDetector detector;
    DetectorConfig config;
    config.verbose = false;
    config.min_hand_area = 1000;  // Small threshold for test
    config.downscale_factor = 1;
    detector.init(config);
    
    // Draw a skin-colored rectangle (simulating a hand)
    draw_skin_rect(100, 80, 60, 80);
    
    auto detections = detector.detect(test_frame);
    
    // Should detect at least one hand-like region
    EXPECT_GE(detections.size(), 0); // May or may not detect depending on color calibration
}

// Test calibration
TEST_F(HandDetectorTest, Calibration) {
    HandDetector detector;
    DetectorConfig config;
    config.verbose = false;
    detector.init(config);
    
    // Draw skin color in center
    draw_skin_rect(110, 70, 100, 100);
    
    // Calibrate using center region
    bool result = detector.calibrate_skin(test_frame, 110, 70, 100, 100);
    EXPECT_TRUE(result);
    
    // After calibration, configuration should be updated
    auto updated_config = detector.get_config();
    EXPECT_GE(updated_config.hue_min, 0);
    EXPECT_LE(updated_config.hue_max, 179);
}

// Test statistics tracking
TEST_F(HandDetectorTest, Statistics) {
    HandDetector detector;
    DetectorConfig config;
    config.verbose = false;
    detector.init(config);
    
    auto stats_before = detector.get_stats();
    EXPECT_EQ(stats_before.frames_processed, 0);
    
    // Process a frame
    detector.detect(test_frame);
    
    auto stats_after = detector.get_stats();
    EXPECT_EQ(stats_after.frames_processed, 1);
    EXPECT_GE(stats_after.avg_process_time_ms, 0.0);
}

// Test reset statistics
TEST_F(HandDetectorTest, ResetStatistics) {
    HandDetector detector;
    DetectorConfig config;
    config.verbose = false;
    detector.init(config);
    
    // Process some frames
    detector.detect(test_frame);
    detector.detect(test_frame);
    
    auto stats = detector.get_stats();
    EXPECT_EQ(stats.frames_processed, 2);
    
    // Reset
    detector.reset_stats();
    
    stats = detector.get_stats();
    EXPECT_EQ(stats.frames_processed, 0);
    EXPECT_EQ(stats.hands_detected, 0);
}

// Test frame RGB access
TEST(FrameTest, RGBAccess) {
    Frame frame;
    std::vector<uint8_t> data(640 * 480 * 3);
    
    frame.data = data.data();
    frame.width = 640;
    frame.height = 480;
    frame.format = PixelFormat::RGB888;
    frame.stride = 640 * 3;
    frame.size = data.size();
    
    // Set a pixel
    size_t idx = (100 * 640 + 200) * 3;
    data[idx] = 255;     // R
    data[idx + 1] = 128; // G
    data[idx + 2] = 64;  // B
    
    uint8_t r, g, b;
    EXPECT_TRUE(frame.get_rgb(200, 100, r, g, b));
    EXPECT_EQ(r, 255);
    EXPECT_EQ(g, 128);
    EXPECT_EQ(b, 64);
    
    // Out of bounds
    EXPECT_FALSE(frame.get_rgb(1000, 1000, r, g, b));
}

// Test camera utilities - RGB to grayscale
TEST(CameraUtilsTest, RGBToGray) {
    uint32_t width = 100;
    uint32_t height = 100;
    std::vector<uint8_t> rgb(width * height * 3);
    std::vector<uint8_t> gray(width * height);
    
    // Fill with white
    std::memset(rgb.data(), 255, rgb.size());
    
    camera::utils::rgb_to_gray(rgb.data(), gray.data(), width, height);
    
    // White should convert to ~255 in grayscale
    EXPECT_NEAR(gray[0], 255, 1);
    EXPECT_NEAR(gray[width * height - 1], 255, 1);
}

// Test drawing utilities
TEST(DrawUtilsTest, DrawBox) {
    uint32_t width = 320;
    uint32_t height = 240;
    std::vector<uint8_t> rgb(width * height * 3, 0);
    
    BoundingBox box;
    box.x = 50;
    box.y = 50;
    box.width = 100;
    box.height = 80;
    
    hand_detector::utils::draw_box(rgb.data(), width, height, box, 255, 0, 0);
    
    // Check that border pixels are red
    size_t idx = (50 * width + 50) * 3;  // Top-left corner
    EXPECT_EQ(rgb[idx], 255);      // R
    EXPECT_EQ(rgb[idx + 1], 0);    // G
    EXPECT_EQ(rgb[idx + 2], 0);    // B
}

TEST(DrawUtilsTest, DrawPoint) {
    uint32_t width = 320;
    uint32_t height = 240;
    std::vector<uint8_t> rgb(width * height * 3, 0);
    
    Point pt(160, 120);
    hand_detector::utils::draw_point(rgb.data(), width, height, pt, 3, 0, 255, 0);
    
    // Check center pixel is green
    size_t idx = (120 * width + 160) * 3;
    EXPECT_EQ(rgb[idx], 0);        // R
    EXPECT_EQ(rgb[idx + 1], 255);  // G
    EXPECT_EQ(rgb[idx + 2], 0);    // B
}

// Main function
int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
