#include "pipeline.hpp"
#include <chrono>
#include <iostream>

using namespace std::chrono;

namespace pipeline
{

    Pipeline::Pipeline(const PipelineConfig &cfg,
                       hand_detector::DetectorConfig det_cfg,
                       hand_detector::ProductionConfig prod_cfg,
                       sketch::SketchPad &sketchpad)
        : config_(cfg), det_config_(det_cfg), prod_config_(prod_cfg), sketchpad_(sketchpad)
    {
        camera_ = std::make_unique<camera::Camera>();
        detector_ = std::make_unique<hand_detector::ProductionHandDetector>(det_cfg, prod_cfg);
        yuv_buffer_.resize(config_.camera_width * config_.camera_height * 3 / 2);
        rgb_buffer_.resize(config_.camera_width * config_.camera_height * 3);
        detect_buffer_.resize(config_.detect_width * config_.detect_height * 3);
    }

    Pipeline::~Pipeline() { stop(); }

    void Pipeline::start()
    {
        running_ = true;
        camera_thread_ = std::thread(&Pipeline::camera_thread_fn, this);
        preprocess_thread_ = std::thread(&Pipeline::preprocess_thread_fn, this);
        detect_thread_ = std::thread(&Pipeline::detect_thread_fn, this);
        draw_thread_ = std::thread(&Pipeline::draw_thread_fn, this);
    }

    void Pipeline::stop()
    {
        running_ = false;
        yuv_cv_.notify_all();
        rgb_cv_.notify_all();
        gesture_cv_.notify_all();
        if (camera_thread_.joinable())
            camera_thread_.join();
        if (preprocess_thread_.joinable())
            preprocess_thread_.join();
        if (detect_thread_.joinable())
            detect_thread_.join();
        if (draw_thread_.joinable())
            draw_thread_.join();
    }

    bool Pipeline::is_running() const { return running_; }

    void Pipeline::camera_thread_fn()
    {
        camera::CameraConfig cam_cfg;
        cam_cfg.width = config_.camera_width;
        cam_cfg.height = config_.camera_height;
        cam_cfg.framerate = config_.camera_fps;
        cam_cfg.verbose = config_.debug;
        camera_->init(cam_cfg);
        camera_->start();
        uint64_t last_ts = 0;
        while (running_)
        {
            auto t0 = steady_clock::now();
            camera::Frame *frame = camera_->capture_frame();
            if (!frame || !frame->data)
                continue;
            last_ts = frame->timestamp_ns;
            std::unique_lock<std::mutex> lock(yuv_mutex_);
            yuv_queue_.emplace(std::vector<uint8_t>(frame->data, frame->data + frame->size));
            lock.unlock();
            yuv_cv_.notify_one();
            // ...
        }
    }

    void Pipeline::preprocess_thread_fn()
    {
        // --- Change 1: Simple gamma correction (gamma=0.8 for hand contrast) ---
        auto gamma_correct = [](uint8_t *data, size_t size, float gamma)
        {
            float inv_gamma = 1.0f / gamma;
            for (size_t i = 0; i < size; ++i)
            {
                float norm = data[i] / 255.0f;
                data[i] = static_cast<uint8_t>(std::pow(norm, inv_gamma) * 255.0f);
            }
        };
        // --- Change 2: Bilinear downscaling for detection input ---
        auto resize_bilinear = [](const uint8_t *src, uint8_t *dst, int src_w, int src_h, int dst_w, int dst_h, int channels)
        {
            for (int y = 0; y < dst_h; ++y)
            {
                float src_y = (y + 0.5f) * src_h / dst_h - 0.5f;
                int y0 = static_cast<int>(std::floor(src_y));
                int y1 = std::min(y0 + 1, src_h - 1);
                float wy = src_y - y0;
                y0 = std::max(y0, 0);
                for (int x = 0; x < dst_w; ++x)
                {
                    float src_x = (x + 0.5f) * src_w / dst_w - 0.5f;
                    int x0 = static_cast<int>(std::floor(src_x));
                    int x1 = std::min(x0 + 1, src_w - 1);
                    float wx = src_x - x0;
                    x0 = std::max(x0, 0);
                    for (int c = 0; c < channels; ++c)
                    {
                        float v00 = src[(y0 * src_w + x0) * channels + c];
                        float v01 = src[(y0 * src_w + x1) * channels + c];
                        float v10 = src[(y1 * src_w + x0) * channels + c];
                        float v11 = src[(y1 * src_w + x1) * channels + c];
                        float v0 = v00 * (1 - wx) + v01 * wx;
                        float v1 = v10 * (1 - wx) + v11 * wx;
                        dst[(y * dst_w + x) * channels + c] = static_cast<uint8_t>(v0 * (1 - wy) + v1 * wy);
                    }
                }
            }
        };
        while (running_)
        {
            auto t0 = steady_clock::now();
            std::vector<uint8_t> yuv;
            {
                std::unique_lock<std::mutex> lock(yuv_mutex_);
                yuv_cv_.wait(lock, [&]
                             { return !yuv_queue_.empty() || !running_; });
                if (!running_)
                    break;
                yuv = std::move(yuv_queue_.front());
                yuv_queue_.pop();
            }
            camera::utils::yuv420_to_rgb888(yuv.data(), rgb_buffer_.data(), config_.camera_width, config_.camera_height);
            gamma_correct(rgb_buffer_.data(), rgb_buffer_.size(), 0.8f);
            resize_bilinear(rgb_buffer_.data(), detect_buffer_.data(),
                            config_.camera_width, config_.camera_height, config_.detect_width, config_.detect_height, 3);
            {
                std::unique_lock<std::mutex> lock(rgb_mutex_);
                rgb_queue_.emplace(std::vector<uint8_t>(detect_buffer_.begin(), detect_buffer_.end()));
            }
            rgb_cv_.notify_one();
            // ...
        }
    }

    void Pipeline::detect_thread_fn()
    {
        // --- Change 3: Increase smoothing window to 5 ---
        std::deque<std::vector<hand_detector::HandDetection>> smoothing_window;
        const size_t smooth_N = 5;
        // --- Change 4: Hold last valid detection for up to 3 frames ---
        std::vector<hand_detector::HandDetection> last_valid;
        int hold_last = 0;
        const int hold_last_max = 3;
        while (running_)
        {
            auto t0 = steady_clock::now();
            std::vector<uint8_t> rgb;
            {
                std::unique_lock<std::mutex> lock(rgb_mutex_);
                rgb_cv_.wait(lock, [&]
                             { return !rgb_queue_.empty() || !running_; });
                if (!running_)
                    break;
                rgb = std::move(rgb_queue_.front());
                rgb_queue_.pop();
            }
            camera::Frame frame;
            frame.data = rgb.data();
            frame.width = config_.detect_width;
            frame.height = config_.detect_height;
            frame.format = camera::PixelFormat::RGB888;
            frame.size = rgb.size();
            frame.stride = config_.detect_width * 3;
            frame.timestamp_ns = duration_cast<nanoseconds>(steady_clock::now().time_since_epoch()).count();

            // --- PALM-FIRST DETECTION PIPELINE ---
            std::vector<hand_detector::HandDetection> detections;
            std::vector<hand_detector::BoundingBox> palms = detector_->detect_palms(frame);
            if (!palms.empty()) {
                // For each palm, crop region and run landmark model
                for (const auto& palm : palms) {
                    // Crop palm region from frame (with margin)
                    int margin = 20;
                    int x = std::max(0, palm.x - margin);
                    int y = std::max(0, palm.y - margin);
                    int w = std::min(frame.width - x, palm.width + 2 * margin);
                    int h = std::min(frame.height - y, palm.height + 2 * margin);
                    camera::Frame palm_frame = frame;
                    std::vector<uint8_t> crop(w * h * 3);
                    for (int row = 0; row < h; ++row) {
                        std::memcpy(&crop[row * w * 3],
                                    &frame.data[((y + row) * frame.width + x) * 3],
                                    w * 3);
                    }
                    palm_frame.data = crop.data();
                    palm_frame.width = w;
                    palm_frame.height = h;
                    palm_frame.size = crop.size();
                    palm_frame.stride = w * 3;
                    // Run landmark model on palm region
                    auto hand_dets = detector_->detect(palm_frame);
                    for (auto& det : hand_dets) {
                        // Adjust landmark coordinates to full frame
                        for (auto& lm : det.landmarks) {
                            lm.x += x;
                            lm.y += y;
                        }
                        det.bbox.x += x;
                        det.bbox.y += y;
                        detections.push_back(det);
                    }
                }
            } else {
                // Fallback: run landmark model on full frame
                detections = detector_->detect(frame);
            }

            // --- Change 4: Hold last valid detection logic ---
            if (!detections.empty())
            {
                last_valid = detections;
                hold_last = 0;
            }
            else if (!last_valid.empty() && hold_last < hold_last_max)
            {
                detections = last_valid;
                hold_last++;
            }
            // --- Change 3: Smoothing window logic ---
            smoothing_window.push_back(detections);
            if (smoothing_window.size() > smooth_N)
                smoothing_window.pop_front();
            std::vector<hand_detector::HandDetection> smoothed;
            if (!smoothing_window.empty())
                smoothed = smoothing_window.back();
            {
                std::unique_lock<std::mutex> lock(gesture_mutex_);
                gesture_queue_.emplace(smoothed);
            }
            gesture_cv_.notify_one();
            // ...
        }
    }

    void Pipeline::draw_thread_fn()
    {
        using clock = steady_clock;
        auto next_frame = clock::now();
        const auto frame_period = milliseconds(33); // ~30 FPS
        size_t frame_count = 0;
        while (running_)
        {
            auto t0 = clock::now();
            std::vector<hand_detector::HandDetection> gestures;
            {
                std::unique_lock<std::mutex> lock(gesture_mutex_);
                if (gesture_queue_.empty())
                {
                    gesture_cv_.wait_for(lock, frame_period, [&]
                                         { return !gesture_queue_.empty() || !running_; });
                    if (!running_)
                        break;
                }
                if (!gesture_queue_.empty())
                {
                    gestures = std::move(gesture_queue_.front());
                    gesture_queue_.pop();
                }
            }
            sketchpad_.update(gestures);
            // ...
            next_frame += frame_period;
            std::this_thread::sleep_until(next_frame);
        }
    }

} // namespace pipeline
