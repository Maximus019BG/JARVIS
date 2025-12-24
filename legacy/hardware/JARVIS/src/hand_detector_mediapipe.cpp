#include "hand_detector_mediapipe.hpp"
#include <iostream>
#include <chrono>
#include <cmath>
#include <algorithm>

// MediaPipe is optional - check if available at compile time
#ifdef HAVE_MEDIAPIPE
#include "mediapipe/framework/calculator_framework.h"
#include "mediapipe/framework/formats/image_frame.h"
#include "mediapipe/framework/formats/landmark.pb.h"
#include "mediapipe/framework/port/parse_text_proto.h"
#include "mediapipe/framework/port/status.h"
#endif

namespace hand_detector {

// Stub implementation when MediaPipe is not available
#ifndef HAVE_MEDIAPIPE

MediaPipeHandDetector::MediaPipeHandDetector() 
    : graph_(nullptr, [](void*){}) {
    std::cerr << "[MediaPipe] ERROR: MediaPipe support not compiled in.\n";
    std::cerr << "[MediaPipe] Please rebuild with -DHAVE_MEDIAPIPE=ON\n";
}

MediaPipeHandDetector::MediaPipeHandDetector(const MediaPipeConfig& config) 
    : config_(config), graph_(nullptr, [](void*){}) {
    std::cerr << "[MediaPipe] ERROR: MediaPipe support not compiled in.\n";
}

MediaPipeHandDetector::~MediaPipeHandDetector() {}

bool MediaPipeHandDetector::init(const MediaPipeConfig& config) {
    config_ = config;
    std::cerr << "[MediaPipe] ERROR: MediaPipe support not compiled in.\n";
    std::cerr << "[MediaPipe] Install MediaPipe and rebuild with: cmake -DHAVE_MEDIAPIPE=ON ..\n";
    return false;
}

std::vector<MediaPipeHandDetection> MediaPipeHandDetector::detect(const camera::Frame& frame) {
    (void)frame; // Suppress unused warning
    return {};
}

void MediaPipeHandDetector::set_config(const MediaPipeConfig& config) {
    config_ = config;
}

void MediaPipeHandDetector::reset_stats() {
    stats_.reset();
}

bool MediaPipeHandDetector::is_available() {
    return false;
}

std::string MediaPipeHandDetector::get_version() {
    return "MediaPipe support not available";
}

Gesture MediaPipeHandDetector::classify_gesture_from_landmarks(
    const std::vector<Point>& landmarks,
    const std::vector<float>& landmarks_z) {
    (void)landmarks;
    (void)landmarks_z;
    return Gesture::UNKNOWN;
}

bool MediaPipeHandDetector::is_finger_extended(
    const std::vector<Point>& landmarks,
    const std::vector<float>& landmarks_z,
    int finger_idx) {
    (void)landmarks;
    (void)landmarks_z;
    (void)finger_idx;
    return false;
}

BoundingBox MediaPipeHandDetector::compute_bbox_from_landmarks(
    const std::vector<Point>& landmarks,
    uint32_t frame_width, uint32_t frame_height) {
    (void)landmarks;
    (void)frame_width;
    (void)frame_height;
    return BoundingBox();
}

#else
// Full MediaPipe implementation

MediaPipeHandDetector::MediaPipeHandDetector() 
    : graph_(nullptr, [](void* ptr) {
        delete static_cast<mediapipe::CalculatorGraph*>(ptr);
      }) {
    reset_stats();
}

MediaPipeHandDetector::MediaPipeHandDetector(const MediaPipeConfig& config) 
    : config_(config), 
      graph_(nullptr, [](void* ptr) {
        delete static_cast<mediapipe::CalculatorGraph*>(ptr);
      }) {
    reset_stats();
}

MediaPipeHandDetector::~MediaPipeHandDetector() {
    if (graph_ && initialized_) {
        auto* graph = static_cast<mediapipe::CalculatorGraph*>(graph_.get());
        auto status = graph->CloseAllInputStreams();
        if (!status.ok()) {
            std::cerr << "[MediaPipe] Error closing input streams: " 
                      << status.message() << "\n";
        }
        status = graph->WaitUntilDone();
        if (!status.ok()) {
            std::cerr << "[MediaPipe] Error waiting for graph: " 
                      << status.message() << "\n";
        }
    }
}

bool MediaPipeHandDetector::init(const MediaPipeConfig& config) {
    config_ = config;
    reset_stats();
    
    // MediaPipe graph configuration for hand tracking
    std::string graph_config = R"pb(
        input_stream: "input_video"
        output_stream: "hand_landmarks"
        output_stream: "handedness"
        
        node {
          calculator: "HandLandmarkTrackingCpu"
          input_stream: "IMAGE:input_video"
          output_stream: "LANDMARKS:hand_landmarks"
          output_stream: "HANDEDNESS:handedness"
          node_options: {
            [type.googleapis.com/mediapipe.HandLandmarkTrackingOptions] {
              min_detection_confidence: )pb" + 
              std::to_string(config_.min_detection_confidence) + R"pb(
              min_tracking_confidence: )pb" + 
              std::to_string(config_.min_tracking_confidence) + R"pb(
              num_hands: )pb" + std::to_string(config_.num_hands) + R"pb(
            }
          }
        }
    )pb";
    
    mediapipe::CalculatorGraphConfig graph_proto;
    if (!mediapipe::ParseTextProto<mediapipe::CalculatorGraphConfig>(
            graph_config, &graph_proto)) {
        std::cerr << "[MediaPipe] ERROR: Failed to parse graph config\n";
        return false;
    }
    
    auto* graph = new mediapipe::CalculatorGraph();
    auto status = graph->Initialize(graph_proto);
    if (!status.ok()) {
        std::cerr << "[MediaPipe] ERROR: Failed to initialize graph: " 
                  << status.message() << "\n";
        delete graph;
        return false;
    }
    
    status = graph->StartRun({});
    if (!status.ok()) {
        std::cerr << "[MediaPipe] ERROR: Failed to start graph: " 
                  << status.message() << "\n";
        delete graph;
        return false;
    }
    
    graph_.reset(graph);
    initialized_ = true;
    
    if (config_.verbose) {
        std::cerr << "[MediaPipe] Initialized successfully\n";
        std::cerr << "  Min detection confidence: " << config_.min_detection_confidence << "\n";
        std::cerr << "  Min tracking confidence: " << config_.min_tracking_confidence << "\n";
        std::cerr << "  Max hands: " << config_.num_hands << "\n";
    }
    
    return true;
}

std::vector<MediaPipeHandDetection> MediaPipeHandDetector::detect(const camera::Frame& frame) {
    auto start_time = std::chrono::steady_clock::now();
    
    std::vector<MediaPipeHandDetection> detections;
    
    if (!initialized_ || !graph_) {
        std::cerr << "[MediaPipe] ERROR: Detector not initialized\n";
        return detections;
    }
    
    if (!frame.data || frame.width == 0 || frame.height == 0) {
        return detections;
    }
    
    auto* graph = static_cast<mediapipe::CalculatorGraph*>(graph_.get());
    
    // Convert frame to MediaPipe ImageFrame
    auto input_frame = std::make_unique<mediapipe::ImageFrame>(
        mediapipe::ImageFormat::SRGB, frame.width, frame.height,
        mediapipe::ImageFrame::kDefaultAlignmentBoundary);
    
    // Copy RGB data
    std::memcpy(input_frame->MutablePixelData(), frame.data, 
                frame.width * frame.height * 3);
    
    // Create timestamp
    auto timestamp = mediapipe::Timestamp(frame.timestamp_ns / 1000); // Convert ns to us
    
    // Send frame to graph
    auto status = graph->AddPacketToInputStream(
        "input_video",
        mediapipe::Adopt(input_frame.release()).At(timestamp));
    
    if (!status.ok()) {
        std::cerr << "[MediaPipe] ERROR: Failed to add packet: " 
                  << status.message() << "\n";
        return detections;
    }
    
    // Wait for results (this is blocking - could be optimized with polling)
    mediapipe::Packet landmarks_packet, handedness_packet;
    
    if (graph->HasOutputStream("hand_landmarks")) {
        status = graph->GetOutputStream("hand_landmarks", &landmarks_packet);
        if (!status.ok()) {
            return detections;
        }
    }
    
    if (graph->HasOutputStream("handedness")) {
        status = graph->GetOutputStream("handedness", &handedness_packet);
    }
    
    // Process landmarks if available
    if (!landmarks_packet.IsEmpty()) {
        const auto& multi_hand_landmarks = 
            landmarks_packet.Get<std::vector<mediapipe::NormalizedLandmarkList>>();
        
        for (size_t i = 0; i < multi_hand_landmarks.size() && i < config_.num_hands; ++i) {
            const auto& hand_landmarks = multi_hand_landmarks[i];
            
            if (hand_landmarks.landmark_size() != 21) {
                continue; // Invalid landmark count
            }
            
            MediaPipeHandDetection detection;
            
            // Extract landmarks
            detection.landmarks.reserve(21);
            detection.landmarks_z.reserve(21);
            
            for (int j = 0; j < 21; ++j) {
                const auto& lm = hand_landmarks.landmark(j);
                detection.landmarks.emplace_back(
                    static_cast<int>(lm.x() * frame.width),
                    static_cast<int>(lm.y() * frame.height)
                );
                detection.landmarks_z.push_back(lm.z());
            }
            
            // Compute bounding box from landmarks
            detection.bbox = compute_bbox_from_landmarks(
                detection.landmarks, frame.width, frame.height);
            
            // Compute center (use wrist as base)
            detection.center = detection.landmarks[static_cast<int>(HandLandmark::WRIST)];
            
            // Classify gesture
            detection.gesture = classify_gesture_from_landmarks(
                detection.landmarks, detection.landmarks_z);
            
            // Count extended fingers
            detection.num_fingers = 0;
            for (int finger = 0; finger < 5; ++finger) {
                if (is_finger_extended(detection.landmarks, detection.landmarks_z, finger)) {
                    detection.num_fingers++;
                }
            }
            
            // Extract fingertips
            detection.fingertips.clear();
            detection.fingertips.push_back(detection.landmarks[static_cast<int>(HandLandmark::THUMB_TIP)]);
            detection.fingertips.push_back(detection.landmarks[static_cast<int>(HandLandmark::INDEX_FINGER_TIP)]);
            detection.fingertips.push_back(detection.landmarks[static_cast<int>(HandLandmark::MIDDLE_FINGER_TIP)]);
            detection.fingertips.push_back(detection.landmarks[static_cast<int>(HandLandmark::RING_FINGER_TIP)]);
            detection.fingertips.push_back(detection.landmarks[static_cast<int>(HandLandmark::PINKY_TIP)]);
            
            // Handedness
            if (!handedness_packet.IsEmpty() && i < handedness_packet.Get<std::vector<mediapipe::ClassificationList>>().size()) {
                const auto& handedness_list = handedness_packet.Get<std::vector<mediapipe::ClassificationList>>();
                const auto& classification = handedness_list[i].classification(0);
                detection.handedness_confidence = classification.score();
                if (classification.label() == "Left") {
                    detection.handedness = MediaPipeHandDetection::Handedness::LEFT;
                } else if (classification.label() == "Right") {
                    detection.handedness = MediaPipeHandDetection::Handedness::RIGHT;
                }
            }
            
            detection.bbox.confidence = 0.95f; // MediaPipe provides high confidence
            detection.gesture_confidence = 0.90f;
            
            detections.push_back(detection);
        }
    }
    
    // Update statistics
    stats_.frames_processed++;
    stats_.hands_detected += detections.size();
    stats_.last_detection_timestamp = frame.timestamp_ns;
    
    auto end_time = std::chrono::steady_clock::now();
    const double process_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    
    stats_.avg_process_time_ms = 
        (stats_.avg_process_time_ms * (stats_.frames_processed - 1) + process_time) / 
        stats_.frames_processed;
    
    if (config_.verbose && !detections.empty()) {
        std::cerr << "[MediaPipe] Detected " << detections.size() << " hand(s) in " 
                  << process_time << " ms\n";
    }
    
    return detections;
}

void MediaPipeHandDetector::set_config(const MediaPipeConfig& config) {
    config_ = config;
    // Note: Changing config requires re-initialization
    if (initialized_) {
        std::cerr << "[MediaPipe] WARNING: Config changed. Re-initialize for changes to take effect.\n";
    }
}

void MediaPipeHandDetector::reset_stats() {
    stats_.reset();
}

bool MediaPipeHandDetector::is_available() {
    return true;
}

std::string MediaPipeHandDetector::get_version() {
    return "MediaPipe 0.10.x";
}

Gesture MediaPipeHandDetector::classify_gesture_from_landmarks(
    const std::vector<Point>& landmarks,
    const std::vector<float>& landmarks_z) {
    
    if (landmarks.size() != 21) {
        return Gesture::UNKNOWN;
    }
    
    // Count extended fingers
    int extended_count = 0;
    bool thumb_extended = is_finger_extended(landmarks, landmarks_z, 0);
    bool index_extended = is_finger_extended(landmarks, landmarks_z, 1);
    bool middle_extended = is_finger_extended(landmarks, landmarks_z, 2);
    bool ring_extended = is_finger_extended(landmarks, landmarks_z, 3);
    bool pinky_extended = is_finger_extended(landmarks, landmarks_z, 4);
    
    if (thumb_extended) extended_count++;
    if (index_extended) extended_count++;
    if (middle_extended) extended_count++;
    if (ring_extended) extended_count++;
    if (pinky_extended) extended_count++;
    
    // FIST: All fingers closed
    if (extended_count == 0) {
        return Gesture::FIST;
    }
    
    // OPEN_PALM: All or most fingers extended
    if (extended_count >= 4) {
        return Gesture::OPEN_PALM;
    }
    
    // POINTING: Only index finger extended
    if (extended_count == 1 && index_extended) {
        return Gesture::POINTING;
    }
    
    // PEACE: Index and middle fingers extended
    if (extended_count == 2 && index_extended && middle_extended) {
        return Gesture::PEACE;
    }
    
    // THUMBS_UP: Only thumb extended
    if (extended_count == 1 && thumb_extended) {
        return Gesture::THUMBS_UP;
    }
    
    // OK_SIGN: Thumb and index tips close together, other fingers extended
    if (thumb_extended && index_extended) {
        const auto& thumb_tip = landmarks[static_cast<int>(HandLandmark::THUMB_TIP)];
        const auto& index_tip = landmarks[static_cast<int>(HandLandmark::INDEX_FINGER_TIP)];
        double dist = thumb_tip.distance(index_tip);
        
        // Get approximate hand size from wrist to middle finger tip
        const auto& wrist = landmarks[static_cast<int>(HandLandmark::WRIST)];
        const auto& middle_tip = landmarks[static_cast<int>(HandLandmark::MIDDLE_FINGER_TIP)];
        double hand_size = wrist.distance(middle_tip);
        
        if (dist < hand_size * 0.2 && extended_count >= 2) {
            return Gesture::OK_SIGN;
        }
    }
    
    return Gesture::UNKNOWN;
}

bool MediaPipeHandDetector::is_finger_extended(
    const std::vector<Point>& landmarks,
    const std::vector<float>& landmarks_z,
    int finger_idx) {
    
    if (landmarks.size() != 21 || finger_idx < 0 || finger_idx > 4) {
        return false;
    }
    
    // Different logic for thumb vs other fingers
    if (finger_idx == 0) { // Thumb
        // For thumb, check if tip is farther from wrist than MCP
        const auto& wrist = landmarks[static_cast<int>(HandLandmark::WRIST)];
        const auto& thumb_mcp = landmarks[static_cast<int>(HandLandmark::THUMB_MCP)];
        const auto& thumb_tip = landmarks[static_cast<int>(HandLandmark::THUMB_TIP)];
        
        double mcp_dist = wrist.distance(thumb_mcp);
        double tip_dist = wrist.distance(thumb_tip);
        
        return tip_dist > mcp_dist * 1.3;
    }
    
    // For other fingers: check if tip is farther from palm than MCP
    int mcp_idx = 5 + finger_idx * 4;
    int tip_idx = 8 + finger_idx * 4;
    
    const auto& wrist = landmarks[static_cast<int>(HandLandmark::WRIST)];
    const auto& mcp = landmarks[mcp_idx];
    const auto& tip = landmarks[tip_idx];
    
    double mcp_dist = wrist.distance(mcp);
    double tip_dist = wrist.distance(tip);
    
    // Also check z-coordinate if available
    if (!landmarks_z.empty() && landmarks_z.size() == 21) {
        float tip_z = landmarks_z[tip_idx];
        float mcp_z = landmarks_z[mcp_idx];
        
        // Extended finger should have tip closer to camera (more negative z)
        if (tip_z > mcp_z + 0.1f) {
            return false; // Finger is curled back
        }
    }
    
    return tip_dist > mcp_dist * 1.2;
}

BoundingBox MediaPipeHandDetector::compute_bbox_from_landmarks(
    const std::vector<Point>& landmarks,
    uint32_t frame_width, uint32_t frame_height) {
    
    BoundingBox bbox;
    
    if (landmarks.empty()) {
        return bbox;
    }
    
    int min_x = landmarks[0].x;
    int max_x = landmarks[0].x;
    int min_y = landmarks[0].y;
    int max_y = landmarks[0].y;
    
    for (const auto& pt : landmarks) {
        min_x = std::min(min_x, pt.x);
        max_x = std::max(max_x, pt.x);
        min_y = std::min(min_y, pt.y);
        max_y = std::max(max_y, pt.y);
    }
    
    // Add some padding
    const int padding = 20;
    min_x = std::max(0, min_x - padding);
    min_y = std::max(0, min_y - padding);
    max_x = std::min(static_cast<int>(frame_width), max_x + padding);
    max_y = std::min(static_cast<int>(frame_height), max_y + padding);
    
    bbox.x = min_x;
    bbox.y = min_y;
    bbox.width = max_x - min_x;
    bbox.height = max_y - min_y;
    bbox.confidence = 0.95f;
    
    return bbox;
}

#endif // HAVE_MEDIAPIPE

} // namespace hand_detector
