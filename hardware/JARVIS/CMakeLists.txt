cmake_minimum_required(VERSION 3.16)

project(JARVIS LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

add_executable(JARVIS src/main.cpp)
# add lib sources
target_sources(JARVIS PRIVATE src/lib/draw_ticker.cpp
                        src/lib/http_client.cpp 
                        src/lib/renderer.cpp)

find_package(PkgConfig REQUIRED)

# Prefer pkg-config, but fall back to manual find if pkg-config data is missing
pkg_check_modules(GBM QUIET gbm)
pkg_check_modules(DRM QUIET libdrm)

if(NOT GBM_FOUND)
    message(STATUS "pkg-config couldn't find 'gbm' — attempting manual search for gbm.h and libgbm")
    find_path(GBM_INCLUDE_DIR gbm.h)
    find_library(GBM_LIBRARY NAMES gbm libgbm)
    if(GBM_INCLUDE_DIR AND GBM_LIBRARY)
        set(GBM_INCLUDE_DIRS ${GBM_INCLUDE_DIR})
        set(GBM_LIBRARIES ${GBM_LIBRARY})
        set(GBM_FOUND TRUE)
    endif()
endif()

if(NOT DRM_FOUND)
    message(STATUS "pkg-config couldn't find 'libdrm' — attempting manual search for xf86drm.h and libdrm")
    find_path(DRM_INCLUDE_DIR xf86drm.h)
    find_library(DRM_LIBRARY NAMES drm libdrm)
    if(DRM_INCLUDE_DIR AND DRM_LIBRARY)
        set(DRM_INCLUDE_DIRS ${DRM_INCLUDE_DIR})
        set(DRM_LIBRARIES ${DRM_LIBRARY})
        set(DRM_FOUND TRUE)
    endif()
endif()

if(NOT GBM_FOUND OR NOT DRM_FOUND)
    message(FATAL_ERROR "Could not find GBM and/or libdrm development files.\nPlease install the system packages that provide gbm.h and xf86drm.h.\nOn Debian/Ubuntu/Raspberry Pi OS: sudo apt update && sudo apt install libgbm-dev libdrm-dev libegl1-mesa-dev libgles2-mesa-dev pkg-config\nOn Fedora: sudo dnf install mesa-libgbm-devel libdrm-devel mesa-libEGL-devel mesa-libGLES-devel pkgconf-pkg-config\nOn Arch: sudo pacman -Syu mesa libdrm pkgconf")
endif()

target_include_directories(JARVIS PRIVATE
    ${GBM_INCLUDE_DIRS}
    ${DRM_INCLUDE_DIRS}
)

target_link_libraries(JARVIS PRIVATE
    ${GBM_LIBRARIES}
    ${DRM_LIBRARIES}
    m
)

# Pass any necessary cflags from pkg-config to the target
if(GBM_CFLAGS)
    target_compile_options(JARVIS PRIVATE ${GBM_CFLAGS_OTHER})
endif()

