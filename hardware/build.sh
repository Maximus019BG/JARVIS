#!/bin/bash

# Build script for JARVIS TUI App
# Creates an executable using PyInstaller in a virtual environment

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Single progress bar function
show_overall_progress() {
    local total_steps=100
    local current=0

    # Step increments
    local venv_steps=10
    local activate_steps=5
    local pyinstaller_steps=20
    local deps_steps=15
    local build_steps=30
    local prepare_steps=10
    local cleanup_steps=10

    echo -e "${BLUE}JARVIS Build Progress:${NC}"

    # Creating venv
    for ((i=1; i<=venv_steps; i++)); do
        current=$((current + 1))
        bar_length=50
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Creating environment...)                    "
        sleep 0.1
    done

    python3 -m venv build_venv > /dev/null 2>&1

    # Activating
    for ((i=1; i<=activate_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Activating environment...)                    "
        sleep 0.05
    done

    source build_venv/bin/activate

    # Installing PyInstaller
    for ((i=1; i<=pyinstaller_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Installing PyInstaller...)                    "
        sleep 0.1
    done

    pip install --quiet pyinstaller > /dev/null 2>&1

    # Installing deps
    for ((i=1; i<=deps_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Installing dependencies...)                    "
        sleep 0.05
    done

    pip install --quiet -r requirements.txt > /dev/null 2>&1

    # Building
    for ((i=1; i<=build_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Building executable...)                    "
        sleep 0.15
    done

    pyinstaller --onedir --add-data "styles.css:." --name jarvis app.py > /dev/null 2>&1

    if [ ! -d "dist/jarvis" ]; then
        echo -e "\n${RED}❌ Build failed: PyInstaller could not create the executable. Check for Python environment issues.${NC}"
        deactivate
        rm -rf build_venv dist *.spec > /dev/null 2>&1
        exit 1
    fi

    # Preparing
    for ((i=1; i<=prepare_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Preparing build folder...)                    "
        sleep 0.05
    done

    rm -rf build/ > /dev/null 2>&1
    mkdir -p build/ > /dev/null 2>&1
    mv dist/jarvis/* build/ > /dev/null 2>&1

    # Cleanup
    for ((i=1; i<=cleanup_steps; i++)); do
        current=$((current + 1))
        filled=$((current * bar_length / total_steps))
        empty=$((bar_length - filled))
        bar=$(printf '█%.0s' $(seq 1 $filled))
        spaces=$(printf ' %.0s' $(seq 1 $empty))
        echo -ne "\r${BLUE}${bar}${spaces}${NC} ${current}% Complete (Cleaning up...)                    "
        sleep 0.05
    done

    deactivate
    rm -rf build_venv dist *.spec > /dev/null 2>&1

    echo -e "\n${GREEN}✓ Build completed successfully!${NC}"
}

# JARVIS ASCII Art
echo -e "${BLUE}"
cat << 'EOF'
     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
EOF
echo -e "${NC}"

echo -e "${YELLOW}Initializing JARVIS Build System...${NC}"
sleep 1

# Run the single progress loader
show_overall_progress

echo -e "${GREEN}"
cat << 'EOF'
██████╗ ██╗   ██╗██╗██╗     ██████╗     ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗     ███████╗████████╗███████╗
██╔══██╗██║   ██║██║██║     ██╔══██╗    ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║     ██╔════╝╚══██╔══╝██╔════╝
██████╔╝██║   ██║██║██║     ██║  ██║    ██║     ██║   ██║██╔████╔██║██████╔╝██║     █████╗     ██║   █████╗
██╔══██╗██║   ██║██║██║     ██║  ██║    ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║     ██╔══╝     ██║   ██╔══╝
██████╔╝╚██████╔╝██║███████╗██████╔╝    ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ███████╗███████╗   ██║   ███████╗
╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝      ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝   ╚══════╝
EOF
echo -e "${NC}"

echo -e "${GREEN}🎉 Executable is located at: ${BLUE}build/jarvis${NC}"
echo -e "${YELLOW}Run with: ${BLUE}./build/jarvis${NC}"