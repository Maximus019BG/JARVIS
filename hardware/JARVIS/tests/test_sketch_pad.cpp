#include <gtest/gtest.h>
#include "sketch_pad.hpp"
#include <fstream>

using namespace sketch;

class SketchPadTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Clean up any test files
        std::remove("test_sketch.jarvis");
    }
    
    void TearDown() override {
        // Clean up test files
        std::remove("test_sketch.jarvis");
    }
};

TEST_F(SketchPadTest, Initialization) {
    SketchPad pad(640, 480);
    pad.init("test", 640, 480);
    
    EXPECT_EQ(pad.get_stroke_count(), 0);
    EXPECT_EQ(pad.get_total_points(), 0);
}

TEST_F(SketchPadTest, SketchSaveAndLoad) {
    Sketch sketch;
    sketch.name = "test_sketch";
    sketch.width = 640;
    sketch.height = 480;
    
    // Add a stroke
    Stroke stroke;
    stroke.color = 0x00FFFFFF;
    stroke.thickness = 5;
    stroke.points.push_back(Point(10, 10));
    stroke.points.push_back(Point(20, 20));
    stroke.points.push_back(Point(30, 30));
    sketch.strokes.push_back(stroke);
    
    // Save
    ASSERT_TRUE(sketch.save("test_sketch"));
    
    // Verify file exists
    std::ifstream file("test_sketch.jarvis");
    ASSERT_TRUE(file.good());
    file.close();
    
    // Load
    Sketch loaded;
    ASSERT_TRUE(loaded.load("test_sketch"));
    
    // Verify
    EXPECT_EQ(loaded.name, "test_sketch");
    EXPECT_EQ(loaded.width, 640);
    EXPECT_EQ(loaded.height, 480);
    EXPECT_EQ(loaded.strokes.size(), 1);
    EXPECT_EQ(loaded.strokes[0].points.size(), 3);
    EXPECT_EQ(loaded.strokes[0].color, 0x00FFFFFF);
    EXPECT_EQ(loaded.strokes[0].thickness, 5);
}

TEST_F(SketchPadTest, JSONSerialization) {
    Sketch sketch;
    sketch.name = "test";
    sketch.width = 100;
    sketch.height = 200;
    
    Stroke stroke;
    stroke.color = 0x00FF0000;
    stroke.thickness = 3;
    stroke.points.push_back(Point(1, 2));
    stroke.points.push_back(Point(3, 4));
    sketch.strokes.push_back(stroke);
    
    std::string json = sketch.to_json();
    
    // Verify JSON contains expected data
    EXPECT_NE(json.find("\"name\": \"test\""), std::string::npos);
    EXPECT_NE(json.find("\"width\": 100"), std::string::npos);
    EXPECT_NE(json.find("\"height\": 200"), std::string::npos);
    EXPECT_NE(json.find("\"color\": 16711680"), std::string::npos); // 0x00FF0000
    EXPECT_NE(json.find("\"thickness\": 3"), std::string::npos);
}

TEST_F(SketchPadTest, ClearSketch) {
    SketchPad pad(640, 480);
    pad.init("test", 640, 480);
    
    // Manually add a stroke to simulate drawing
    // (In real usage, update() would be called with hand detections)
    
    pad.clear();
    EXPECT_EQ(pad.get_stroke_count(), 0);
    EXPECT_EQ(pad.get_total_points(), 0);
}

TEST_F(SketchPadTest, ColorAndThickness) {
    SketchPad pad(640, 480);
    pad.set_color(0x00FF00FF);
    pad.set_thickness(10);
    
    // Settings are stored, actual use happens in update()
    SUCCEED();
}

TEST_F(SketchPadTest, UpdateWithNoHands) {
    SketchPad pad(640, 480);
    pad.init("test", 640, 480);
    
    std::vector<hand_detector::HandDetection> empty_detections;
    bool is_drawing = pad.update(empty_detections);
    
    EXPECT_FALSE(is_drawing);
}

TEST_F(SketchPadTest, FileExtensionHandling) {
    Sketch sketch;
    sketch.name = "test";
    
    // Save without extension
    ASSERT_TRUE(sketch.save("test_sketch"));
    
    // Verify .jarvis extension was added
    std::ifstream file("test_sketch.jarvis");
    ASSERT_TRUE(file.good());
    file.close();
    
    // Load without extension
    Sketch loaded;
    ASSERT_TRUE(loaded.load("test_sketch"));
}
