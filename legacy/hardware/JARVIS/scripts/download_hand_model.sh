#!/bin/bash
set -e

# Consolidated lightweight hand model downloader
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/../models"
mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
OUT_FILE="hand_landmarker.task"

if [ -f "$OUT_FILE" ]; then
  echo "[INFO] Model already exists: $OUT_FILE"
  exit 0
fi

echo "[INFO] Downloading MediaPipe hand landmark task file..."
if command -v wget >/dev/null 2>&1; then
  wget -q --show-progress "$MODEL_URL" -O "$OUT_FILE"
elif command -v curl >/dev/null 2>&1; then
  curl -L "$MODEL_URL" -o "$OUT_FILE"
else
  echo "[ERROR] Need wget or curl installed"; exit 1
fi

SIZE=$(stat -c%s "$OUT_FILE" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 1000000 ]; then
  echo "[WARNING] Downloaded file size suspicious ($SIZE bytes)";
else
  echo "[SUCCESS] Download complete: $OUT_FILE ($SIZE bytes)"
fi
