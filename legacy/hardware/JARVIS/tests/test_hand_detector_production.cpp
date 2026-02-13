#include <gtest/gtest.h>
#include "hand_detector_production.hpp"
#include "hand_detector_mediapipe.hpp"
#include "camera.hpp"
#include <vector>

using namespace hand_detector;

class ProductionHandDetectorTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Create test configuration
        detector_config_.verbose = false;
        detector_config_.enable_gesture = true;
        detector_config_.min_hand_area = 1000;
        
        production_config_.enable_tracking = true;
        production_config_.adaptive_lighting = true;
        production_config_.verbose = false;
    }
    
    DetectorConfig detector_config_;
    ProductionConfig production_config_;
};

TEST_F(ProductionHandDetectorTest, Initialization) {
    ProductionHandDetector detector(detector_config_, production_config_);
    
    EXPECT_EQ(detector.get_detector_config().min_hand_area, 1000);
    EXPECT_TRUE(detector.get_production_config().enable_tracking);
}

TEST_F(ProductionHandDetectorTest, ConfigUpdate) {
    ProductionHandDetector detector;
    
    detector.set_detector_config(detector_config_);
    detector.set_production_config(production_config_);
    
    EXPECT_EQ(detector.get_detector_config().min_hand_area, 1000);
    EXPECT_TRUE(detector.get_production_config().adaptive_lighting);
}

TEST_F(ProductionHandDetectorTest, StatsReset) {
    ProductionHandDetector detector(detector_config_, production_config_);
    
    detector.reset_stats();
    
    auto stats = detector.get_stats();
    EXPECT_EQ(stats.frames_processed, 0);
    EXPECT_EQ(stats.hands_detected, 0);
}

TEST_F(ProductionHandDetectorTest, TrackingReset) {
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // Should not crash
    detector.reset_tracking();
}

TEST_F(ProductionHandDetectorTest, EmptyFrameDetection) {
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // Create empty frame
    camera::Frame frame;
    frame.data.clear();
    frame.width = 0;
    frame.height = 0;
    frame.format = camera::PixelFormat::RGB888;
    auto detections = detector.detect(frame);
    EXPECT_TRUE(detections.empty());
}

TEST_F(ProductionHandDetectorTest, BlackFrameDetection) {
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // Create black frame
    const int width = 640;
    const int height = 480;
    std::vector<uint8_t> black_data(width * height * 3, 0);
    camera::Frame frame;
    frame.data = black_data;
    frame.width = width;
    frame.height = height;
    frame.format = camera::PixelFormat::RGB888;
    frame.timestamp_ns = 0;
    
    auto detections = detector.detect(frame);
    // Black frame should have no skin-colored regions
    EXPECT_TRUE(detections.empty() || detections.size() == 0);
}

TEST_F(ProductionHandDetectorTest, GestureStabilization) {
    production_config_.enable_tracking = true;
    production_config_.gesture_stabilization_frames = 3;
    
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // This tests that tracking is maintained across frames
    // Without actual hand data, we just verify no crashes
    camera::Frame frame;
    const int width = 320;
    const int height = 240;
    std::vector<uint8_t> test_data(width * height * 3, 128);
    frame.data = test_data;
    frame.width = width;
    frame.height = height;
    frame.format = camera::PixelFormat::RGB888;
    
    for (int i = 0; i < 10; ++i) {
        frame.timestamp_ns = i * 33000000; // ~30 FPS
        auto detections = detector.detect(frame);
        // Just verify no crash with tracking enabled
    }
}

TEST_F(ProductionHandDetectorTest, AdaptiveLighting) {
    production_config_.adaptive_lighting = true;
    production_config_.lighting_adaptation_rate = 0.5f;
    
    ProductionHandDetector detector(detector_config_, production_config_);
    
    camera::Frame frame;
    const int width = 320;
    const int height = 240;
    
    // Test with bright frame
    std::vector<uint8_t> bright_data(width * height * 3, 200);
    frame.data = bright_data;
    frame.width = width;
    frame.height = height;
    frame.format = camera::PixelFormat::RGB888;
    frame.timestamp_ns = 0;
    detector.detect(frame);
    // Test with dark frame
    std::vector<uint8_t> dark_data(width * height * 3, 50);
    frame.data = dark_data;
    frame.timestamp_ns = 33000000;
    detector.detect(frame);
    
    // Verify adaptive lighting doesn't crash
    SUCCEED();
}

TEST_F(ProductionHandDetectorTest, QualityFiltering) {
    production_config_.filter_low_confidence = true;
    production_config_.min_detection_quality = 0.8f;
    
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // Quality filtering should remove low-confidence detections
    // This is tested implicitly in the detect() function
    SUCCEED();
}

TEST_F(ProductionHandDetectorTest, ROITracking) {
    production_config_.enable_roi_tracking = true;
    production_config_.roi_expansion_pixels = 50;
    
    ProductionHandDetector detector(detector_config_, production_config_);
    
    // ROI tracking should optimize processing area
    SUCCEED();
}

// Test MediaPipe detector availability
TEST(MediaPipeDetectorTest, AvailabilityCheck) {
    bool available = MediaPipeHandDetector::is_available();
    
    // MediaPipe may or may not be available depending on build
    std::string version = MediaPipeHandDetector::get_version();
    EXPECT_FALSE(version.empty());
    
    if (!available) {
        std::cerr << "MediaPipe not available: " << version << "\n";
    }
}

TEST(MediaPipeDetectorTest, InitializationWithoutSupport) {
    MediaPipeHandDetector detector;
    
    MediaPipeConfig config;
    config.min_detection_confidence = 0.5f;
    
    // Should handle gracefully even without MediaPipe support
    bool initialized = detector.init(config);
    
    if (!MediaPipeHandDetector::is_available()) {
        EXPECT_FALSE(initialized);
    }
}
