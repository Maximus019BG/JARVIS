#pragma once

#include <cstdint>
#include <vector>

namespace hand_detector {
namespace simd {

// SIMD-accelerated RGB to HSV conversion
// Uses ARM NEON intrinsics on Raspberry Pi 5
void convert_rgb_to_hsv_simd(const uint8_t* __restrict rgb, 
                              uint8_t* __restrict hsv,
                              uint32_t pixel_count) noexcept;

// SIMD-accelerated skin masking
void create_skin_mask_simd(const uint8_t* __restrict hsv,
                           uint8_t* __restrict mask,
                           uint32_t pixel_count,
                           int hue_min, int hue_max,
                           int sat_min, int sat_max,
                           int val_min, int val_max) noexcept;

// Check if SIMD is available at runtime
[[nodiscard]] bool is_neon_available() noexcept;

// Fallback scalar implementations
namespace scalar {
    void convert_rgb_to_hsv(const uint8_t* __restrict rgb, 
                            uint8_t* __restrict hsv,
                            uint32_t pixel_count) noexcept;
    
    void create_skin_mask(const uint8_t* __restrict hsv,
                          uint8_t* __restrict mask,
                          uint32_t pixel_count,
                          int hue_min, int hue_max,
                          int sat_min, int sat_max,
                          int val_min, int val_max) noexcept;
} // namespace scalar

} // namespace simd
} // namespace hand_detector
