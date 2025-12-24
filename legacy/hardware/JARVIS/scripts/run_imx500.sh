#!/bin/bash
set -e

# Optional convenience launcher (no longer required). Prefer: ./JARVIS --imx500
export JARVIS_USE_IMX500_POSTPROCESS=1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../build"

cd "$BUILD_DIR"
./JARVIS "$@"
