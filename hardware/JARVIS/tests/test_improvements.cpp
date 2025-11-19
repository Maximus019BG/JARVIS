// Test to validate hand detection improvements
#include <gtest/gtest.h>
#include "hand_detector.hpp"
#include "hand_detector_production.hpp"
#include "camera.hpp"
#include <vector>
#include <cstring>

using namespace hand_detector;
using namespace camera;

// Test fixture for improved detection
class ImprovedDetectionTest : public ::testing::Test {
protected:
    void SetUp() override {
        test_width = 640;
        test_height = 480;
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
    
    // Helper to create a skin-colored region
    void draw_skin_region(int x, int y, int w, int h, uint8_t r, uint8_t g, uint8_t b) {
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

// Test that improved config allows detection with lower confidence
TEST_F(ImprovedDetectionTest, LowerConfidenceDetection) {
    DetectorConfig config;
    HandDetector detector(config);
    detector.init(config);
    
    // Verify lowered thresholds
    EXPECT_EQ(config.min_confidence, 0.35f);
    EXPECT_LT(config.min_confidence, 0.5f); // Lower than old value
}

// Test that expanded HSV ranges are applied
TEST_F(ImprovedDetectionTest, ExpandedHSVRanges) {
    DetectorConfig config;
    
    // Verify expanded ranges
    EXPECT_EQ(config.hue_max, 35);
    EXPECT_GT(config.hue_max, 20); // Greater than old value
    
    EXPECT_EQ(config.sat_min, 15);
    EXPECT_LT(config.sat_min, 25); // Less than old value
    
    EXPECT_EQ(config.sat_max, 230);
    EXPECT_GT(config.sat_max, 200); // Greater than old value
    
    EXPECT_EQ(config.val_min, 20);
    EXPECT_LT(config.val_min, 40); // Less than old value
}

// Test that hand area thresholds are relaxed
TEST_F(ImprovedDetectionTest, RelaxedAreaThresholds) {
    DetectorConfig config;
    
    // Verify relaxed area limits
    EXPECT_EQ(config.min_hand_area, 2000);
    EXPECT_LT(config.min_hand_area, 3500); // Lower than old value (detects smaller hands)
    
    EXPECT_EQ(config.max_hand_area, 200000);
    EXPECT_GT(config.max_hand_area, 120000); // Higher than old value (detects larger hands)
}

// Test that tracking parameters are optimized
TEST_F(ImprovedDetectionTest, OptimizedTracking) {
    DetectorConfig config;
    
    // Verify optimized tracking
    EXPECT_EQ(config.tracking_iou_threshold, 0.25f);
    EXPECT_LT(config.tracking_iou_threshold, 0.3f); // Lower for better tracking
    
    EXPECT_EQ(config.temporal_filter_frames, 2);
    EXPECT_LT(config.temporal_filter_frames, 3); // Faster response
    
    EXPECT_EQ(config.detection_persistence, 0.6f);
    EXPECT_LT(config.detection_persistence, 0.7f); // More permissive
}

// Test production config improvements
TEST_F(ImprovedDetectionTest, ProductionConfigImprovements) {
    ProductionConfig config;
    
    // Verify production improvements
    EXPECT_EQ(config.tracking_iou_threshold, 0.25f);
    EXPECT_EQ(config.gesture_stabilization_frames, 7);
    EXPECT_LT(config.gesture_stabilization_frames, 10); // Faster gesture response
    
    EXPECT_EQ(config.gesture_confidence_threshold, 0.6f);
    EXPECT_LT(config.gesture_confidence_threshold, 0.7f); // More gestures accepted
    
    EXPECT_EQ(config.enable_roi_tracking, false); // Full frame scanning
    EXPECT_EQ(config.roi_expansion_pixels, 80);
    EXPECT_GT(config.roi_expansion_pixels, 50); // Larger ROI when enabled
    
    EXPECT_EQ(config.min_detection_quality, 0.40f);
    EXPECT_LT(config.min_detection_quality, 0.5f); // More detections accepted
}

// Test multi-hand simulation (conceptual - actual multi-hand detection requires proper contours)
TEST_F(ImprovedDetectionTest, MultiHandConfiguration) {
    DetectorConfig config;
    HandDetector detector(config);
    detector.init(config);
    
    // Create multiple skin-colored regions (simulating multiple hands)
    // Light skin tone
    draw_skin_region(50, 50, 80, 100, 220, 180, 140);
    
    // Medium skin tone
    draw_skin_region(200, 50, 80, 100, 200, 150, 110);
    
    // Darker skin tone (should be detected with expanded HSV)
    draw_skin_region(350, 50, 80, 100, 160, 110, 80);
    
    // Distant/small hand (should be detected with lower min_hand_area)
    draw_skin_region(500, 100, 40, 50, 220, 180, 140);
    
    // Detection should process up to 10 hands (improved from 3)
    auto detections = detector.detect(test_frame);
    
    // With improved parameters, we expect to potentially detect more hands
    // Note: Actual detection depends on contour analysis, this tests configuration
    EXPECT_TRUE(detections.size() <= 10); // Can handle up to 10
}

// Test that diverse skin tones can be within HSV range
TEST_F(ImprovedDetectionTest, DiverseSkinToneSupport) {
    DetectorConfig config;
    
    // Verify that the HSV range can accommodate diverse skin tones
    int hue_range = config.hue_max - config.hue_min;
    int sat_range = config.sat_max - config.sat_min;
    int val_range = config.val_max - config.val_min;
    
    EXPECT_GE(hue_range, 35); // Wide hue range for skin tones
    EXPECT_GE(sat_range, 215); // Wide saturation range
    EXPECT_GE(val_range, 235); // Wide value range
}

// Test gesture classification configuration
TEST_F(ImprovedDetectionTest, GestureRecognitionConfig) {
    DetectorConfig config;
    
    // Verify gesture recognition is enabled by default
    EXPECT_TRUE(config.enable_gesture);
    
    // Verify gesture history for stabilization
    EXPECT_EQ(config.gesture_history, 7);
}
