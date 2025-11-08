cmake_minimum_required(VERSION 3.16)

project(JARVIS 
    VERSION 1.0.0
    DESCRIPTION "JARVIS Hardware Display Controller"
    LANGUAGES CXX
)

# ============================================================================
# Build Configuration
# ============================================================================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Export compile commands for IDE support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Build type default
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")

# Compiler warnings and optimization
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra -Wpedantic)
    
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        add_compile_options(-g -O0)
    elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
        add_compile_options(-O3)
    endif()
endif()

# ============================================================================
# Dependencies
# ============================================================================
find_package(PkgConfig REQUIRED)
find_package(OpenSSL REQUIRED)

# GBM and DRM with fallback
pkg_check_modules(GBM QUIET gbm)
pkg_check_modules(DRM QUIET libdrm)

if(NOT GBM_FOUND)
    message(STATUS "pkg-config couldn't find 'gbm' — attempting manual search")
    find_path(GBM_INCLUDE_DIR gbm.h)
    find_library(GBM_LIBRARY NAMES gbm libgbm)
    if(GBM_INCLUDE_DIR AND GBM_LIBRARY)
        set(GBM_INCLUDE_DIRS ${GBM_INCLUDE_DIR})
        set(GBM_LIBRARIES ${GBM_LIBRARY})
        set(GBM_FOUND TRUE)
    endif()
endif()

if(NOT DRM_FOUND)
    message(STATUS "pkg-config couldn't find 'libdrm' — attempting manual search")
    find_path(DRM_INCLUDE_DIR xf86drm.h)
    find_library(DRM_LIBRARY NAMES drm libdrm)
    if(DRM_INCLUDE_DIR AND DRM_LIBRARY)
        set(DRM_INCLUDE_DIRS ${DRM_INCLUDE_DIR})
        set(DRM_LIBRARIES ${DRM_LIBRARY})
        set(DRM_FOUND TRUE)
    endif()
endif()

if(NOT GBM_FOUND OR NOT DRM_FOUND)
    message(FATAL_ERROR 
        "Could not find GBM and/or libdrm development files.\n"
        "On Debian/Ubuntu/Raspberry Pi OS:\n"
        "  sudo apt update && sudo apt install libgbm-dev libdrm-dev libegl1-mesa-dev libgles2-mesa-dev pkg-config\n"
        "On Fedora:\n"
        "  sudo dnf install mesa-libgbm-devel libdrm-devel mesa-libEGL-devel mesa-libGLES-devel pkgconf-pkg-config\n"
        "On Arch:\n"
        "  sudo pacman -Syu mesa libdrm pkgconf"
    )
endif()

# ============================================================================
# Core Library (reusable components)
# ============================================================================
add_library(jarvis_core STATIC
    src/crypto.cpp
    src/draw_ticker.cpp
    src/http_client.cpp
    src/renderer.cpp
    src/camera.cpp
    src/hand_detector.cpp
    src/hand_detector_config.cpp
    src/hand_detector_simd.cpp
)

target_include_directories(jarvis_core
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${GBM_INCLUDE_DIRS}
        ${DRM_INCLUDE_DIRS}
        ${OPENSSL_INCLUDE_DIR}
)

target_link_libraries(jarvis_core
    PUBLIC
        ${OPENSSL_LIBRARIES}
    PRIVATE
        ${GBM_LIBRARIES}
        ${DRM_LIBRARIES}
        m
)

# Pass pkg-config cflags if available
if(GBM_CFLAGS_OTHER)
    target_compile_options(jarvis_core PRIVATE ${GBM_CFLAGS_OTHER})
endif()

# ============================================================================
# Main Executable
# ============================================================================
add_executable(JARVIS src/main.cpp)

target_link_libraries(JARVIS
    PRIVATE
        jarvis_core
        ${GBM_LIBRARIES}
        ${DRM_LIBRARIES}
)

target_include_directories(JARVIS
    PRIVATE
        ${GBM_INCLUDE_DIRS}
        ${DRM_INCLUDE_DIRS}
)

# ============================================================================
# Testing
# ============================================================================
option(BUILD_TESTING "Build tests" ON)

if(BUILD_TESTING)
    enable_testing()
    
    # Find or fetch Google Test
    find_package(GTest QUIET)
    
    if(NOT GTest_FOUND)
        message(STATUS "GTest not found, will use FetchContent")
        include(FetchContent)
        FetchContent_Declare(
            googletest
            GIT_REPOSITORY https://github.com/google/googletest.git
            GIT_TAG v1.14.0
        )
        # For Windows: Prevent overriding parent project's compiler/linker settings
        set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
        FetchContent_MakeAvailable(googletest)
    endif()
    
    # Test executable
    add_executable(jarvis_tests
        tests/test_crypto.cpp
        tests/test_http_client.cpp
        tests/test_hand_detector.cpp
    )
    
    target_link_libraries(jarvis_tests
        PRIVATE
            jarvis_core
            GTest::gtest_main
    )
    
    # Discover tests
    include(GoogleTest)
    gtest_discover_tests(jarvis_tests)
    
    message(STATUS "Testing enabled - run with 'ctest' or 'make test'")
endif()

# ============================================================================
# Installation (optional)
# ============================================================================
install(TARGETS JARVIS
    RUNTIME DESTINATION bin
)

install(DIRECTORY include/
    DESTINATION include/jarvis
    FILES_MATCHING PATTERN "*.hpp"
)

# ============================================================================
# Summary
# ============================================================================
message(STATUS "")
message(STATUS "JARVIS Configuration Summary")
message(STATUS "============================")
message(STATUS "  Version:        ${PROJECT_VERSION}")
message(STATUS "  Build type:     ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ Standard:   ${CMAKE_CXX_STANDARD}")
message(STATUS "  Testing:        ${BUILD_TESTING}")
message(STATUS "  GBM found:      ${GBM_FOUND}")
message(STATUS "  DRM found:      ${DRM_FOUND}")
message(STATUS "  OpenSSL:        ${OPENSSL_VERSION}")
message(STATUS "")

