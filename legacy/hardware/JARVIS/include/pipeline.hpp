#pragma once
#include "camera.hpp"
#include "hand_detector.hpp"
#include "hand_detector_production.hpp"
#include "sketch_pad.hpp"
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <atomic>
#include <vector>
#include <memory>

namespace pipeline
{

    struct PipelineConfig
    {
        uint32_t camera_width = 640;
        uint32_t camera_height = 480;
        uint32_t camera_fps = 30;
        uint32_t detect_width = 224;
        uint32_t detect_height = 224;
        bool use_imx500 = true;
        bool debug = false;
    };

    class Pipeline
    {
    public:
        Pipeline(const PipelineConfig &cfg,
                 hand_detector::DetectorConfig det_cfg,
                 hand_detector::ProductionConfig prod_cfg,
                 sketch::SketchPad &sketchpad);
        ~Pipeline();
        void start();
        void stop();
        bool is_running() const;

    private:
        void camera_thread_fn();
        void preprocess_thread_fn();
        void detect_thread_fn();
        void draw_thread_fn();

        PipelineConfig config_;
        hand_detector::DetectorConfig det_config_;
        hand_detector::ProductionConfig prod_config_;
        sketch::SketchPad &sketchpad_;

        std::unique_ptr<camera::Camera> camera_;
        std::unique_ptr<hand_detector::ProductionHandDetector> detector_;

        // Buffers and queues
        std::vector<uint8_t> yuv_buffer_;
        std::vector<uint8_t> rgb_buffer_;
        std::vector<uint8_t> detect_buffer_;
        std::queue<std::vector<uint8_t>> yuv_queue_;
        std::queue<std::vector<uint8_t>> rgb_queue_;
        std::queue<std::vector<hand_detector::HandDetection>> gesture_queue_;

        std::mutex yuv_mutex_, rgb_mutex_, gesture_mutex_;
        std::condition_variable yuv_cv_, rgb_cv_, gesture_cv_;
        std::atomic<bool> running_{false};
        std::thread camera_thread_, preprocess_thread_, detect_thread_, draw_thread_;
    };

} // namespace pipeline
