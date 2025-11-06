#include "draw_ticker.hpp"
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <iostream>
#include <unistd.h>
#include <gbm.h>
#include <xf86drmMode.h>

const uint32_t BACKGROUND_COLOR = 0x00000000; // black

namespace draw_ticker
{

    void clear_buffer(void *map, uint32_t stride, uint32_t width, uint32_t height, uint32_t color)
    {
        uint8_t *bytes = reinterpret_cast<uint8_t *>(map);
        for (uint32_t y = 0; y < height; ++y)
        {
            uint32_t *row = reinterpret_cast<uint32_t *>(bytes + y * stride);
            for (uint32_t x = 0; x < width; ++x)
                row[x] = color;
        }
    }

    void draw_line(void *map, uint32_t stride, uint32_t width, uint32_t height,
                   int x0, int y0, int x1, int y1, uint32_t color, int thickness)
    {
        int dx = std::abs(x1 - x0);
        int sx = x0 < x1 ? 1 : -1;
        int dy = -std::abs(y1 - y0);
        int sy = y0 < y1 ? 1 : -1;
        int err = dx + dy;
        uint8_t *bytes = reinterpret_cast<uint8_t *>(map);

        while (true)
        {
            if (x0 >= 0 && x0 < (int)width && y0 >= 0 && y0 < (int)height)
            {
                uint32_t *row = reinterpret_cast<uint32_t *>(bytes + y0 * stride);
                int half = std::max(0, thickness / 2);
                for (int t = -half; t <= half; ++t)
                {
                    int xx = x0 + t;
                    if (xx >= 0 && xx < (int)width)
                        row[xx] = color;
                }
            }
            if (x0 == x1 && y0 == y1)
                break;
            int e2 = 2 * err;
            if (e2 >= dy)
            {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx)
            {
                err += dx;
                y0 += sy;
            }
        }
    }

    void build_line(int fd, struct gbm_bo *bo, uint32_t fb_id,
                    uint32_t crtc_id, uint32_t conn_id, drmModeModeInfo mode,
                    int x0, int y0, int x1, int y1,
                    uint32_t color, int thickness, int duration_seconds, int fps,
                    bool clear_background_each_frame)
    {
        if (!bo)
            return;
        const int frames = std::max(1, duration_seconds * fps);
        for (int f = 0; f < frames; ++f)
        {
            uint32_t map_stride = 0;
            void *map_data = nullptr;
            void *ret = gbm_bo_map(bo, 0, 0, mode.hdisplay, mode.vdisplay, GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
            if (!ret)
            {
                std::cerr << "gbm_bo_map failed in build_line" << std::endl;
                break;
            }

            if (clear_background_each_frame)
            {
                clear_buffer(map_data, map_stride, mode.hdisplay, mode.vdisplay, BACKGROUND_COLOR);
            }

            float t = frames > 1 ? float(f) / float(frames - 1) : 1.0f;
            int cur_x = int((1.0f - t) * x0 + t * x1 + 0.5f);
            int cur_y = int((1.0f - t) * y0 + t * y1 + 0.5f);

            draw_line(map_data, map_stride, mode.hdisplay, mode.vdisplay, x0, y0, cur_x, cur_y, color, thickness);

            gbm_bo_unmap(bo, map_data);

            if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
            {
                std::cerr << "drmModeSetCrtc failed during build_line: " << strerror(errno) << "\n";
                break;
            }

            usleep(1000000 / std::max(1, fps));
        }
    }

} // namespace draw_ticker
