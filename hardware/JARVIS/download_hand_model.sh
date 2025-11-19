#!/bin/bash
###############################################################################
# download_hand_model.sh
# 
# Downloads pre-trained TensorFlow Lite hand pose detection model
# Compatible with MediaPipe hand landmark detection (21 points)
#
# Usage: ./download_hand_model.sh
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/models"

echo "═══════════════════════════════════════════════════════════════"
echo "  JARVIS Hand Pose Model Downloader"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create models directory
mkdir -p "${MODELS_DIR}"
cd "${MODELS_DIR}"

echo "[INFO] Models directory: ${MODELS_DIR}"
echo ""

# Check if wget or curl is available
if command -v wget &> /dev/null; then
    DOWNLOADER="wget -O"
elif command -v curl &> /dev/null; then
    DOWNLOADER="curl -L -o"
else
    echo "[ERROR] Neither wget nor curl is installed"
    echo "        Install one with: sudo apt install wget"
    exit 1
fi

# Model URLs (MediaPipe hand landmark models)
LITE_MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
TFLITE_MODEL_URL="https://storage.googleapis.com/mediapipe-assets/hand_landmark_lite.tflite"

# Alternative URL if above doesn't work
ALT_MODEL_URL="https://github.com/google/mediapipe/raw/master/mediapipe/models/hand_landmark_lite.tflite"

echo "═══════════════════════════════════════════════════════════════"
echo "  Downloading Hand Landmark Model (Lite Version)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Try to download the TFLite model
if [ ! -f "hand_landmark_lite.tflite" ]; then
    echo "[INFO] Downloading hand_landmark_lite.tflite..."
    
    if ${DOWNLOADER} hand_landmark_lite.tflite "${TFLITE_MODEL_URL}" 2>/dev/null; then
        echo "[SUCCESS] Downloaded hand_landmark_lite.tflite"
    else
        echo "[WARNING] Primary URL failed, trying alternative..."
        
        if ${DOWNLOADER} hand_landmark_lite.tflite "${ALT_MODEL_URL}" 2>/dev/null; then
            echo "[SUCCESS] Downloaded hand_landmark_lite.tflite (alternative source)"
        else
            echo "[ERROR] Failed to download model from all sources"
            echo ""
            echo "Manual download instructions:"
            echo "1. Visit: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker"
            echo "2. Download 'hand_landmarker.task' or 'hand_landmark_lite.tflite'"
            echo "3. Place file in: ${MODELS_DIR}/"
            echo "4. Rename to: hand_landmark_lite.tflite"
            exit 1
        fi
    fi
else
    echo "[INFO] Model already exists: hand_landmark_lite.tflite"
fi

echo ""

# Verify file size (should be around 2-5 MB)
if [ -f "hand_landmark_lite.tflite" ]; then
    FILE_SIZE=$(stat -f%z "hand_landmark_lite.tflite" 2>/dev/null || stat -c%s "hand_landmark_lite.tflite" 2>/dev/null || echo "0")
    FILE_SIZE_MB=$((FILE_SIZE / 1024 / 1024))
    
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Model Verification"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  File: hand_landmark_lite.tflite"
    echo "  Size: ${FILE_SIZE} bytes (~${FILE_SIZE_MB} MB)"
    echo "  Path: ${MODELS_DIR}/hand_landmark_lite.tflite"
    echo ""
    
    if [ "${FILE_SIZE}" -lt 100000 ]; then
        echo "[WARNING] File size seems too small (${FILE_SIZE} bytes)"
        echo "          Expected size: 2-5 MB"
        echo "          The download might have failed or file is corrupted"
        echo ""
        echo "Please download manually from:"
        echo "https://developers.google.com/mediapipe/solutions/vision/hand_landmarker"
        exit 1
    else
        echo "[SUCCESS] Model downloaded successfully!"
        echo ""
        echo "═══════════════════════════════════════════════════════════════"
        echo "  Next Steps"
        echo "═══════════════════════════════════════════════════════════════"
        echo ""
        echo "1. Build JARVIS:"
        echo "   cd build && cmake .. && make -j\$(nproc)"
        echo ""
        echo "2. Run JARVIS Enterprise:"
        echo "   ./JARVIS"
        echo ""
        echo "3. Or specify model path:"
        echo "   ./JARVIS --model ${MODELS_DIR}/hand_landmark_lite.tflite"
        echo ""
    fi
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Download Complete"
echo "═══════════════════════════════════════════════════════════════"
