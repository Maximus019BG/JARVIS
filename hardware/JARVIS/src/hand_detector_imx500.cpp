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

namespace hand_detector {

// Internal TFLite state (implementation detail)
struct IMX500HandDetector::TFLiteState {
#ifdef HAVE_TFLITE
    std::unique_ptr<tflite::FlatBufferModel> model;
    std::unique_ptr<tflite::Interpreter> interpreter;
    tflite::ops::builtin::BuiltinOpResolver resolver;
    TfLiteDelegate* xnnpack_delegate{nullptr};
    TfLiteDelegate* npu_delegate{nullptr};
    
    // Tensor indices
    int input_tensor_idx{0};
    std::vector<int> output_tensor_indices;
    
    // Input dimensions
    int input_width{224};
    int input_height{224};
    int input_channels{3};
#endif
    
    ~TFLiteState() {
#ifdef HAVE_TFLITE
        if (xnnpack_delegate) {
            TfLiteXNNPackDelegateDelete(xnnpack_delegate);
        }
#ifdef HAVE_IMX500_NPU
        if (npu_delegate) {
            imx500_npu_delegate_delete(npu_delegate);
        }
#endif
#endif
    }
};

IMX500HandDetector::IMX500HandDetector() 
    : initialized_(false), next_track_id_(0) {
    tflite_state_ = std::make_unique<TFLiteState>();
}

IMX500HandDetector::IMX500HandDetector(const IMX500Config& config)
    : config_(config), initialized_(false), next_track_id_(0) {
    tflite_state_ = std::make_unique<TFLiteState>();
    init(config);
}

IMX500HandDetector::~IMX500HandDetector() {
}

bool IMX500HandDetector::is_npu_available() {
#if defined(HAVE_TFLITE) && defined(HAVE_IMX500_NPU)
    return true;
#else
    return false;
#endif
}

std::string IMX500HandDetector::get_hardware_info() {
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

bool IMX500HandDetector::init(const IMX500Config& config) {
    config_ = config;
    
#ifndef HAVE_TFLITE
    std::cerr << "[IMX500] ERROR: TensorFlow Lite not available at compile time\n";
    std::cerr << "[IMX500] Falling back to classical computer vision\n";
    return false;
#else
    
    if (config_.verbose) {
        std::cerr << "[IMX500] Initializing enterprise hand detector...\n";
        std::cerr << "[IMX500] Model: " << config_.model_path << "\n";
        std::cerr << "[IMX500] NPU acceleration: " << (config_.use_npu ? "ON" : "OFF") << "\n";
    }
    
    // Load model
    if (!load_model(config_.model_path)) {
        return false;
    }
    
    initialized_ = true;
    
    if (config_.verbose) {
        std::cerr << "[IMX500] ✓ Detector initialized successfully\n";
        std::cerr << "[IMX500] Input shape: " << tflite_state_->input_width << "x" 
                  << tflite_state_->input_height << "x" << tflite_state_->input_channels << "\n";
    }
    
    return true;
#endif
}

bool IMX500HandDetector::load_model(const std::string& model_path) {
#ifndef HAVE_TFLITE
    (void)model_path;  // Unused when TFLITE not available
    return false;
#else
    // Try multiple model paths
    std::vector<std::string> search_paths = {
        model_path,
        "models/" + model_path,
        "/usr/share/jarvis/models/" + model_path,
        "./hand_landmark_full.tflite",
        "./models/hand_landmark_full.tflite",
        "/usr/share/jarvis/models/hand_landmark_full.tflite"
    };
    
    std::string found_path;
    for (const auto& path : search_paths) {
        std::ifstream f(path);
        if (f.good()) {
            found_path = path;
            break;
        }
    }
    
    if (found_path.empty()) {
        std::cerr << "[IMX500] ERROR: Model file not found. Searched:\n";
        for (const auto& path : search_paths) {
            std::cerr << "  - " << path << "\n";
        }
        std::cerr << "[IMX500] You can download the model from:\n";
        std::cerr << "  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task\n";
        return false;
    }
    
    if (config_.verbose) {
        std::cerr << "[IMX500] Loading model from: " << found_path << "\n";
    }
    
    // Load TFLite model
    tflite_state_->model = tflite::FlatBufferModel::BuildFromFile(found_path.c_str());
    if (!tflite_state_->model) {
        std::cerr << "[IMX500] ERROR: Failed to load model\n";
        return false;
    }
    
    // Build interpreter
    tflite::InterpreterBuilder builder(*tflite_state_->model, tflite_state_->resolver);
    builder(&tflite_state_->interpreter);
    
    if (!tflite_state_->interpreter) {
        std::cerr << "[IMX500] ERROR: Failed to create interpreter\n";
        return false;
    }
    
    // Configure threads
    tflite_state_->interpreter->SetNumThreads(config_.num_threads);
    
    // Apply delegates for acceleration
#ifdef HAVE_IMX500_NPU
    if (config_.use_npu) {
        auto npu_options = imx500_npu_delegate_options_default();
        npu_options.cache_size_mb = config_.npu_cache_size_mb;
        tflite_state_->npu_delegate = imx500_npu_delegate_create(&npu_options);
        
        if (tflite_state_->npu_delegate) {
            if (tflite_state_->interpreter->ModifyGraphWithDelegate(tflite_state_->npu_delegate) 
                == kTfLiteOk) {
                if (config_.verbose) {
                    std::cerr << "[IMX500] ✓ NPU delegate applied\n";
                }
            } else {
                std::cerr << "[IMX500] WARNING: NPU delegate failed, using CPU\n";
                imx500_npu_delegate_delete(tflite_state_->npu_delegate);
                tflite_state_->npu_delegate = nullptr;
            }
        }
    }
#endif
    
    // XNNPACK delegate (optimized CPU fallback)
    if (config_.use_xnnpack && !tflite_state_->npu_delegate) {
        auto xnnpack_options = TfLiteXNNPackDelegateOptionsDefault();
        xnnpack_options.num_threads = config_.num_threads;
        tflite_state_->xnnpack_delegate = TfLiteXNNPackDelegateCreate(&xnnpack_options);
        
        if (tflite_state_->xnnpack_delegate) {
            if (tflite_state_->interpreter->ModifyGraphWithDelegate(tflite_state_->xnnpack_delegate) 
                == kTfLiteOk) {
                if (config_.verbose) {
                    std::cerr << "[IMX500] ✓ XNNPACK delegate applied\n";
                }
            }
        }
    }
    
    // Allocate tensors
    if (tflite_state_->interpreter->AllocateTensors() != kTfLiteOk) {
        std::cerr << "[IMX500] ERROR: Failed to allocate tensors\n";
        return false;
    }
    
    // Get input tensor info
    tflite_state_->input_tensor_idx = tflite_state_->interpreter->inputs()[0];
    TfLiteTensor* input_tensor = tflite_state_->interpreter->tensor(tflite_state_->input_tensor_idx);
    
    tflite_state_->input_height = input_tensor->dims->data[1];
    tflite_state_->input_width = input_tensor->dims->data[2];
    tflite_state_->input_channels = input_tensor->dims->data[3];
    
    // Get output tensor indices
    tflite_state_->output_tensor_indices = tflite_state_->interpreter->outputs();
    
    return true;
#endif
}

std::vector<EnhancedHandDetection> IMX500HandDetector::detect(const camera::Frame& frame) {
    std::vector<EnhancedHandDetection> detections;
    
    if (!initialized_) {
        return detections;
    }
    
#ifndef HAVE_TFLITE
    (void)frame;  // Unused when TFLITE not available
    return detections;
#else
    auto start_time = std::chrono::high_resolution_clock::now();
    
    // Preprocess frame
    TfLiteTensor* input_tensor = tflite_state_->interpreter->tensor(tflite_state_->input_tensor_idx);
    float* input_data = input_tensor->data.f;
    preprocess_frame(frame, input_data);
    
    // Run inference
    if (tflite_state_->interpreter->Invoke() != kTfLiteOk) {
        std::cerr << "[IMX500] ERROR: Inference failed\n";
        return detections;
    }
    
    // Postprocess outputs
    detections = postprocess_detections();
    
    // Update tracking
    if (config_.enable_tracking) {
        update_tracking(detections);
    }
    
    // Update statistics
    auto end_time = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
    
    stats_.frames_processed++;
    stats_.hands_detected += detections.size();
    
    float process_time_ms = duration.count() / 1000.0f;
    if (stats_.frames_processed == 1) {
        stats_.avg_process_time_ms = process_time_ms;
    } else {
        stats_.avg_process_time_ms = (stats_.avg_process_time_ms * 0.95f) + (process_time_ms * 0.05f);
    }
    
    return detections;
#endif
}

std::vector<HandDetection> IMX500HandDetector::detect_simple(const camera::Frame& frame) {
    auto enhanced = detect(frame);
    std::vector<HandDetection> simple;
    simple.reserve(enhanced.size());
    
    for (const auto& enh : enhanced) {
        simple.push_back(static_cast<HandDetection>(enh));
    }
    
    return simple;
}

void IMX500HandDetector::preprocess_frame(const camera::Frame& frame, float* input_buffer) {
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
    
    const uint8_t* src = frame.data;
    const int src_stride = frame.stride;
    
    for (int y = 0; y < target_h; ++y) {
        for (int x = 0; x < target_w; ++x) {
            int src_x = static_cast<int>(x * scale_x);
            int src_y = static_cast<int>(y * scale_y);
            
            // Clamp to frame bounds
            src_x = std::min(src_x, static_cast<int>(frame.width - 1));
            src_y = std::min(src_y, static_cast<int>(frame.height - 1));
            
            const uint8_t* pixel = src + src_y * src_stride + src_x * 3;
            
            int idx = (y * target_w + x) * 3;
            
            if (config_.normalize_input) {
                // Normalize to [-1, 1] or [0, 1] based on model
                input_buffer[idx + 0] = (pixel[0] - config_.mean[0]) / config_.std[0];
                input_buffer[idx + 1] = (pixel[1] - config_.mean[1]) / config_.std[1];
                input_buffer[idx + 2] = (pixel[2] - config_.mean[2]) / config_.std[2];
            } else {
                input_buffer[idx + 0] = pixel[0] / 255.0f;
                input_buffer[idx + 1] = pixel[1] / 255.0f;
                input_buffer[idx + 2] = pixel[2] / 255.0f;
            }
        }
    }
#endif
}

std::vector<EnhancedHandDetection> IMX500HandDetector::postprocess_detections() {
    std::vector<EnhancedHandDetection> detections;
    
#ifdef HAVE_TFLITE
    // MediaPipe hand landmarker outputs:
    // Output 0: landmarks [num_hands, 21, 3] - normalized (x, y, z) coordinates
    // Output 1: handedness [num_hands, 1] - left/right classification score
    // Output 2: world_landmarks [num_hands, 21, 3] - 3D world coordinates (optional)
    
    if (tflite_state_->output_tensor_indices.empty()) {
        return detections;
    }
    
    // Get landmarks tensor (primary output)
    int landmarks_idx = tflite_state_->output_tensor_indices[0];
    TfLiteTensor* landmarks_tensor = tflite_state_->interpreter->tensor(landmarks_idx);
    
    if (config_.verbose) {
        std::cerr << "[IMX500] Postprocessing outputs...\n";
        for (size_t i = 0; i < tflite_state_->output_tensor_indices.size(); ++i) {
            int idx = tflite_state_->output_tensor_indices[i];
            TfLiteTensor* tensor = tflite_state_->interpreter->tensor(idx);
            std::cerr << "[IMX500] Output " << i << ": dims=";
            for (int d = 0; d < tensor->dims->size; ++d) {
                std::cerr << tensor->dims->data[d];
                if (d < tensor->dims->size - 1) std::cerr << "x";
            }
            std::cerr << "\n";
        }
    }
    
    // Parse tensor dimensions
    if (landmarks_tensor->dims->size < 3) {
        if (config_.verbose) {
            std::cerr << "[IMX500] WARNING: Unexpected landmarks tensor shape\n";
        }
        return detections;
    }
    
    int num_hands = landmarks_tensor->dims->data[0];
    int num_landmarks = landmarks_tensor->dims->data[1];  // Should be 21
    int coords_per_landmark = landmarks_tensor->dims->data[2];  // Should be 3 (x, y, z)
    
    if (num_hands == 0 || num_landmarks != 21) {
        return detections;
    }
    
    float* landmarks_data = landmarks_tensor->data.f;
    
    // Get handedness if available
    float* handedness_data = nullptr;
    if (tflite_state_->output_tensor_indices.size() > 1) {
        int handedness_idx = tflite_state_->output_tensor_indices[1];
        TfLiteTensor* handedness_tensor = tflite_state_->interpreter->tensor(handedness_idx);
        handedness_data = handedness_tensor->data.f;
    }
    
    // Process each detected hand
    for (int h = 0; h < num_hands; ++h) {
        EnhancedHandDetection detection;
        
        // Extract 21 landmarks
        int base_idx = h * num_landmarks * coords_per_landmark;
        
        float min_x = 1.0f, min_y = 1.0f;
        float max_x = 0.0f, max_y = 0.0f;
        
        for (int i = 0; i < num_landmarks; ++i) {
            int idx = base_idx + i * coords_per_landmark;
            
            // Populate IMX500Landmark array
            detection.landmarks[i].x = landmarks_data[idx + 0];      // Normalized x [0, 1]
            detection.landmarks[i].y = landmarks_data[idx + 1];      // Normalized y [0, 1]
            detection.landmarks[i].z = landmarks_data[idx + 2];      // Depth (relative)
            detection.landmarks[i].visibility = 1.0f;
            detection.landmarks[i].presence = 1.0f;
            
            // Track bounding box
            min_x = std::min(min_x, detection.landmarks[i].x);
            min_y = std::min(min_y, detection.landmarks[i].y);
            max_x = std::max(max_x, detection.landmarks[i].x);
            max_y = std::max(max_y, detection.landmarks[i].y);
        }
        
        // Convert normalized coordinates to pixel coordinates
        // Assuming input was 224x224 or using frame dimensions
        int frame_width = tflite_state_->input_width;
        int frame_height = tflite_state_->input_height;
        
        detection.bbox.x = static_cast<int>(min_x * frame_width);
        detection.bbox.y = static_cast<int>(min_y * frame_height);
        detection.bbox.width = static_cast<int>((max_x - min_x) * frame_width);
        detection.bbox.height = static_cast<int>((max_y - min_y) * frame_height);
        detection.bbox.confidence = 0.9f;  // High confidence if landmarks detected
        
        // Calculate center point
        detection.center.x = detection.bbox.x + detection.bbox.width / 2;
        detection.center.y = detection.bbox.y + detection.bbox.height / 2;
        
        // Determine handedness (left/right)
        if (handedness_data) {
            float handedness_score = handedness_data[h];
            detection.is_left = handedness_score < 0.5f;  // < 0.5 = left, >= 0.5 = right
        } else {
            // Fallback: use wrist position relative to middle finger
            const Landmark& wrist = detection.landmarks[0];
            const Landmark& middle_mcp = detection.landmarks[9];
            detection.is_left = wrist.x < middle_mcp.x;
        }
        
        // Calculate gesture confidence based on landmark spread
        float bbox_area = detection.bbox.width * detection.bbox.height;
        detection.gesture_confidence = std::min(1.0f, bbox_area / 10000.0f);
        
        // Classify gesture based on landmarks
        detection.gesture = classify_gesture_from_landmarks(detection);
        
        // Apply confidence threshold
        if (detection.bbox.confidence >= config_.confidence_threshold) {
            detections.push_back(detection);
        }
    }
    
    if (config_.verbose && !detections.empty()) {
        std::cerr << "[IMX500] Detected " << detections.size() << " hand(s)\n";
        for (size_t i = 0; i < detections.size(); ++i) {
            std::cerr << "[IMX500]   Hand " << i << ": " 
                      << (detections[i].is_left ? "LEFT" : "RIGHT")
                      << " @ (" << detections[i].center.x << ", " << detections[i].center.y << ")"
                      << " conf=" << detections[i].bbox.confidence << "\n";
        }
    }
    
#endif
    
    return detections;
}

void IMX500HandDetector::update_tracking(std::vector<EnhancedHandDetection>& detections) {
    // Match detections to existing tracks
    for (auto& det : detections) {
        HandTrack* track = find_matching_track(det);
        
        if (track) {
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
            
        } else {
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
    for (auto& track : active_tracks_) {
        bool found = false;
        for (const auto& det : detections) {
            if (det.track_id == track.id) {
                found = true;
                break;
            }
        }
        if (!found) {
            track.frames_lost++;
        }
    }
    
    prune_lost_tracks();
}

IMX500HandDetector::HandTrack* IMX500HandDetector::find_matching_track(
    const EnhancedHandDetection& detection) {
    
    HandTrack* best_match = nullptr;
    float best_score = 0.5f;  // Minimum matching threshold
    
    Point det_pos(detection.center.x, detection.center.y);
    
    for (auto& track : active_tracks_) {
        if (track.frames_lost > 5) continue;  // Skip lost tracks
        
        // Calculate matching score based on position and size
        float iou = calculate_iou(detection.bbox, track.last_detection.bbox);
        float pos_dist = det_pos.distance(track.last_position);
        float max_dist = 100.0f;  // Maximum position change per frame
        float pos_score = std::max(0.0f, 1.0f - (pos_dist / max_dist));
        
        float score = iou * 0.7f + pos_score * 0.3f;
        
        if (score > best_score) {
            best_score = score;
            best_match = &track;
        }
    }
    
    return best_match;
}

void IMX500HandDetector::prune_lost_tracks() {
    active_tracks_.erase(
        std::remove_if(active_tracks_.begin(), active_tracks_.end(),
            [](const HandTrack& track) {
                return track.frames_lost > 10;  // Remove after 10 frames lost
            }),
        active_tracks_.end()
    );
}

float IMX500HandDetector::calculate_iou(const BoundingBox& a, const BoundingBox& b) {
    int x1 = std::max(a.x, b.x);
    int y1 = std::max(a.y, b.y);
    int x2 = std::min(a.x + a.width, b.x + b.width);
    int y2 = std::min(a.y + a.height, b.y + b.height);
    
    if (x2 <= x1 || y2 <= y1) return 0.0f;
    
    int intersection = (x2 - x1) * (y2 - y1);
    int union_area = a.area() + b.area() - intersection;
    
    return static_cast<float>(intersection) / union_area;
}

void IMX500HandDetector::reset_stats() {
    stats_ = DetectionStats();
}

void IMX500HandDetector::set_config(const IMX500Config& config) {
    config_ = config;
}

// ============================================================================
// Gesture Recognition from Landmarks
// ============================================================================

Gesture IMX500HandDetector::classify_gesture_from_landmarks(const EnhancedHandDetection& detection) {
#ifndef HAVE_TFLITE
    (void)detection;
    return Gesture::UNKNOWN;
#else
    if (detection.landmarks.size() != 21) {
        return Gesture::UNKNOWN;
    }
    
    // Check specific gestures in priority order
    if (is_thumb_up(detection)) {
        return Gesture::THUMBS_UP;
    }
    
    if (is_ok_sign(detection)) {
        return Gesture::OK;
    }
    
    if (is_peace_sign(detection)) {
        return Gesture::PEACE;
    }
    
    if (is_pointing(detection)) {
        return Gesture::POINTING;
    }
    
    if (is_fist(detection)) {
        return Gesture::FIST;
    }
    
    // Count extended fingers for OPEN_PALM or numbered gestures
    int extended_count = count_extended_fingers(detection);
    
    if (extended_count >= 4) {
        return Gesture::OPEN_PALM;
    } else if (extended_count == 0) {
        return Gesture::FIST;
    }
    
    return Gesture::UNKNOWN;
#endif
}

int IMX500HandDetector::count_extended_fingers(const EnhancedHandDetection& detection) {
#ifndef HAVE_TFLITE
    (void)detection;
    return 0;
#else
    int count = 0;
    
    // Check each finger (index 0-4: thumb, index, middle, ring, pinky)
    for (int finger = 0; finger < 5; ++finger) {
        if (is_finger_extended(detection, finger)) {
            count++;
        }
    }
    
    return count;
#endif
}

bool IMX500HandDetector::is_finger_extended(const EnhancedHandDetection& det, int finger_idx) {
#ifndef HAVE_TFLITE
    (void)det;
    (void)finger_idx;
    return false;
#else
    // MediaPipe landmark indices:
    // Thumb: 1,2,3,4  Index: 5,6,7,8  Middle: 9,10,11,12  Ring: 13,14,15,16  Pinky: 17,18,19,20
    // 0 = wrist
    
    int base_idx, mcp_idx, pip_idx, dip_idx, tip_idx;
    
    switch (finger_idx) {
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
    
    const Landmark& wrist = det.landmarks[0];
    const Landmark& tip = det.landmarks[tip_idx];
    const Landmark& pip = det.landmarks[pip_idx];
    const Landmark& mcp = det.landmarks[mcp_idx];
    
    // Thumb uses different logic (horizontal extension)
    if (finger_idx == 0) {
        const Landmark& thumb_base = det.landmarks[base_idx];
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

bool IMX500HandDetector::is_thumb_up(const EnhancedHandDetection& det) {
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
    const Landmark& thumb_tip = det.landmarks[4];
    const Landmark& thumb_base = det.landmarks[2];
    bool thumb_upward = thumb_tip.y < thumb_base.y;
    
    return thumb_extended && thumb_upward && index_curled && middle_curled && ring_curled && pinky_curled;
#endif
}

bool IMX500HandDetector::is_ok_sign(const EnhancedHandDetection& det) {
#ifndef HAVE_TFLITE
    (void)det;
    return false;
#else
    // Thumb and index finger form a circle, other fingers extended
    const Landmark& thumb_tip = det.landmarks[4];
    const Landmark& index_tip = det.landmarks[8];
    
    // Calculate distance between thumb tip and index tip
    float distance = std::sqrt(std::pow(thumb_tip.x - index_tip.x, 2) + 
                               std::pow(thumb_tip.y - index_tip.y, 2));
    
    // Calculate palm size for reference
    const Landmark& wrist = det.landmarks[0];
    const Landmark& middle_mcp = det.landmarks[9];
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

bool IMX500HandDetector::is_peace_sign(const EnhancedHandDetection& det) {
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
    const Landmark& index_tip = det.landmarks[8];
    const Landmark& middle_tip = det.landmarks[12];
    float separation = std::abs(index_tip.x - middle_tip.x);
    
    const Landmark& wrist = det.landmarks[0];
    const Landmark& middle_mcp = det.landmarks[9];
    float palm_size = std::sqrt(std::pow(middle_mcp.x - wrist.x, 2) + 
                                std::pow(middle_mcp.y - wrist.y, 2));
    
    bool fingers_separated = separation > palm_size * 0.2f;
    
    return index_extended && middle_extended && ring_curled && pinky_curled && 
           thumb_curled && fingers_separated;
#endif
}

bool IMX500HandDetector::is_pointing(const EnhancedHandDetection& det) {
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

bool IMX500HandDetector::is_fist(const EnhancedHandDetection& det) {
#ifndef HAVE_TFLITE
    (void)det;
    return false;
#else
    // All fingers curled
    int extended_count = count_extended_fingers(det);
    
    // Also check that fingertips are close to palm
    const Landmark& wrist = det.landmarks[0];
    float avg_tip_distance = 0.0f;
    
    for (int finger = 1; finger <= 4; ++finger) {
        int tip_idx = finger * 4;  // 4, 8, 12, 16, 20
        const Landmark& tip = det.landmarks[tip_idx];
        float dist = std::sqrt(std::pow(tip.x - wrist.x, 2) + std::pow(tip.y - wrist.y, 2));
        avg_tip_distance += dist;
    }
    avg_tip_distance /= 4.0f;
    
    // Calculate palm size
    const Landmark& middle_mcp = det.landmarks[9];
    float palm_size = std::sqrt(std::pow(middle_mcp.x - wrist.x, 2) + 
                                std::pow(middle_mcp.y - wrist.y, 2));
    
    // Fist if no fingers extended and tips are close to wrist
    return (extended_count == 0) && (avg_tip_distance < palm_size * 1.5f);
#endif
}

} // namespace hand_detector
