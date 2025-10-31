cmake_minimum_required(VERSION 3.16)

# Project name and language
project(JATVIS LANGUAGES CXX)

# Use modern C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

# Add executable and source files
add_executable(JATVIS
    src/main.cpp
)

# Link against OpenGL ES 2.0 and EGL
target_link_libraries(JATVIS
    EGL
    GLESv2
    m       # math library
)
