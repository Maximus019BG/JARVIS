#include "hand_detector_imx500.hpp"
#include <iostream>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <chrono>
#include <fstream>

// TensorFlow Lite headers (minimal includes to avoid bloat)
#ifdef HAVE_TFLITE
#include <tensorflow/lite/interpreter.h>
#include <tensorflow/lite/kernels/register.h>
#include <tensorflow/lite/model.h>
#include <tensorflow/lite/optional_debug_tools.h>
#include <tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>

// IMX500 NPU delegate (if available)
#ifdef HAVE_IMX500_NPU
#include <imx500_npu_delegate.h>
#endif
#endif

namespace hand_detector
{

    // Internal TFLite state (implementation detail)
    struct IMX500HandDetector::TFLiteState
    {
#ifdef HAVE_TFLITE
        std::unique_ptr<tflite::FlatBufferModel> model;
        std::unique_ptr<tflite::Interpreter> interpreter;
        tflite::ops::builtin::BuiltinOpResolver resolver;
        TfLiteDelegate *xnnpack_delegate{nullptr};
        TfLiteDelegate *npu_delegate{nullptr};

        // Tensor indices
        int input_tensor_idx{0};
        std::vector<int> output_tensor_indices;

        // Input dimensions
        int input_width{224};
        int input_height{224};
        int input_channels{3};
#endif

        ~TFLiteState()
        {
#ifdef HAVE_TFLITE
            if (xnnpack_delegate)
            {
                TfLiteXNNPackDelegateDelete(xnnpack_delegate);
            }
#ifdef HAVE_IMX500_NPU
            if (npu_delegate)
            {
                imx500_npu_delegate_delete(npu_delegate);
            }
#endif
#endif
        }
    };

    IMX500HandDetector::IMX500HandDetector()
        : initialized_(false), next_track_id_(0)
    {
        tflite_state_ = std::make_unique<TFLiteState>();
    }

    IMX500HandDetector::IMX500HandDetector(const IMX500Config &config)
        : config_(config), initialized_(false), next_track_id_(0)
    {
        tflite_state_ = std::make_unique<TFLiteState>();
        init(config);
    }

    IMX500HandDetector::~IMX500HandDetector()
    {
    }

    bool IMX500HandDetector::is_npu_available()
    {
#if defined(HAVE_TFLITE) && defined(HAVE_IMX500_NPU)
        return true;
#else
        return false;
#endif
    }

    std::string IMX500HandDetector::get_hardware_info()
    {
        std::string info = "Hand Detector Hardware:\n";

#ifdef HAVE_TFLITE
        info += "  TensorFlow Lite: ENABLED\n";
#else
        info += "  TensorFlow Lite: DISABLED\n";
#endif

#ifdef HAVE_IMX500_NPU
        info += "  IMX500 NPU: AVAILABLE\n";
#else
        info += "  IMX500 NPU: NOT AVAILABLE\n";
#endif

#ifdef HAVE_XNNPACK
        info += "  XNNPACK: ENABLED\n";
#else
        info += "  XNNPACK: DISABLED\n";
#endif

        return info;
    }

    bool IMX500HandDetector::init(const IMX500Config &config)
    {
        config_ = config;
        initialized_ = false;
        stats_ = DetectionStats();

        // Enterprise-level: Always check for TFLite, fallback to IMX500 hardware if not available
#ifndef HAVE_TFLITE
        std::cerr << "[IMX500] [ERROR] TensorFlow Lite C++ API not available. Checking for IMX500 hardware neural network...\n";
        int ret = system("which rpicam-hello > /dev/null 2>&1");
        if (ret != 0)
        {
            std::cerr << "[IMX500] [FATAL] rpicam tools not found. Install with: sudo apt install imx500-all rpicam-apps\n";
            return false;
        }
        FILE *fp = popen("rpicam-hello --list-cameras 2>&1 | grep imx500", "r");
        char buf[256];
        bool has_imx500 = false;
        if (fp)
        {
            if (fgets(buf, sizeof(buf), fp) != nullptr)
            {
                has_imx500 = true;
            }
            pclose(fp);
        }
        if (!has_imx500)
        {
            std::cerr << "[IMX500] [FATAL] IMX500 camera not detected.\n";
            return false;
        }
        std::cerr << "[IMX500] ✓ IMX500 camera detected with hardware NPU\n";
        std::cerr << "[IMX500] ✓ Using native postprocessing pipeline\n";
        std::cerr << "[IMX500] Model: " << config_.model_path << "\n";
        initialized_ = true;
        return true;
#else

        if (config_.verbose)
        {
            std::cerr << "[IMX500] Initializing enterprise hand detector...\n";
            std::cerr << "[IMX500] Model: " << config_.model_path << "\n";
            std::cerr << "[IMX500] NPU acceleration: " << (config_.use_npu ? "ON" : "OFF") << "\n";
        }
        // Load model with robust error handling
        if (!load_model(config_.model_path))
        {
            std::cerr << "[IMX500] [FATAL] Model loading failed.\n";
            initialized_ = false;
            return false;
        }
        initialized_ = true;
        if (config_.verbose)
        {
            std::cerr << "[IMX500] ✓ Detector initialized successfully\n";
            std::cerr << "[IMX500] Input shape: " << tflite_state_->input_width << "x"
                      << tflite_state_->input_height << "x" << tflite_state_->input_channels << "\n";
        }
        return true;
#endif
    }

    bool IMX500HandDetector::load_model(const std::string &model_path)
    {
        // Robust model loading: always check for TFLite
#ifndef HAVE_TFLITE
        (void)model_path;
        std::cerr << "[IMX500] [ERROR] TFLite not available, cannot load model.\n";
        return false;
#else
        // Try multiple model paths
        std::vector<std::string> search_paths = {
            model_path,
            "models/" + model_path,
            "/usr/share/jarvis/models/" + model_path,
            "./hand_landmark_full.tflite",
            "./models/hand_landmark_full.tflite",
            "/usr/share/jarvis/models/hand_landmark_full.tflite"};
        std::string found_path;
        for (const auto &path : search_paths)
        {
            std::ifstream f(path);
            if (f.good())
            {
                found_path = path;
                break;
            }
        }
        if (found_path.empty())
        {
            std::cerr << "[IMX500] [FATAL] Model file not found. Searched:\n";
            for (const auto &path : search_paths)
            {
                std::cerr << "  - " << path << "\n";
            }
            std::cerr << "[IMX500] Download model from:\n";
            std::cerr << "  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task\n";
            return false;
        }
        if (config_.verbose)
        {
            std::cerr << "[IMX500] Loading model from: " << found_path << "\n";
        }
        tflite_state_->model = tflite::FlatBufferModel::BuildFromFile(found_path.c_str());
        if (!tflite_state_->model)
        {
            std::cerr << "[IMX500] [FATAL] Failed to load model: " << found_path << "\n";
            return false;
        }
        tflite::InterpreterBuilder builder(*tflite_state_->model, tflite_state_->resolver);
        builder(&tflite_state_->interpreter);
        if (!tflite_state_->interpreter)
        {
            std::cerr << "[IMX500] [FATAL] Failed to create interpreter\n";
            return false;
        }
        tflite_state_->interpreter->SetNumThreads(config_.num_threads);
#ifdef HAVE_IMX500_NPU
        if (config_.use_npu)
        {
            auto npu_options = imx500_npu_delegate_options_default();
            npu_options.cache_size_mb = config_.npu_cache_size_mb;
            tflite_state_->npu_delegate = imx500_npu_delegate_create(&npu_options);
            if (tflite_state_->npu_delegate)
            {
                if (tflite_state_->interpreter->ModifyGraphWithDelegate(tflite_state_->npu_delegate) == kTfLiteOk)
                {
                    if (config_.verbose)
                    {
                        std::cerr << "[IMX500] ✓ NPU delegate applied\n";
                    }
                }
                else
                {
                    std::cerr << "[IMX500] [WARNING] NPU delegate failed, using CPU fallback\n";
                    imx500_npu_delegate_delete(tflite_state_->npu_delegate);
                    tflite_state_->npu_delegate = nullptr;
                }
            }
            else
            {
                std::cerr << "[IMX500] [WARNING] NPU delegate creation failed\n";
            }
        }
#endif
        if (config_.use_xnnpack && !tflite_state_->npu_delegate)
        {
            auto xnnpack_options = TfLiteXNNPackDelegateOptionsDefault();
            xnnpack_options.num_threads = config_.num_threads;
            tflite_state_->xnnpack_delegate = TfLiteXNNPackDelegateCreate(&xnnpack_options);
            if (tflite_state_->xnnpack_delegate)
            {
                if (tflite_state_->interpreter->ModifyGraphWithDelegate(tflite_state_->xnnpack_delegate) == kTfLiteOk)
                {
                    if (config_.verbose)
                    {
                        std::cerr << "[IMX500] ✓ XNNPACK delegate applied\n";
                    }
                }
                else
                {
                    std::cerr << "[IMX500] [WARNING] XNNPACK delegate failed, using default CPU\n";
                    TfLiteXNNPackDelegateDelete(tflite_state_->xnnpack_delegate);
                    tflite_state_->xnnpack_delegate = nullptr;
                }
            }
            else
            {
                std::cerr << "[IMX500] [WARNING] XNNPACK delegate creation failed\n";
            }
        }
        if (tflite_state_->interpreter->AllocateTensors() != kTfLiteOk)
        {
            std::cerr << "[IMX500] [FATAL] Failed to allocate tensors\n";
            return false;
        }
        tflite_state_->input_tensor_idx = tflite_state_->interpreter->inputs()[0];
        TfLiteTensor *input_tensor = tflite_state_->interpreter->tensor(tflite_state_->input_tensor_idx);
        if (!input_tensor || !input_tensor->dims || input_tensor->dims->size < 4)
        {
            std::cerr << "[IMX500] [FATAL] Invalid input tensor shape\n";
            return false;
        }
        tflite_state_->input_height = input_tensor->dims->data[1];
        tflite_state_->input_width = input_tensor->dims->data[2];
        tflite_state_->input_channels = input_tensor->dims->data[3];
        tflite_state_->output_tensor_indices = tflite_state_->interpreter->outputs();
        if (tflite_state_->output_tensor_indices.empty())
        {
            std::cerr << "[IMX500] [FATAL] No output tensors found in model\n";
            return false;
        }
        return true;
#endif
    }

    std::vector<EnhancedHandDetection> IMX500HandDetector::detect(const camera::Frame &frame)
    {
        std::vector<EnhancedHandDetection> detections;

        if (!initialized_)
        {
            std::cerr << "[IMX500] [ERROR] Detector not initialized.\n";
            return detections;
        }

#ifndef HAVE_TFLITE
        // Use IMX500's native postprocessing - Hand Landmarks or PoseNet running on NPU
        auto start_time = std::chrono::high_resolution_clock::now();

        // Check if IMX500 postprocessing is enabled via environment
        static bool imx500_enabled = (std::getenv("JARVIS_USE_IMX500_POSTPROCESS") != nullptr);

        if (!imx500_enabled || !frame.has_imx500_metadata)
        {
            // IMX500 not enabled or no metadata available, return empty to trigger CV fallback
            stats_.frames_processed++;
            return detections;
        }

        // Priority 1: Hand Landmarks (21 keypoints, accurate finger counting)
        if (!frame.imx500_hand_landmarks.empty())
        {
            for (const auto &hand : frame.imx500_hand_landmarks)
            {
                EnhancedHandDetection detection = create_hand_from_landmarks(
                    hand, frame.width, frame.height);
                if (detection.bbox.confidence > 0)
                {
                    detections.push_back(detection);
                }
            }
        }
        // Priority 2: PoseNet (17 keypoints, wrist-based estimation)
        else if (!frame.imx500_detections.empty())
        {
            for (const auto &pose : frame.imx500_detections)
            {
                // Extract left wrist
                const auto &left_wrist = pose.keypoints[camera::IMX500PoseDetection::LEFT_WRIST];
                if (left_wrist.confidence > config_.detection_confidence)
                {
                    EnhancedHandDetection left_hand = create_hand_from_wrist(
                        left_wrist, pose, frame.width, frame.height, false);
                    if (left_hand.bbox.confidence > 0)
                    {
                        detections.push_back(left_hand);
                    }
                }

                // Extract right wrist
                const auto &right_wrist = pose.keypoints[camera::IMX500PoseDetection::RIGHT_WRIST];
                if (right_wrist.confidence > config_.detection_confidence)
                {
                    EnhancedHandDetection right_hand = create_hand_from_wrist(
                        right_wrist, pose, frame.width, frame.height, true);
                    if (right_hand.bbox.confidence > 0)
                    {
                        detections.push_back(right_hand);
                    }
                }
            }
        }

        // Update tracking
        update_tracking(detections);

        // Update stats
        stats_.frames_processed++;
        stats_.hands_detected += detections.size();
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time);
        stats_.avg_process_time_ms = duration.count();

        return detections;
#else
        auto start_time = std::chrono::high_resolution_clock::now();

        // Preprocess frame
        TfLiteTensor *input_tensor = tflite_state_->interpreter->tensor(tflite_state_->input_tensor_idx);
        if (!input_tensor || !input_tensor->data.f)
        {
            std::cerr << "[IMX500] [FATAL] Input tensor not available for inference\n";
            return detections;
        }
        float *input_data = input_tensor->data.f;
        preprocess_frame(frame, input_data);
        // Run inference
        auto invoke_status = tflite_state_->interpreter->Invoke();
        if (invoke_status != kTfLiteOk)
        {
            std::cerr << "[IMX500] [FATAL] Inference failed (Invoke returned " << invoke_status << ")\n";
            return detections;
        }
        // Postprocess outputs
        detections = postprocess_detections();

        // Update tracking
        if (config_.enable_tracking)
        {
            update_tracking(detections);
        }

        // Update statistics
        auto end_time = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);

        stats_.frames_processed++;
        stats_.hands_detected += detections.size();

        float process_time_ms = duration.count() / 1000.0f;
        if (stats_.frames_processed == 1)
        {
            stats_.avg_process_time_ms = process_time_ms;
        }
        else
        {
            stats_.avg_process_time_ms = (stats_.avg_process_time_ms * 0.95f) + (process_time_ms * 0.05f);
        }

        return detections;
#endif
    }

    std::vector<HandDetection> IMX500HandDetector::detect_simple(const camera::Frame &frame)
    {
        auto enhanced = detect(frame);
        std::vector<HandDetection> simple;
        simple.reserve(enhanced.size());

        for (const auto &enh : enhanced)
        {
            simple.push_back(static_cast<HandDetection>(enh));
        }

        return simple;
    }

    void IMX500HandDetector::preprocess_frame(const camera::Frame &frame, float *input_buffer)
    {
#ifndef HAVE_TFLITE
        (void)frame;
        (void)input_buffer;
#else
        // Resize and normalize frame data
        const int target_w = tflite_state_->input_width;
        const int target_h = tflite_state_->input_height;

        // Simple bilinear resize
        const float scale_x = static_cast<float>(frame.width) / target_w;
        const float scale_y = static_cast<float>(frame.height) / target_h;

        const uint8_t *src = frame.data.data();
        const int src_stride = frame.stride;

        for (int y = 0; y < target_h; ++y)
        {
            for (int x = 0; x < target_w; ++x)
            {
                int src_x = static_cast<int>(x * scale_x);
                int src_y = static_cast<int>(y * scale_y);

                // Clamp to frame bounds
                src_x = std::min(src_x, static_cast<int>(frame.width - 1));
                src_y = std::min(src_y, static_cast<int>(frame.height - 1));

                const uint8_t *pixel = src + src_y * src_stride + src_x * 3;

                int idx = (y * target_w + x) * 3;

                if (config_.normalize_input)
                {
                    // Normalize to [-1, 1] or [0, 1] based on model
                    input_buffer[idx + 0] = (pixel[0] - config_.mean[0]) / config_.std[0];
                    input_buffer[idx + 1] = (pixel[1] - config_.mean[1]) / config_.std[1];
                    input_buffer[idx + 2] = (pixel[2] - config_.mean[2]) / config_.std[2];
                }
                else
                {
                    input_buffer[idx + 0] = pixel[0] / 255.0f;
                    input_buffer[idx + 1] = pixel[1] / 255.0f;
                    input_buffer[idx + 2] = pixel[2] / 255.0f;
                }
            }
        }
#endif
    }

    std::vector<EnhancedHandDetection> IMX500HandDetector::postprocess_detections()
    {
        std::vector<EnhancedHandDetection> detections;
#ifdef HAVE_TFLITE
        // MediaPipe hand landmarker outputs:
        // Output 0: landmarks [num_hands, 21, 3] - normalized (x, y, z) coordinates
        // Output 1: handedness [num_hands, 1] - left/right classification score
        // Output 2: world_landmarks [num_hands, 21, 3] - 3D world coordinates (optional)
        if (tflite_state_->output_tensor_indices.empty())
        {
            std::cerr << "[IMX500] [FATAL] No output tensors available for postprocessing\n";
            return detections;
        }
        int landmarks_idx = tflite_state_->output_tensor_indices[0];
        TfLiteTensor *landmarks_tensor = tflite_state_->interpreter->tensor(landmarks_idx);
        if (!landmarks_tensor || !landmarks_tensor->dims || landmarks_tensor->dims->size < 3)
        {
            std::cerr << "[IMX500] [FATAL] Landmarks tensor shape invalid\n";
            return detections;
        }
        int num_hands = landmarks_tensor->dims->data[0];
        int num_landmarks = landmarks_tensor->dims->data[1];
        if (num_hands == 0 || num_landmarks != 21)
        {
            if (config_.verbose)
            {
                std::cerr << "[IMX500] No hands detected (num_hands=" << num_hands << ", num_landmarks=" << num_landmarks << ")\n";
            }
            return detections;
        }
        float *landmarks_data = landmarks_tensor->data.f;
        // Get handedness if available
        float *handedness_data = nullptr;
        if (tflite_state_->output_tensor_indices.size() > 1)
        {
            int handedness_idx = tflite_state_->output_tensor_indices[1];
            TfLiteTensor *handedness_tensor = tflite_state_->interpreter->tensor(handedness_idx);
            handedness_data = handedness_tensor->data.f;
        }
        // Get world landmarks if available
        float *world_landmarks_data = nullptr;
        if (tflite_state_->output_tensor_indices.size() > 2)
        {
            int world_idx = tflite_state_->output_tensor_indices[2];
            TfLiteTensor *world_tensor = tflite_state_->interpreter->tensor(world_idx);
            world_landmarks_data = world_tensor->data.f;
        }
        // Process each detected hand robustly
        for (int h = 0; h < num_hands; ++h)
        {
            EnhancedHandDetection det;
            // Landmarks
            for (int i = 0; i < 21; ++i)
            {
                int offset = h * 21 * 3 + i * 3;
                det.landmarks[i].x = landmarks_data[offset + 0];
                det.landmarks[i].y = landmarks_data[offset + 1];
                det.landmarks[i].z = landmarks_data[offset + 2];
                det.landmarks[i].visibility = 1.0f;
                det.landmarks[i].presence = 1.0f;
            }
            // World landmarks (optional)
            if (world_landmarks_data)
            {
                for (int i = 0; i < 21; ++i)
                {
                    int offset = h * 21 * 3 + i * 3;
                    det.world_landmarks[i].x = world_landmarks_data[offset + 0];
                    det.world_landmarks[i].y = world_landmarks_data[offset + 1];
                    det.world_landmarks[i].z = world_landmarks_data[offset + 2];
                    det.world_landmarks[i].visibility = 1.0f;
                    det.world_landmarks[i].presence = 1.0f;
                }
            }
            // Handedness
            if (handedness_data)
            {
                det.handedness = handedness_data[h];
                det.is_right_hand = (det.handedness > 0.5f);
            }
            else
            {
                det.handedness = 0.0f;
                det.is_right_hand = false;
            }
            // Compute bounding box and center
            float min_x = 1.0f, max_x = 0.0f, min_y = 1.0f, max_y = 0.0f;
            for (int i = 0; i < 21; ++i)
            {
                min_x = std::min(min_x, det.landmarks[i].x);
                max_x = std::max(max_x, det.landmarks[i].x);
                min_y = std::min(min_y, det.landmarks[i].y);
                max_y = std::max(max_y, det.landmarks[i].y);
            }
            det.bbox.x = static_cast<int>(min_x * config_.input_width);
            det.bbox.y = static_cast<int>(min_y * config_.input_height);
            det.bbox.width = static_cast<int>((max_x - min_x) * config_.input_width);
            det.bbox.height = static_cast<int>((max_y - min_y) * config_.input_height);
            det.bbox.confidence = 1.0f;
            det.center.x = det.bbox.x + det.bbox.width / 2;
            det.center.y = det.bbox.y + det.bbox.height / 2;
            // Gesture classification
            det.gesture = classify_gesture_from_landmarks(det);
            det.num_fingers = count_extended_fingers(det);
            det.gesture_confidence = 1.0f;
            // Temporal smoothing (simple exponential for center)
            if (!active_tracks_.empty())
            {
                HandTrack *track = find_matching_track(det);
                if (track)
                {
                    det.center.x = static_cast<int>(config_.position_smoothing_alpha * det.center.x + (1.0f - config_.position_smoothing_alpha) * track->last_position.x);
                    det.center.y = static_cast<int>(config_.position_smoothing_alpha * det.center.y + (1.0f - config_.position_smoothing_alpha) * track->last_position.y);
                }
            }
            detections.push_back(det);
        }
        // Debug logging per frame
        if (config_.verbose)
        {
            std::cerr << "[IMX500] Detected " << detections.size() << " hand(s)";
            for (size_t i = 0; i < detections.size(); ++i)
            {
                std::cerr << " | Hand " << i << ": "
                          << (detections[i].is_right_hand ? "RIGHT" : "LEFT")
                          << " @ (" << detections[i].center.x << ", " << detections[i].center.y << ")"
                          << " conf=" << detections[i].bbox.confidence
                          << " gesture=" << static_cast<int>(detections[i].gesture)
                          << " fingers=" << detections[i].num_fingers;
            }
            std::cerr << std::endl;
        }
#endif
        return detections;
    }

    void IMX500HandDetector::update_tracking(std::vector<EnhancedHandDetection> &detections)
    {
        // Match detections to existing tracks
        for (auto &det : detections)
        {
            HandTrack *track = find_matching_track(det);

            if (track)
            {
                // Update existing track
                track->last_detection = det;
                track->frames_alive++;
                track->frames_lost = 0;
                track->confidence = (track->confidence * 0.9f) + (det.bbox.confidence * 0.1f);

                // Update velocity
                Point new_pos(det.center.x, det.center.y);
                track->velocity.x = new_pos.x - track->last_position.x;
                track->velocity.y = new_pos.y - track->last_position.y;
                track->last_position = new_pos;

                det.track_id = track->id;
                det.frames_tracked = track->frames_alive;
                det.tracking_confidence = track->confidence;
                det.velocity_x = track->velocity.x;
                det.velocity_y = track->velocity.y;
            }
            else
            {
                // Create new track
                HandTrack new_track;
                new_track.id = next_track_id_++;
                new_track.last_detection = det;
                new_track.last_position = Point(det.center.x, det.center.y);
                new_track.frames_alive = 1;
                new_track.confidence = det.bbox.confidence;

                active_tracks_.push_back(new_track);

                det.track_id = new_track.id;
                det.frames_tracked = 1;
                det.tracking_confidence = det.bbox.confidence;
            }
        }

        // Update lost tracks
        for (auto &track : active_tracks_)
        {
            bool found = false;
            for (const auto &det : detections)
            {
                if (det.track_id == track.id)
                {
                    found = true;
                    break;
                }
            }
            if (!found)
            {
                track.frames_lost++;
            }
        }

        prune_lost_tracks();
    }

    IMX500HandDetector::HandTrack *IMX500HandDetector::find_matching_track(
        const EnhancedHandDetection &detection)
    {

        HandTrack *best_match = nullptr;
        float best_score = 0.5f; // Minimum matching threshold

        Point det_pos(detection.center.x, detection.center.y);

        for (auto &track : active_tracks_)
        {
            if (track.frames_lost > 5)
                continue; // Skip lost tracks

            // Calculate matching score based on position and size
            float iou = calculate_iou(detection.bbox, track.last_detection.bbox);
            float pos_dist = det_pos.distance(track.last_position);
            float max_dist = 100.0f; // Maximum position change per frame
            float pos_score = std::max(0.0f, 1.0f - (pos_dist / max_dist));

            float score = iou * 0.7f + pos_score * 0.3f;

            if (score > best_score)
            {
                best_score = score;
                best_match = &track;
            }
        }

        return best_match;
    }

    void IMX500HandDetector::prune_lost_tracks()
    {
        active_tracks_.erase(
            std::remove_if(active_tracks_.begin(), active_tracks_.end(),
                           [](const HandTrack &track)
                           {
                               return track.frames_lost > 10; // Remove after 10 frames lost
                           }),
            active_tracks_.end());
    }

    float IMX500HandDetector::calculate_iou(const BoundingBox &a, const BoundingBox &b)
    {
        int x1 = std::max(a.x, b.x);
        int y1 = std::max(a.y, b.y);
        int x2 = std::min(a.x + a.width, b.x + b.width);
        int y2 = std::min(a.y + a.height, b.y + b.height);

        if (x2 <= x1 || y2 <= y1)
            return 0.0f;

        int intersection = (x2 - x1) * (y2 - y1);
        int union_area = a.area() + b.area() - intersection;

        return static_cast<float>(intersection) / union_area;
    }

    void IMX500HandDetector::reset_stats()
    {
        stats_ = DetectionStats();
    }

    void IMX500HandDetector::set_config(const IMX500Config &config)
    {
        config_ = config;
    }

    // ============================================================================
    // Gesture Recognition from Landmarks
    // ============================================================================

    Gesture IMX500HandDetector::classify_gesture_from_landmarks(const EnhancedHandDetection &detection)
    {
#ifndef HAVE_TFLITE
        (void)detection;
        return Gesture::UNKNOWN;
#else
        if (detection.landmarks.size() != 21)
        {
            return Gesture::UNKNOWN;
        }

        // Check specific gestures in priority order
        if (is_thumb_up(detection))
            return Gesture::THUMBS_UP;
        if (is_ok_sign(detection))
            return Gesture::OK_SIGN;
        if (is_peace_sign(detection))
            return Gesture::PEACE;
        if (is_pointing(detection))
            return Gesture::POINTING;
        if (is_fist(detection))
            return Gesture::FIST;

        // Count extended fingers for OPEN_PALM or numbered gestures
        int extended_count = count_extended_fingers(detection);

        if (extended_count >= 4)
        {
            return Gesture::OPEN_PALM;
        }
        else if (extended_count == 0)
        {
            return Gesture::FIST;
        }

        return Gesture::UNKNOWN;
#endif
    }

    int IMX500HandDetector::count_extended_fingers(const EnhancedHandDetection &detection)
    {
#ifndef HAVE_TFLITE
        (void)detection;
        return 0;
#else
        int count = 0;

        // Check each finger (index 0-4: thumb, index, middle, ring, pinky)
        for (int finger = 0; finger < 5; ++finger)
        {
            if (is_finger_extended(detection, finger))
            {
                count++;
            }
        }

        return count;
#endif
    }

    bool IMX500HandDetector::is_finger_extended(const EnhancedHandDetection &det, int finger_idx)
    {
#ifndef HAVE_TFLITE
        (void)det;
        (void)finger_idx;
        return false;
#else
        // MediaPipe landmark indices:
        // Thumb: 1,2,3,4  Index: 5,6,7,8  Middle: 9,10,11,12  Ring: 13,14,15,16  Pinky: 17,18,19,20
        // 0 = wrist

        int base_idx, mcp_idx, pip_idx, /*dip_idx,*/ tip_idx;

        switch (finger_idx)
        {
        case 0: // Thumb
            base_idx = 1;
            mcp_idx = 2;
            pip_idx = 3;
            tip_idx = 4;
            break;
        case 1: // Index
            base_idx = 5;
            mcp_idx = 6;
            pip_idx = 7;
            tip_idx = 8;
            break;
        case 2: // Middle
            base_idx = 9;
            mcp_idx = 10;
            pip_idx = 11;
            tip_idx = 12;
            break;
        case 3: // Ring
            base_idx = 13;
            mcp_idx = 14;
            pip_idx = 15;
            tip_idx = 16;
            break;
        case 4: // Pinky
            base_idx = 17;
            mcp_idx = 18;
            pip_idx = 19;
            tip_idx = 20;
            break;
        default:
            return false;
        }

        const IMX500Landmark &wrist = det.landmarks[0];
        const IMX500Landmark &tip = det.landmarks[tip_idx];
        const IMX500Landmark &pip = det.landmarks[pip_idx];
        const IMX500Landmark &mcp = det.landmarks[mcp_idx];

        // Thumb uses different logic (horizontal extension)
        if (finger_idx == 0)
        {
            const IMX500Landmark &thumb_base = det.landmarks[base_idx];
            float thumb_extension = std::abs(tip.x - thumb_base.x);
            float palm_width = std::abs(det.landmarks[5].x - det.landmarks[17].x);
            return thumb_extension > palm_width * 0.4f;
        }

        // For other fingers: check if tip is above PIP and PIP is above MCP (vertical extension)
        float tip_to_wrist = std::sqrt(std::pow(tip.x - wrist.x, 2) + std::pow(tip.y - wrist.y, 2));
        float pip_to_wrist = std::sqrt(std::pow(pip.x - wrist.x, 2) + std::pow(pip.y - wrist.y, 2));
        float mcp_to_wrist = std::sqrt(std::pow(mcp.x - wrist.x, 2) + std::pow(mcp.y - wrist.y, 2));

        // Finger is extended if tip is farther from wrist than PIP, and PIP farther than MCP
        return (tip_to_wrist > pip_to_wrist * 0.95f) && (pip_to_wrist > mcp_to_wrist * 0.85f);
#endif
    }

    bool IMX500HandDetector::is_thumb_up(const EnhancedHandDetection &det)
    {
#ifndef HAVE_TFLITE
        (void)det;
        return false;
#else
        // Thumb extended, all other fingers curled
        bool thumb_extended = is_finger_extended(det, 0);
        bool index_curled = !is_finger_extended(det, 1);
        bool middle_curled = !is_finger_extended(det, 2);
        bool ring_curled = !is_finger_extended(det, 3);
        bool pinky_curled = !is_finger_extended(det, 4);

        // Check if thumb is pointing upward (thumb tip y < thumb base y)
        const IMX500Landmark &thumb_tip = det.landmarks[4];
        const IMX500Landmark &thumb_base = det.landmarks[2];
        bool thumb_upward = thumb_tip.y < thumb_base.y;

        return thumb_extended && thumb_upward && index_curled && middle_curled && ring_curled && pinky_curled;
#endif
    }

    bool IMX500HandDetector::is_ok_sign(const EnhancedHandDetection &det)
    {
#ifndef HAVE_TFLITE
        (void)det;
        return false;
#else
        // Thumb and index finger form a circle, other fingers extended
        const IMX500Landmark &thumb_tip = det.landmarks[4];
        const IMX500Landmark &index_tip = det.landmarks[8];

        // Calculate distance between thumb tip and index tip
        float distance = std::sqrt(std::pow(thumb_tip.x - index_tip.x, 2) +
                                   std::pow(thumb_tip.y - index_tip.y, 2));

        // Calculate palm size for reference
        const IMX500Landmark &wrist = det.landmarks[0];
        const IMX500Landmark &middle_mcp = det.landmarks[9];
        float palm_size = std::sqrt(std::pow(middle_mcp.x - wrist.x, 2) +
                                    std::pow(middle_mcp.y - wrist.y, 2));

        // Thumb and index should be close (forming circle)
        bool forming_circle = distance < palm_size * 0.3f;

        // Middle, ring, and pinky should be extended
        bool middle_extended = is_finger_extended(det, 2);
        bool ring_extended = is_finger_extended(det, 3);
        bool pinky_extended = is_finger_extended(det, 4);

        return forming_circle && middle_extended && ring_extended && pinky_extended;
#endif
    }

    bool IMX500HandDetector::is_peace_sign(const EnhancedHandDetection &det)
    {
#ifndef HAVE_TFLITE
        (void)det;
        return false;
#else
        // Index and middle fingers extended, others curled
        bool index_extended = is_finger_extended(det, 1);
        bool middle_extended = is_finger_extended(det, 2);
        bool ring_curled = !is_finger_extended(det, 3);
        bool pinky_curled = !is_finger_extended(det, 4);
        bool thumb_curled = !is_finger_extended(det, 0);

        // Check if index and middle fingers are separated (V shape)
        const IMX500Landmark &index_tip = det.landmarks[8];
        const IMX500Landmark &middle_tip = det.landmarks[12];
        float separation = std::abs(index_tip.x - middle_tip.x);

        const IMX500Landmark &wrist = det.landmarks[0];
        const IMX500Landmark &middle_mcp = det.landmarks[9];
        float palm_size = std::sqrt(std::pow(middle_mcp.x - wrist.x, 2) +
                                    std::pow(middle_mcp.y - wrist.y, 2));

        bool fingers_separated = separation > palm_size * 0.2f;

        return index_extended && middle_extended && ring_curled && pinky_curled &&
               thumb_curled && fingers_separated;
#endif
    }

    bool IMX500HandDetector::is_pointing(const EnhancedHandDetection &det)
    {
#ifndef HAVE_TFLITE
        (void)det;
        return false;
#else
        // Only index finger extended
        bool index_extended = is_finger_extended(det, 1);
        bool middle_curled = !is_finger_extended(det, 2);
        bool ring_curled = !is_finger_extended(det, 3);
        bool pinky_curled = !is_finger_extended(det, 4);
        bool thumb_curled = !is_finger_extended(det, 0);

        return index_extended && middle_curled && ring_curled && pinky_curled && thumb_curled;
#endif
    }

    bool IMX500HandDetector::is_fist(const EnhancedHandDetection &det)
    {
#ifndef HAVE_TFLITE
        (void)det;
        return false;
#else
        // All fingers curled
        int extended_count = count_extended_fingers(det);

        // Also check that fingertips are close to palm
        const IMX500Landmark &wrist = det.landmarks[0];
        float avg_tip_distance = 0.0f;

        for (int finger = 1; finger <= 4; ++finger)
        {
            int tip_idx = finger * 4; // 4, 8, 12, 16, 20
            const IMX500Landmark &tip = det.landmarks[tip_idx];
            float dist = std::sqrt(std::pow(tip.x - wrist.x, 2) + std::pow(tip.y - wrist.y, 2));
            avg_tip_distance += dist;
        }
        avg_tip_distance /= 4.0f;

        // Calculate palm size
        const IMX500Landmark &middle_mcp = det.landmarks[9];
        float palm_size = std::sqrt(std::pow(middle_mcp.x - wrist.x, 2) +
                                    std::pow(middle_mcp.y - wrist.y, 2));

        // Fist if no fingers extended and tips are close to wrist
        return (extended_count == 0) && (avg_tip_distance < palm_size * 1.5f);
#endif
    }

    // Helper function to create hand detection from PoseNet wrist keypoint
    EnhancedHandDetection IMX500HandDetector::create_hand_from_wrist(
        const camera::IMX500Keypoint &wrist,
        const camera::IMX500PoseDetection &pose,
        uint32_t frame_width, uint32_t frame_height,
        bool is_right_hand)
    {
        EnhancedHandDetection hand;

        // Convert normalized coordinates to pixel coordinates
        int wrist_x = static_cast<int>(wrist.x * frame_width);
        int wrist_y = static_cast<int>(wrist.y * frame_height);

        // Estimate hand size from elbow-wrist distance
        int elbow_idx = is_right_hand ? camera::IMX500PoseDetection::RIGHT_ELBOW
                                      : camera::IMX500PoseDetection::LEFT_ELBOW;
        const auto &elbow = pose.keypoints[elbow_idx];

        int elbow_x = static_cast<int>(elbow.x * frame_width);
        int elbow_y = static_cast<int>(elbow.y * frame_height);

        float forearm_length = std::sqrt(std::pow(wrist_x - elbow_x, 2) +
                                         std::pow(wrist_y - elbow_y, 2));

        // Hand size is approximately 40% of forearm length
        int hand_size = static_cast<int>(forearm_length * 0.4f);
        if (hand_size < 30)
            hand_size = 80; // Default size if forearm not visible

        // Create bounding box around wrist
        hand.bbox.x = wrist_x - hand_size / 2;
        hand.bbox.y = wrist_y - hand_size / 2;
        hand.bbox.width = hand_size;
        hand.bbox.height = hand_size;
        hand.bbox.confidence = wrist.confidence;

        // Set hand center
        hand.center.x = wrist_x;
        hand.center.y = wrist_y;

        // Set handedness
        hand.is_right_hand = is_right_hand;
        hand.handedness = is_right_hand ? 1.0f : 0.0f;

        // Estimate gesture from arm pose
        // If elbow is visible and above wrist, likely open palm or pointing
        // If elbow below or hand close to body, likely fist or relaxed
        if (elbow.confidence > 0.5f && elbow_y < wrist_y - 20)
        {
            // Arm raised - likely open palm or pointing
            hand.gesture = Gesture::OPEN_PALM;
            hand.num_fingers = 5;
        }
        else if (elbow.confidence > 0.5f && std::abs(elbow_x - wrist_x) > hand_size)
        {
            // Arm extended sideways - likely pointing
            hand.gesture = Gesture::POINTING;
            hand.num_fingers = 1;
        }
        else
        {
            // Default to unknown, will be refined by tracking
            hand.gesture = Gesture::UNKNOWN;
            hand.num_fingers = 0;
        }

        // Set basic landmarks (wrist + estimated finger positions)
        // PoseNet doesn't give individual fingers, so we estimate
        for (int i = 0; i < 21; ++i)
        {
            hand.landmarks[i].x = wrist.x;
            hand.landmarks[i].y = wrist.y;
            hand.landmarks[i].z = 0;
            hand.landmarks[i].visibility = wrist.confidence;
            hand.landmarks[i].presence = wrist.confidence;
        }

        hand.gesture_confidence = wrist.confidence * 0.8f; // Slightly lower since we're estimating

        return hand;
    }

    // Create hand detection from IMX500 hand landmarks (21 keypoints, accurate finger counting)
    EnhancedHandDetection IMX500HandDetector::create_hand_from_landmarks(
        const camera::IMX500HandLandmark &hand_data,
        uint32_t frame_width, uint32_t frame_height)
    {
        EnhancedHandDetection hand;

        // Convert normalized coordinates to pixels
        const auto &wrist = hand_data.landmarks[camera::IMX500HandLandmark::WRIST];
        int wrist_x = static_cast<int>(wrist.x * frame_width);
        int wrist_y = static_cast<int>(wrist.y * frame_height);

        // Calculate bounding box from all landmarks
        float min_x = 1.0f, max_x = 0.0f, min_y = 1.0f, max_y = 0.0f;
        for (int i = 0; i < 21; ++i)
        {
            min_x = std::min(min_x, hand_data.landmarks[i].x);
            max_x = std::max(max_x, hand_data.landmarks[i].x);
            min_y = std::min(min_y, hand_data.landmarks[i].y);
            max_y = std::max(max_y, hand_data.landmarks[i].y);
        }

        hand.bbox.x = static_cast<int>(min_x * frame_width) - 10;
        hand.bbox.y = static_cast<int>(min_y * frame_height) - 10;
        hand.bbox.width = static_cast<int>((max_x - min_x) * frame_width) + 20;
        hand.bbox.height = static_cast<int>((max_y - min_y) * frame_height) + 20;
        hand.bbox.confidence = hand_data.overall_confidence;

        // Set hand center
        hand.center.x = wrist_x;
        hand.center.y = wrist_y;

        // Set handedness (0.0 = left, 1.0 = right)
        hand.is_right_hand = hand_data.handedness > 0.5f;
        hand.handedness = hand_data.handedness;

        // Copy all 21 landmarks
        for (int i = 0; i < 21; ++i)
        {
            hand.landmarks[i].x = hand_data.landmarks[i].x;
            hand.landmarks[i].y = hand_data.landmarks[i].y;
            hand.landmarks[i].z = 0;
            hand.landmarks[i].visibility = hand_data.landmarks[i].confidence;
            hand.landmarks[i].presence = hand_data.landmarks[i].confidence;
        }

        // Accurate finger counting using MediaPipe landmarks
        hand.num_fingers = count_fingers_from_landmarks(hand_data, frame_width, frame_height);

        // Determine gesture from finger count
        switch (hand.num_fingers)
        {
        case 0:
            hand.gesture = Gesture::FIST;
            break;
        case 1:
            hand.gesture = Gesture::POINTING;
            break;
        case 2:
            hand.gesture = Gesture::PEACE;
            break;
        case 5:
            hand.gesture = Gesture::OPEN_PALM;
            break;
        default:
            hand.gesture = Gesture::UNKNOWN;
            break;
        }

        hand.gesture_confidence = hand_data.overall_confidence;

        return hand;
    }

    // Count extended fingers from hand landmarks
    int IMX500HandDetector::count_fingers_from_landmarks(
        const camera::IMX500HandLandmark &hand,
        uint32_t frame_width, uint32_t frame_height)
    {
        int finger_count = 0;

        // Get wrist position for reference
        // float wrist_y = hand.landmarks[camera::IMX500HandLandmark::WRIST].y * frame_height;

        // Thumb: Check if tip is far from palm center (different logic than other fingers)
        const auto &thumb_tip = hand.landmarks[camera::IMX500HandLandmark::THUMB_TIP];
        const auto &thumb_ip = hand.landmarks[camera::IMX500HandLandmark::THUMB_IP];
        float thumb_dist = std::sqrt(
            std::pow((thumb_tip.x - thumb_ip.x) * frame_width, 2) +
            std::pow((thumb_tip.y - thumb_ip.y) * frame_height, 2));
        if (thumb_dist > 20.0f && thumb_tip.confidence > 0.5f)
        {
            finger_count++;
        }

        // Index finger: Tip above MCP (metacarpophalangeal joint)
        if (hand.landmarks[camera::IMX500HandLandmark::INDEX_FINGER_TIP].y <
                hand.landmarks[camera::IMX500HandLandmark::INDEX_FINGER_MCP].y &&
            hand.landmarks[camera::IMX500HandLandmark::INDEX_FINGER_TIP].confidence > 0.5f)
        {
            finger_count++;
        }

        // Middle finger
        if (hand.landmarks[camera::IMX500HandLandmark::MIDDLE_FINGER_TIP].y <
                hand.landmarks[camera::IMX500HandLandmark::MIDDLE_FINGER_MCP].y &&
            hand.landmarks[camera::IMX500HandLandmark::MIDDLE_FINGER_TIP].confidence > 0.5f)
        {
            finger_count++;
        }

        // Ring finger
        if (hand.landmarks[camera::IMX500HandLandmark::RING_FINGER_TIP].y <
                hand.landmarks[camera::IMX500HandLandmark::RING_FINGER_MCP].y &&
            hand.landmarks[camera::IMX500HandLandmark::RING_FINGER_TIP].confidence > 0.5f)
        {
            finger_count++;
        }

        // Pinky finger
        if (hand.landmarks[camera::IMX500HandLandmark::PINKY_TIP].y <
                hand.landmarks[camera::IMX500HandLandmark::PINKY_MCP].y &&
            hand.landmarks[camera::IMX500HandLandmark::PINKY_TIP].confidence > 0.5f)
        {
            finger_count++;
        }

        return finger_count;
    }

} // namespace hand_detector
