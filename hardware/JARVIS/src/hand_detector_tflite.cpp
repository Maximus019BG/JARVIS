/**
 * @file hand_detector_tflite.cpp
 * @brief Enterprise-grade TensorFlow Lite hand pose detection
 *
 * Based on MediaPipe hand landmark detection with 21-point hand tracking.
 * Optimized for Raspberry Pi 5 with IMX500 camera acceleration.
 *
 * Features:
 * - 21-point hand landmark detection
 * - Finger counting and gesture recognition
 * - Pointing gesture detection with fingertip tracking
 * - Temporal smoothing and jitter reduction
 * - Hardware acceleration support (XNNPACK, GPU delegates)
 * - Production-ready error handling and logging
 *
 * @author JARVIS Team
 * @date 2024
 */

#include "hand_detector_tflite.hpp"
#include <iostream>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <cstring>

#ifdef HAVE_TFLITE
#include <tensorflow/lite/interpreter.h>
#include <tensorflow/lite/kernels/register.h>
#include <tensorflow/lite/model.h>
#include <tensorflow/lite/optional_debug_tools.h>

#ifdef USE_XNNPACK
#include <tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>
#endif

#ifdef USE_GPU_DELEGATE
#include <tensorflow/lite/delegates/gpu/delegate.h>
#endif
#endif

namespace hand_detector
{
    namespace tflite
    {

        // MediaPipe hand landmark indices (for vector<Point> landmarks)
        enum HandLandmark
        {
            WRIST = 0,
            THUMB_CMC = 1,
            THUMB_MCP = 2,
            THUMB_IP = 3,
            THUMB_TIP = 4,
            INDEX_FINGER_MCP = 5,
            INDEX_FINGER_PIP = 6,
            INDEX_FINGER_DIP = 7,
            INDEX_FINGER_TIP = 8,
            MIDDLE_FINGER_MCP = 9,
            MIDDLE_FINGER_PIP = 10,
            MIDDLE_FINGER_DIP = 11,
            MIDDLE_FINGER_TIP = 12,
            RING_FINGER_MCP = 13,
            RING_FINGER_PIP = 14,
            RING_FINGER_DIP = 15,
            RING_FINGER_TIP = 16,
            PINKY_MCP = 17,
            PINKY_PIP = 18,
            PINKY_DIP = 19,
            PINKY_TIP = 20
        };

        // Smoothing buffer for temporal stabilization
        template <typename T, size_t N>
        class RingBuffer
        {
        public:
            void push(const T &val)
            {
                buffer_[head_] = val;
                head_ = (head_ + 1) % N;
                if (size_ < N)
                    size_++;
            }

            T average() const
            {
                if (size_ == 0)
                    return T{};
                T sum{};
                for (size_t i = 0; i < size_; ++i)
                {
                    sum = sum + buffer_[i];
                }
                return sum / static_cast<float>(size_);
            }

            bool is_full() const { return size_ == N; }
            void clear()
            {
                size_ = 0;
                head_ = 0;
            }

        private:
            T buffer_[N];
            size_t head_ = 0;
            size_t size_ = 0;
        };

        // Implementation
        struct TFLiteHandDetectorImpl
        {
#ifdef HAVE_TFLITE
            std::unique_ptr<::tflite::FlatBufferModel> model;
            std::unique_ptr<::tflite::Interpreter> interpreter;
            TfLiteDelegate *delegate = nullptr;
#endif

            TFLiteConfig config;

            // Temporal smoothing buffers
            RingBuffer<Point, 7> index_tip_buffer;
            RingBuffer<float, 5> confidence_buffer;

            // Statistics
            struct Stats
            {
                uint64_t total_inferences = 0;
                uint64_t successful_detections = 0;
                uint64_t failed_detections = 0;
                float avg_inference_ms = 0.0f;
                float avg_confidence = 0.0f;
            } stats;

            bool initialized = false;

            ~TFLiteHandDetectorImpl()
            {
#ifdef HAVE_TFLITE
                if (delegate)
                {
#ifdef USE_XNNPACK
                    TfLiteXNNPackDelegateDelete(delegate);
#elif defined(USE_GPU_DELEGATE)
                    TfLiteGpuDelegateV2Delete(delegate);
#endif
                }
#endif
            }
        };

        TFLiteHandDetector::TFLiteHandDetector()
            : impl_(std::make_unique<TFLiteHandDetectorImpl>())
        {
        }

        TFLiteHandDetector::TFLiteHandDetector(const TFLiteConfig &config)
            : impl_(std::make_unique<TFLiteHandDetectorImpl>())
        {
            init(config);
        }

        TFLiteHandDetector::~TFLiteHandDetector() = default;

        bool TFLiteHandDetector::init(const TFLiteConfig &config)
        {
            impl_->config = config;

#ifndef HAVE_TFLITE
            std::cerr << "[TFLiteHandDetector] ERROR: TensorFlow Lite support not compiled in\n";
            std::cerr << "  Recompile with HAVE_TFLITE defined and TFLite libraries linked\n";
            return false;
#else

            // Load model
            if (config.model_path.empty())
            {
                std::cerr << "[TFLiteHandDetector] ERROR: Model path is empty\n";
                return false;
            }

            std::ifstream model_file(config.model_path, std::ios::binary);
            if (!model_file.good())
            {
                std::cerr << "[TFLiteHandDetector] ERROR: Cannot open model file: "
                          << config.model_path << "\n";
                return false;
            }

            impl_->model = ::tflite::FlatBufferModel::BuildFromFile(config.model_path.c_str());
            if (!impl_->model)
            {
                std::cerr << "[TFLiteHandDetector] ERROR: Failed to load TFLite model\n";
                return false;
            }

            // Build interpreter
            ::tflite::ops::builtin::BuiltinOpResolver resolver;
            ::tflite::InterpreterBuilder builder(*impl_->model, resolver);
            builder(&impl_->interpreter);

            if (!impl_->interpreter)
            {
                std::cerr << "[TFLiteHandDetector] ERROR: Failed to create interpreter\n";
                return false;
            }

            // Set number of threads
            impl_->interpreter->SetNumThreads(config.num_threads);

            // Apply hardware acceleration if requested
            if (config.use_xnnpack || config.use_gpu_delegate)
            {
#ifdef USE_XNNPACK
                if (config.use_xnnpack)
                {
                    TfLiteXNNPackDelegateOptions xnnpack_options =
                        TfLiteXNNPackDelegateOptionsDefault();
                    xnnpack_options.num_threads = config.num_threads;
                    impl_->delegate = TfLiteXNNPackDelegateCreate(&xnnpack_options);

                    if (impl_->delegate &&
                        impl_->interpreter->ModifyGraphWithDelegate(impl_->delegate) == kTfLiteOk)
                    {
                        if (config.verbose)
                        {
                            std::cerr << "[TFLiteHandDetector] XNNPACK delegate enabled\n";
                        }
                    }
                    else
                    {
                        std::cerr << "[TFLiteHandDetector] WARNING: XNNPACK delegate failed, using CPU\n";
                        if (impl_->delegate)
                        {
                            TfLiteXNNPackDelegateDelete(impl_->delegate);
                            impl_->delegate = nullptr;
                        }
                    }
                }
#endif

#ifdef USE_GPU_DELEGATE
                if (config.use_gpu_delegate && !impl_->delegate)
                {
                    TfLiteGpuDelegateOptionsV2 gpu_options = TfLiteGpuDelegateOptionsV2Default();
                    gpu_options.inference_priority1 = TFLITE_GPU_INFERENCE_PRIORITY_MIN_LATENCY;
                    gpu_options.inference_priority2 = TFLITE_GPU_INFERENCE_PRIORITY_AUTO;
                    gpu_options.inference_priority3 = TFLITE_GPU_INFERENCE_PRIORITY_AUTO;

                    impl_->delegate = TfLiteGpuDelegateV2Create(&gpu_options);

                    if (impl_->delegate &&
                        impl_->interpreter->ModifyGraphWithDelegate(impl_->delegate) == kTfLiteOk)
                    {
                        if (config.verbose)
                        {
                            std::cerr << "[TFLiteHandDetector] GPU delegate enabled\n";
                        }
                    }
                    else
                    {
                        std::cerr << "[TFLiteHandDetector] WARNING: GPU delegate failed, using CPU\n";
                        if (impl_->delegate)
                        {
                            TfLiteGpuDelegateV2Delete(impl_->delegate);
                            impl_->delegate = nullptr;
                        }
                    }
                }
#endif
            }

            // Allocate tensors
            if (impl_->interpreter->AllocateTensors() != kTfLiteOk)
            {
                std::cerr << "[TFLiteHandDetector] ERROR: Failed to allocate tensors\n";
                return false;
            }

            // Print model info if verbose
            if (config.verbose)
            {
                std::cerr << "[TFLiteHandDetector] Model loaded successfully\n";
                std::cerr << "  Input tensors: " << impl_->interpreter->inputs().size() << "\n";
                std::cerr << "  Output tensors: " << impl_->interpreter->outputs().size() << "\n";

                auto *input_tensor = impl_->interpreter->input_tensor(0);
                std::cerr << "  Input shape: [";
                for (int i = 0; i < input_tensor->dims->size; i++)
                {
                    std::cerr << input_tensor->dims->data[i];
                    if (i < input_tensor->dims->size - 1)
                        std::cerr << ", ";
                }
                std::cerr << "]\n";
                std::cerr << "  Threads: " << config.num_threads << "\n";
            }

            impl_->initialized = true;
            return true;
#endif
        }

        std::vector<HandDetection> TFLiteHandDetector::detect(const camera::Frame &frame)
        {
            std::vector<HandDetection> results;
#ifndef HAVE_TFLITE
            return results;
#else
            if (!impl_->initialized || !impl_->interpreter)
            {
                return results;
            }
            auto start_time = std::chrono::steady_clock::now();
            auto *input_tensor = impl_->interpreter->input_tensor(0);
            if (!input_tensor)
                return results;
            const int input_height = input_tensor->dims->data[1];
            const int input_width = input_tensor->dims->data[2];
            uint8_t *input_data = input_tensor->data.uint8;
            if (input_tensor->type == kTfLiteFloat32)
            {
                prepare_input_float(frame, reinterpret_cast<float *>(input_tensor->data.f), input_width, input_height);
            }
            else
            {
                prepare_input_uint8(frame, input_data, input_width, input_height);
            }
            impl_->stats.total_inferences++;
            if (impl_->interpreter->Invoke() != kTfLiteOk)
            {
                impl_->stats.failed_detections++;
                return results;
            }
            auto end_time = std::chrono::steady_clock::now();
            float inference_ms = std::chrono::duration<float, std::milli>(end_time - start_time).count();
            impl_->stats.avg_inference_ms = (impl_->stats.avg_inference_ms * 0.9f) + (inference_ms * 0.1f);
            // Robust multi-hand output parsing
            auto *landmarks_tensor = impl_->interpreter->output_tensor(0);
            if (!landmarks_tensor || !landmarks_tensor->dims || landmarks_tensor->dims->size < 3)
                return results;
            int num_hands = landmarks_tensor->dims->data[0];
            int num_landmarks = landmarks_tensor->dims->data[1];
            if (num_hands == 0 || num_landmarks != 21)
                return results;
            float *landmarks = landmarks_tensor->data.f;
            // Handedness tensor (if available)
            float *handedness_data = nullptr;
            if (impl_->interpreter->outputs().size() > 1)
            {
                auto *handedness_tensor = impl_->interpreter->output_tensor(1);
                handedness_data = handedness_tensor->data.f;
            }
            // For each detected hand
            for (int h = 0; h < num_hands; ++h)
            {
                HandDetection detection;
                detection.landmarks.reserve(21);
                for (int i = 0; i < 21; ++i)
                {
                    int offset = h * 21 * 3 + i * 3;
                    float x = landmarks[offset + 0];
                    float y = landmarks[offset + 1];
                    detection.landmarks.emplace_back(static_cast<int>(x * frame.width), static_cast<int>(y * frame.height));
                }
                detection.fingertips.clear();
                detection.fingertips.push_back(detection.landmarks[THUMB_TIP]);
                detection.fingertips.push_back(detection.landmarks[INDEX_FINGER_TIP]);
                detection.fingertips.push_back(detection.landmarks[MIDDLE_FINGER_TIP]);
                detection.fingertips.push_back(detection.landmarks[RING_FINGER_TIP]);
                detection.fingertips.push_back(detection.landmarks[PINKY_TIP]);
                detection.is_left_hand = handedness_data ? (handedness_data[h] < 0.5f) : false;
                detection.gesture = classify_gesture(detection);
                detection.gesture_confidence = 1.0f;
                detection.num_fingers = count_extended_fingers(detection);
                detection.bbox = compute_bbox_from_landmarks(detection.landmarks);
                detection.center = detection.bbox.center();
                if (detection.gesture == Gesture::POINTING)
                {
                    impl_->index_tip_buffer.push(detection.landmarks[INDEX_FINGER_TIP]);
                    detection.smoothed_fingertip = impl_->index_tip_buffer.average();
                }
                else
                {
                    impl_->index_tip_buffer.clear();
                    detection.smoothed_fingertip = detection.landmarks[INDEX_FINGER_TIP];
                }
                impl_->confidence_buffer.push(1.0f);
                impl_->stats.avg_confidence = impl_->confidence_buffer.average();
                impl_->stats.successful_detections++;
                results.emplace_back(std::move(detection));
            }
            // ...
            return results;
#endif
        }

        void TFLiteHandDetector::prepare_input_float(const camera::Frame &frame,
                                                     float *input_buffer,
                                                     int input_width, int input_height)
        {
            // Resize and normalize to [-1, 1] or [0, 1] depending on model
            const float scale = impl_->config.input_normalization_scale;
            const float offset = impl_->config.input_normalization_offset;

            for (int y = 0; y < input_height; y++)
            {
                for (int x = 0; x < input_width; x++)
                {
                    // Simple nearest neighbor resize
                    int src_x = x * frame.width / input_width;
                    int src_y = y * frame.height / input_height;
                    int src_idx = (src_y * frame.width + src_x) * 3;
                    int dst_idx = (y * input_width + x) * 3;

                    // RGB channels
                    input_buffer[dst_idx + 0] = (frame.data[src_idx + 0] / 255.0f) * scale + offset;
                    input_buffer[dst_idx + 1] = (frame.data[src_idx + 1] / 255.0f) * scale + offset;
                    input_buffer[dst_idx + 2] = (frame.data[src_idx + 2] / 255.0f) * scale + offset;
                }
            }
        }

        void TFLiteHandDetector::prepare_input_uint8(const camera::Frame &frame,
                                                     uint8_t *input_buffer,
                                                     int input_width, int input_height)
        {
            // Simple resize without normalization
            for (int y = 0; y < input_height; y++)
            {
                for (int x = 0; x < input_width; x++)
                {
                    int src_x = x * frame.width / input_width;
                    int src_y = y * frame.height / input_height;
                    int src_idx = (src_y * frame.width + src_x) * 3;
                    int dst_idx = (y * input_width + x) * 3;

                    input_buffer[dst_idx + 0] = frame.data[src_idx + 0];
                    input_buffer[dst_idx + 1] = frame.data[src_idx + 1];
                    input_buffer[dst_idx + 2] = frame.data[src_idx + 2];
                }
            }
        }

        Gesture TFLiteHandDetector::classify_gesture(const HandDetection &detection) const
        {
            if (detection.landmarks.size() < 21)
            {
                return Gesture::UNKNOWN;
            }

            // Count extended fingers
            int extended_count = count_extended_fingers(detection);

            // Pointing: only index finger extended
            bool index_ext = is_finger_extended(detection, INDEX_FINGER_TIP);
            bool middle_ext = is_finger_extended(detection, MIDDLE_FINGER_TIP);
            bool ring_ext = is_finger_extended(detection, RING_FINGER_TIP);
            bool pinky_ext = is_finger_extended(detection, PINKY_TIP);
            bool thumb_ext = is_finger_extended(detection, THUMB_TIP);

            // Pointing gesture: only index extended
            if (index_ext && !middle_ext && !ring_ext && !pinky_ext)
            {
                return Gesture::POINTING;
            }

            // Open palm: all or most fingers extended
            if (extended_count >= 4)
            {
                return Gesture::OPEN_PALM;
            }

            // Fist: no fingers extended (or just thumb)
            if (extended_count == 0 || (extended_count == 1 && thumb_ext))
            {
                return Gesture::FIST;
            }

            // Peace sign: index and middle extended
            if (index_ext && middle_ext && !ring_ext && !pinky_ext)
            {
                return Gesture::PEACE;
            }

            // Thumbs up: only thumb extended
            if (thumb_ext && !index_ext && !middle_ext && !ring_ext && !pinky_ext)
            {
                return Gesture::THUMBS_UP;
            }

            return Gesture::CUSTOM;
        }

        bool TFLiteHandDetector::is_finger_extended(const HandDetection &detection, int tip_idx) const
        {
            if (detection.landmarks.size() < 21)
                return false;

            // Get the finger joints (use proper joint chain)
            int mcp_idx, pip_idx, dip_idx;

            switch (tip_idx)
            {
            case INDEX_FINGER_TIP:
                mcp_idx = INDEX_FINGER_MCP;
                pip_idx = INDEX_FINGER_PIP;
                dip_idx = INDEX_FINGER_DIP;
                break;
            case MIDDLE_FINGER_TIP:
                mcp_idx = MIDDLE_FINGER_MCP;
                pip_idx = MIDDLE_FINGER_PIP;
                dip_idx = MIDDLE_FINGER_DIP;
                break;
            case RING_FINGER_TIP:
                mcp_idx = RING_FINGER_MCP;
                pip_idx = RING_FINGER_PIP;
                dip_idx = RING_FINGER_DIP;
                break;
            case PINKY_TIP:
                mcp_idx = PINKY_MCP;
                pip_idx = PINKY_PIP;
                dip_idx = PINKY_DIP;
                break;
            case THUMB_TIP:
                // Thumb is special - use different joints
                mcp_idx = THUMB_CMC;
                pip_idx = THUMB_MCP;
                dip_idx = THUMB_IP;
                break;
            default:
                return false;
            }

            const Point &mcp = detection.landmarks[mcp_idx];
            const Point &pip = detection.landmarks[pip_idx];
            const Point &dip = detection.landmarks[dip_idx];
            const Point &tip = detection.landmarks[tip_idx];

            // Method 1: Check if tip is above (lower y value) than PIP joint
            // This works well for fingers pointing up/forward
            // For thumb, use different logic
            if (tip_idx == THUMB_TIP)
            {
                // Thumb: check if tip is farther from wrist than MCP
                const Point &wrist = detection.landmarks[WRIST];
                float dist_mcp = wrist.distance(mcp);
                float dist_tip = wrist.distance(tip);
                return dist_tip > dist_mcp * 1.15f;
            }

            // For other fingers: use curl detection
            // Calculate the "curl" by checking if joints are progressively extending
            // A straight finger has: MCP -> PIP -> DIP -> TIP in roughly a line

            // Calculate distances along the finger
            float mcp_pip_dist = mcp.distance(pip);
            float pip_dip_dist = pip.distance(dip);
            float dip_tip_dist = dip.distance(tip);
            float mcp_tip_dist = mcp.distance(tip);

            // If finger is extended, the direct distance from MCP to TIP should be close to
            // the sum of individual joint distances
            float total_joint_dist = mcp_pip_dist + pip_dip_dist + dip_tip_dist;

            // Curl ratio: if straight, ratio should be close to 1.0
            // If curled, the direct distance is much shorter than the sum
            float curl_ratio = mcp_tip_dist / total_joint_dist;

            // Extended if curl ratio > 0.85 (relatively straight)
            return curl_ratio > 0.85f;
        }

        int TFLiteHandDetector::count_extended_fingers(const HandDetection &detection) const
        {
            int count = 0;

            if (is_finger_extended(detection, THUMB_TIP))
                count++;
            if (is_finger_extended(detection, INDEX_FINGER_TIP))
                count++;
            if (is_finger_extended(detection, MIDDLE_FINGER_TIP))
                count++;
            if (is_finger_extended(detection, RING_FINGER_TIP))
                count++;
            if (is_finger_extended(detection, PINKY_TIP))
                count++;

            return count;
        }

        BoundingBox TFLiteHandDetector::compute_bbox_from_landmarks(
            const std::vector<Point> &landmarks) const
        {

            if (landmarks.empty())
            {
                return BoundingBox();
            }

            int min_x = landmarks[0].x;
            int max_x = landmarks[0].x;
            int min_y = landmarks[0].y;
            int max_y = landmarks[0].y;

            for (const auto &pt : landmarks)
            {
                min_x = std::min(min_x, pt.x);
                max_x = std::max(max_x, pt.x);
                min_y = std::min(min_y, pt.y);
                max_y = std::max(max_y, pt.y);
            }

            BoundingBox bbox;
            bbox.x = min_x;
            bbox.y = min_y;
            bbox.width = max_x - min_x;
            bbox.height = max_y - min_y;
            bbox.confidence = 1.0f;

            return bbox;
        }

        DetectionStats TFLiteHandDetector::get_stats() const
        {
            DetectionStats stats;
#ifdef HAVE_TFLITE
            stats.frames_processed = impl_->stats.total_inferences;
            stats.hands_detected = impl_->stats.successful_detections;
            stats.avg_process_time_ms = impl_->stats.avg_inference_ms;
#endif
            return stats;
        }

        void TFLiteHandDetector::reset_stats()
        {
#ifdef HAVE_TFLITE
            impl_->stats = {};
#endif
        }

    } // namespace tflite
} // namespace hand_detector
