#include "hand_detector_config.hpp"
#include <fstream>
#include <sstream>
#include <iostream>

namespace hand_detector {

bool DetectorConfig::validate() const noexcept {
    if (hue_min < 0 || hue_max > 179 || hue_min > hue_max) return false;
    if (sat_min < 0 || sat_max > 255 || sat_min > sat_max) return false;
    if (val_min < 0 || val_max > 255 || val_min > val_max) return false;
    if (min_hand_area < 0 || max_hand_area < min_hand_area) return false;
    if (min_confidence < 0.0f || min_confidence > 1.0f) return false;
    if (downscale_factor < 1) return false;
    if (gesture_history < 1) return false;
    if (morph_iterations < 1) return false;
    return true;
}

bool DetectorConfig::load_from_file(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        std::cerr << "[Config] Failed to open: " << path << "\n";
        return false;
    }
    
    std::string line;
    while (std::getline(file, line)) {
        // Skip comments and empty lines
        if (line.empty() || line[0] == '#') continue;
        
        std::istringstream iss(line);
        std::string key;
        if (!(iss >> key)) continue;
        
        if (key == "hue_min") iss >> hue_min;
        else if (key == "hue_max") iss >> hue_max;
        else if (key == "sat_min") iss >> sat_min;
        else if (key == "sat_max") iss >> sat_max;
        else if (key == "val_min") iss >> val_min;
        else if (key == "val_max") iss >> val_max;
        else if (key == "min_hand_area") iss >> min_hand_area;
        else if (key == "max_hand_area") iss >> max_hand_area;
        else if (key == "min_confidence") iss >> min_confidence;
        else if (key == "enable_morphology") iss >> enable_morphology;
        else if (key == "morph_iterations") iss >> morph_iterations;
        else if (key == "enable_gesture") iss >> enable_gesture;
        else if (key == "gesture_history") iss >> gesture_history;
        else if (key == "downscale_factor") iss >> downscale_factor;
        else if (key == "verbose") iss >> verbose;
        else if (key == "enable_simd") iss >> enable_simd;
    }
    
    return validate();
}

void DetectorConfig::save_to_file(const std::string& path) const {
    std::ofstream file(path);
    if (!file.is_open()) {
        std::cerr << "[Config] Failed to save to: " << path << "\n";
        return;
    }
    
    file << "# Hand Detector Configuration\n";
    file << "# HSV Skin Detection Range\n";
    file << "hue_min " << hue_min << "\n";
    file << "hue_max " << hue_max << "\n";
    file << "sat_min " << sat_min << "\n";
    file << "sat_max " << sat_max << "\n";
    file << "val_min " << val_min << "\n";
    file << "val_max " << val_max << "\n";
    file << "\n# Detection Parameters\n";
    file << "min_hand_area " << min_hand_area << "\n";
    file << "max_hand_area " << max_hand_area << "\n";
    file << "min_confidence " << min_confidence << "\n";
    file << "\n# Processing\n";
    file << "enable_morphology " << enable_morphology << "\n";
    file << "morph_iterations " << morph_iterations << "\n";
    file << "enable_gesture " << enable_gesture << "\n";
    file << "gesture_history " << gesture_history << "\n";
    file << "downscale_factor " << downscale_factor << "\n";
    file << "\n# Performance\n";
    file << "verbose " << verbose << "\n";
    file << "enable_simd " << enable_simd << "\n";
}

} // namespace hand_detector
