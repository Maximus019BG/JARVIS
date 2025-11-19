#!/bin/bash
#
# Enterprise Hand Detection Test Script
# Tests the hand-prod mode with comprehensive verification
#

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   JARVIS Enterprise Hand Detection Test                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "⚠ Warning: Not running on Raspberry Pi"
else
    MODEL=$(cat /proc/device-tree/model 2>/dev/null || echo "Unknown")
    echo "Platform: $MODEL"
fi

# Check camera
echo ""
echo "Checking camera..."
if command -v rpicam-hello &> /dev/null; then
    echo "✓ rpicam tools installed"
    
    # Quick camera test (1 second)
    if timeout 2 rpicam-hello -t 100 --nopreview 2>&1 | grep -q "Camera"; then
        echo "✓ Camera detected and working"
    else
        echo "✗ Camera test failed"
        echo "  Make sure IMX500 camera is connected"
        exit 1
    fi
else
    echo "⚠ rpicam tools not found"
fi

# Check if binary exists
if [ ! -f "./build/JARVIS" ]; then
    echo "✗ JARVIS binary not found"
    echo "  Run: cd build && cmake .. && make"
    exit 1
fi

echo "✓ JARVIS binary found"
echo ""

# Check environment
if [ -f ".env" ]; then
    echo "✓ .env file found"
    if grep -q "JARVIS_SERVER" .env; then
        echo "✓ JARVIS_SERVER configured"
    fi
else
    echo "⚠ No .env file (using defaults)"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                   Starting Test Mode                       ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  This will test hand detection in production mode         ║"
echo "║                                                            ║"
echo "║  Instructions:                                             ║"
echo "║  1. Position your hand in front of the camera              ║"
echo "║  2. Try different gestures:                                ║"
echo "║     - Open palm (all fingers extended)                     ║"
echo "║     - Fist (all fingers closed)                            ║"
echo "║     - Pointing (index finger only)                         ║"
echo "║     - Peace sign (index + middle finger)                   ║"
echo "║                                                            ║"
echo "║  The system will log detected gestures                     ║"
echo "║  Press 'q' to quit the test                                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "Starting JARVIS in 3 seconds..."
sleep 1
echo "2..."
sleep 1
echo "1..."
sleep 1

# Create a test input file that sends hand-prod command
echo "hand-prod" > /tmp/jarvis_test_input.txt

# Run JARVIS with the test input
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    HAND DETECTION ACTIVE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

cd build
cat /tmp/jarvis_test_input.txt - | ./JARVIS

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Complete                           ║"
echo "╚════════════════════════════════════════════════════════════╝"

rm -f /tmp/jarvis_test_input.txt
