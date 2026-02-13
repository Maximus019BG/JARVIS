#!/bin/bash
set -e

echo "=== (Optional) Full TensorFlow Lite build ==="
TF_VERSION="2.14.0"
ARCH=$(uname -m)

echo "Target: $ARCH TensorFlow Lite v$TF_VERSION"

sudo apt-get update
sudo apt-get install -y cmake git wget python3-pip python3-numpy libflatbuffers-dev flatbuffers-compiler libabsl-dev

cd /tmp
if [ ! -d tensorflow_src ]; then
  git clone --depth 1 --branch v${TF_VERSION} https://github.com/tensorflow/tensorflow.git tensorflow_src
fi
cd tensorflow_src

if ! command -v bazel >/dev/null 2>&1; then
  wget -q https://github.com/bazelbuild/bazelisk/releases/download/v1.19.0/bazelisk-linux-arm64 -O bazelisk
  chmod +x bazelisk
  sudo mv bazelisk /usr/local/bin/bazel
fi

echo "Building libtensorflowlite.so (this can take a while)..."
bazel build -c opt --config=elinux_aarch64 //tensorflow/lite:libtensorflowlite.so || { echo "Build failed"; exit 1; }

sudo cp bazel-bin/tensorflow/lite/libtensorflowlite.so /usr/local/lib/
sudo mkdir -p /usr/local/include/tensorflow
sudo cp -r tensorflow /usr/local/include/

sudo ldconfig

echo "Full TFLite build installed."