#pragma once
#include <cstdint>
#include <xf86drmMode.h>

struct gbm_bo;

namespace draw_ticker
{

    // Clear the mapped buffer to a color (0x00RRGGBB)
    void clear_buffer(void *map, uint32_t stride, uint32_t width, uint32_t height, uint32_t color);

    // Draw a solid line from (x0,y0) to (x1,y1) with given color and thickness.
    // map is a pointer to the mapped BO, stride in bytes.
    void draw_line(void *map, uint32_t stride, uint32_t width, uint32_t height,
                   int x0, int y0, int x1, int y1, uint32_t color, int thickness);

    // Animate a moving line between two points by repeatedly mapping/unmapping the GBM BO.
    // Parameters:
    // - fd, crtc_id, conn_id, mode, fb_id: DRM objects (main opens/selects device)
    // - bo: GBM buffer object to map/unmap each frame
    // - x0,y0,x1,y1: points to draw between
    // - color: 0x00RRGGBB
    // - thickness: pixels
    // - duration_seconds: total duration
    // - fps: frames per second
    void build_line(int fd, struct gbm_bo *bo, uint32_t fb_id,
                    uint32_t crtc_id, uint32_t conn_id, drmModeModeInfo mode,
                    int x0, int y0, int x1, int y1,
                    uint32_t color, int thickness, int duration_seconds, int fps,
                    bool clear_background_each_frame);

} // namespace draw_ticker
