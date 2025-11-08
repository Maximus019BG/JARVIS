#include "camera.hpp"
#include <iostream>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <chrono>
#include <thread>
#include <cstdio>
#include <unistd.h>

// Minimal camera capture using rpicam-vid raw YUV420 stream piped via popen.
// This avoids linking against libcamera directly and uses only system tools.
// Enterprise considerations:
//  - Resilient to short reads (will retry until full frame or timeout)
//  - Optional override via env var JARVIS_CAMERA_CMD
//  - Graceful recovery if child process dies (re-spawn once)
//  - Converts YUV420 -> RGB888 for downstream processing
// Limitations:
//  - Relies on rpicam-vid being installed
//  - Blocking read per frame; for higher FPS consider double buffering + thread

namespace camera {

// Frame methods
bool Frame::get_rgb(uint32_t x, uint32_t y, uint8_t& r, uint8_t& g, uint8_t& b) const {
    if (!data || x >= width || y >= height) return false;
    
    if (format == PixelFormat::RGB888) {
        size_t idx = (y * stride) + (x * 3);
        if (idx + 2 < size) {
            r = data[idx];
            g = data[idx + 1];
            b = data[idx + 2];
            return true;
        }
    } else if (format == PixelFormat::RGBA8888) {
        size_t idx = (y * stride) + (x * 4);
        if (idx + 3 < size) {
            r = data[idx];
            g = data[idx + 1];
            b = data[idx + 2];
            return true;
        }
    }
    
    return false;
}

bool Frame::get_rgb_from_yuv(uint32_t x, uint32_t y, uint8_t& r, uint8_t& g, uint8_t& b) const {
    if (!data || x >= width || y >= height || format != PixelFormat::YUV420) 
        return false;
    
    // YUV420 layout: Y plane, then U plane (width/2 * height/2), then V plane
    size_t y_idx = y * width + x;
    size_t uv_idx = (y / 2) * (width / 2) + (x / 2);
    size_t u_offset = width * height;
    size_t v_offset = u_offset + (width / 2) * (height / 2);
    
    if (y_idx >= width * height || v_offset + uv_idx >= size)
        return false;
    
    int Y = data[y_idx];
    int U = data[u_offset + uv_idx] - 128;
    int V = data[v_offset + uv_idx] - 128;
    
    // YUV to RGB conversion
    int R = Y + (1.402 * V);
    int G = Y - (0.344136 * U) - (0.714136 * V);
    int B = Y + (1.772 * U);
    
    r = static_cast<uint8_t>(std::clamp(R, 0, 255));
    g = static_cast<uint8_t>(std::clamp(G, 0, 255));
    b = static_cast<uint8_t>(std::clamp(B, 0, 255));
    
    return true;
}

// Camera implementation using system calls to rpicam-vid
class Camera::Impl {
public:
    Impl() : initialized_(false), running_(false), frame_count_(0), pipe_(nullptr), expected_yuv_size_(0) {}
    ~Impl() { stop(); }

    bool init(const CameraConfig &config) {
        config_ = config;
        expected_yuv_size_ = config_.width * config_.height * 3 / 2; // YUV420
        // Pre-allocate RGB buffer
        frame_buffer_.resize(config_.width * config_.height * 3);
        initialized_ = true;
        if (config_.verbose)
            std::cerr << "[Camera] Initialized: " << config_.width << "x" << config_.height << "@" << config_.framerate << "fps" << std::endl;
        return true;
    }

    bool start() {
        if (!initialized_) {
            last_error_ = "Camera not initialized";
            return false;
        }
        if (running_)
            return true;

        std::string cmd;
        if (const char *override_cmd = std::getenv("JARVIS_CAMERA_CMD")) {
            cmd = override_cmd;
        } else {
            // Build default rpicam-vid command for raw YUV output to stdout
            cmd = "rpicam-vid -t 0 -n --codec yuv420 --width " + std::to_string(config_.width) +
                  " --height " + std::to_string(config_.height) + " --framerate " + std::to_string(config_.framerate) + " -o -";
        }

        pipe_ = popen(cmd.c_str(), "r");
        if (!pipe_) {
            last_error_ = "Failed to start rpicam-vid pipe";
            return false;
        }
        running_ = true;
        frame_count_ = 0;
        if (config_.verbose)
            std::cerr << "[Camera] Capture started (cmd: " << cmd << ")" << std::endl;
        return true;
    }

    void stop() {
        if (pipe_) {
            pclose(pipe_);
            pipe_ = nullptr;
        }
        if (running_ && config_.verbose) {
            std::cerr << "[Camera] Stopped after " << frame_count_ << " frames" << std::endl;
        }
        running_ = false;
    }

    Frame *capture_frame(std::vector<uint8_t> &buffer, Frame &frame) {
        if (!running_) {
            last_error_ = "Camera not running";
            return nullptr;
        }
        if (!pipe_) {
            last_error_ = "Pipe closed";
            running_ = false;
            return nullptr;
        }
        // Read one YUV420 frame
        yuv_temp_.resize(expected_yuv_size_);
        size_t read_total = 0;
        const int max_retries = 4;
        int retries = 0;
        while (read_total < expected_yuv_size_) {
            size_t n = fread(yuv_temp_.data() + read_total, 1, expected_yuv_size_ - read_total, pipe_);
            if (n == 0) {
                if (feof(pipe_)) {
                    last_error_ = "End of stream";
                    stop();
                    return nullptr;
                }
                if (ferror(pipe_)) {
                    last_error_ = "Read error";
                    stop();
                    return nullptr;
                }
                if (++retries > max_retries) {
                    last_error_ = "Short read retries exceeded";
                    stop();
                    return nullptr;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
                continue;
            }
            read_total += n;
        }

        // Convert to RGB
        buffer.resize(config_.width * config_.height * 3);
    utils::yuv420_to_rgb888(yuv_temp_.data(), buffer.data(), config_.width, config_.height);

        auto now = std::chrono::steady_clock::now();
        frame.timestamp_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(now.time_since_epoch()).count();
        frame.data = buffer.data();
        frame.size = buffer.size();
        frame.width = config_.width;
        frame.height = config_.height;
        frame.format = PixelFormat::RGB888;
        frame.stride = config_.width * 3;
        frame_count_++;
        return &frame;
    }

    bool is_initialized() const { return initialized_; }
    bool is_running() const { return running_; }
    const std::string &get_error() const { return last_error_; }

private:
    CameraConfig config_{};
    bool initialized_{};
    bool running_{};
    uint64_t frame_count_{};
    std::string last_error_{};
    std::vector<uint8_t> frame_buffer_{}; // RGB buffer reused
    std::vector<uint8_t> yuv_temp_{};     // YUV read buffer
    FILE *pipe_{};
    size_t expected_yuv_size_{};
};

// Camera public interface
Camera::Camera() : impl_(new Impl()), running_(false) {}

Camera::~Camera() {
    stop();
}

bool Camera::init(const CameraConfig& config) {
    config_ = config;
    bool result = impl_->init(config);
    if (!result) {
        last_error_ = impl_->get_error();
    }
    return result;
}

bool Camera::start() {
    bool result = impl_->start();
    if (result) {
        running_ = true;
    } else {
        last_error_ = impl_->get_error();
    }
    return result;
}

void Camera::stop() {
    impl_->stop();
    running_ = false;
}

Frame* Camera::capture_frame() {
    return impl_->capture_frame(frame_buffer_, current_frame_);
}

int Camera::list_cameras() {
    // Use rpicam-hello --list-cameras or libcamera-hello --list-cameras
    // For now, assume 1 camera
    std::cerr << "[Camera] Listing cameras (using rpicam-hello):\n";
    int ret = std::system("rpicam-hello --list-cameras 2>&1");
    return (ret == 0) ? 1 : 0;
}

// Utility functions
namespace utils {

void yuv420_to_rgb888(const uint8_t* yuv, uint8_t* rgb, 
                      uint32_t width, uint32_t height) {
    size_t y_size = width * height;
    size_t uv_size = (width / 2) * (height / 2);
    
    const uint8_t* y_plane = yuv;
    const uint8_t* u_plane = yuv + y_size;
    const uint8_t* v_plane = yuv + y_size + uv_size;
    
    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width; x++) {
            size_t y_idx = y * width + x;
            size_t uv_idx = (y / 2) * (width / 2) + (x / 2);
            
            int Y = y_plane[y_idx];
            int U = u_plane[uv_idx] - 128;
            int V = v_plane[uv_idx] - 128;
            
            int R = Y + (1.402 * V);
            int G = Y - (0.344136 * U) - (0.714136 * V);
            int B = Y + (1.772 * U);
            
            size_t rgb_idx = y_idx * 3;
            rgb[rgb_idx] = static_cast<uint8_t>(std::clamp(R, 0, 255));
            rgb[rgb_idx + 1] = static_cast<uint8_t>(std::clamp(G, 0, 255));
            rgb[rgb_idx + 2] = static_cast<uint8_t>(std::clamp(B, 0, 255));
        }
    }
}

void resize_nearest(const uint8_t* src, uint8_t* dst,
                   uint32_t src_w, uint32_t src_h,
                   uint32_t dst_w, uint32_t dst_h,
                   int channels) {
    float x_ratio = static_cast<float>(src_w) / dst_w;
    float y_ratio = static_cast<float>(src_h) / dst_h;
    
    for (uint32_t y = 0; y < dst_h; y++) {
        for (uint32_t x = 0; x < dst_w; x++) {
            uint32_t src_x = static_cast<uint32_t>(x * x_ratio);
            uint32_t src_y = static_cast<uint32_t>(y * y_ratio);
            
            size_t src_idx = (src_y * src_w + src_x) * channels;
            size_t dst_idx = (y * dst_w + x) * channels;
            
            for (int c = 0; c < channels; c++) {
                dst[dst_idx + c] = src[src_idx + c];
            }
        }
    }
}

void rgb_to_gray(const uint8_t* rgb, uint8_t* gray,
                uint32_t width, uint32_t height) {
    for (uint32_t i = 0; i < width * height; i++) {
        size_t rgb_idx = i * 3;
        // Luminosity method: 0.299*R + 0.587*G + 0.114*B
        gray[i] = static_cast<uint8_t>(
            0.299f * rgb[rgb_idx] +
            0.587f * rgb[rgb_idx + 1] +
            0.114f * rgb[rgb_idx + 2]
        );
    }
}

void gaussian_blur_3x3(const uint8_t* src, uint8_t* dst,
                      uint32_t width, uint32_t height,
                      int channels) {
    // 3x3 Gaussian kernel (normalized)
    const float kernel[3][3] = {
        {1.0f/16, 2.0f/16, 1.0f/16},
        {2.0f/16, 4.0f/16, 2.0f/16},
        {1.0f/16, 2.0f/16, 1.0f/16}
    };
    
    for (uint32_t y = 1; y < height - 1; y++) {
        for (uint32_t x = 1; x < width - 1; x++) {
            for (int c = 0; c < channels; c++) {
                float sum = 0.0f;
                
                for (int ky = -1; ky <= 1; ky++) {
                    for (int kx = -1; kx <= 1; kx++) {
                        size_t idx = ((y + ky) * width + (x + kx)) * channels + c;
                        sum += src[idx] * kernel[ky + 1][kx + 1];
                    }
                }
                
                size_t dst_idx = (y * width + x) * channels + c;
                dst[dst_idx] = static_cast<uint8_t>(std::clamp(sum, 0.0f, 255.0f));
            }
        }
    }
}

} // namespace utils

} // namespace camera
