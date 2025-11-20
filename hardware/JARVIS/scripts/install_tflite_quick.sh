#!/bin/bash
set -e

echo "=== Quick TensorFlow Lite setup (runtime only) ==="
pip3 install --upgrade pip >/dev/null
pip3 install -q tflite-runtime || { echo "Install failed"; exit 1; }

PY_DIR=$(python3 -c "import tflite_runtime,os; print(os.path.dirname(tflite_runtime.__file__))" 2>/dev/null || echo "")
[ -z "$PY_DIR" ] && echo "[ERROR] tflite-runtime not found" && exit 1

echo "Runtime installed at: $PY_DIR"

# Minimal header for optional C++ detection
sudo mkdir -p /usr/local/include/tensorflow/lite/c
wget -q https://raw.githubusercontent.com/tensorflow/tensorflow/v2.14.0/tensorflow/lite/c/c_api.h -O /tmp/c_api.h
sudo cp /tmp/c_api.h /usr/local/include/tensorflow/lite/c/

echo "Done."