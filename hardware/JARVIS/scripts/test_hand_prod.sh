#!/bin/bash
set -e

# Simplified test launcher (use ./JARVIS --imx500 then type hand-prod for interactive mode)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../build"

if [ ! -f "$BUILD_DIR/JARVIS" ]; then
  echo "Binary not found. Build first: cd build && cmake .. && make -j4"; exit 1; fi

cd "$BUILD_DIR"
echo "hand-prod" | ./JARVIS --imx500
