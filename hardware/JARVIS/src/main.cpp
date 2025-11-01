#include <iostream>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <cstdlib>
#include <cerrno>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <dirent.h>
#include <sys/types.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <gbm.h>
#include <drm_fourcc.h>
#include "lib/draw_ticker.h"

static void fatal(const char *msg)
{
    std::cerr << msg << "\n";
    std::exit(EXIT_FAILURE);
}

int main()
{
    // Try to auto-detect the correct DRM device (e.g. /dev/dri/card1 on some Pi setups)
    DIR *d = opendir("/dev/dri");
    if (!d)
    {
        std::cerr << "Failed to open /dev/dri: " << strerror(errno) << "\n";
        return 1;
    }

    struct dirent *ent;
    int fd = -1;
    drmModeRes *res = nullptr;
    drmModeConnector *conn = nullptr;
    drmModeModeInfo mode;
    uint32_t conn_id = 0;
    std::string chosen_dev;

    while ((ent = readdir(d)) != NULL)
    {
        if (strncmp(ent->d_name, "card", 4) != 0)
            continue;
        std::string path = std::string("/dev/dri/") + ent->d_name;
        int tryfd = open(path.c_str(), O_RDWR | O_CLOEXEC);
        if (tryfd < 0)
            continue;
        drmModeRes *tryres = drmModeGetResources(tryfd);
        if (!tryres)
        {
            close(tryfd);
            continue;
        }

        // search for a connected connector on this device
        bool found = false;
        for (int i = 0; i < tryres->count_connectors; ++i)
        {
            drmModeConnector *c = drmModeGetConnector(tryfd, tryres->connectors[i]);
            if (!c)
                continue;
            if (c->connection == DRM_MODE_CONNECTED && c->count_modes > 0)
            {
                // use this device
                fd = tryfd;
                res = tryres;
                conn = c;
                mode = c->modes[0];
                conn_id = c->connector_id;
                chosen_dev = path;
                found = true;
                break;
            }
            drmModeFreeConnector(c);
        }
        if (found)
            break;
        drmModeFreeResources(tryres);
        close(tryfd);
    }
    closedir(d);

    if (fd < 0)
    {
        std::cerr << "Could not find a suitable /dev/dri/card* with a connected connector.\n";
        std::cerr << "Available /dev/dri entries: use ls -l /dev/dri and check which card has a connected connector under /sys/class/drm/.\n";
        return 1;
    }

    std::cerr << "Using DRM device: " << chosen_dev << " (fd=" << fd << ")\n";

    // find encoder/crtc
    drmModeEncoder *enc = drmModeGetEncoder(fd, conn->encoder_id);
    uint32_t crtc_id = 0;
    drmModeCrtc *old_crtc = nullptr;
    if (enc)
    {
        if (enc->crtc_id)
        {
            crtc_id = enc->crtc_id;
        }
        else
        {
            // try to find a possible crtc
            for (int i = 0; i < res->count_encoders; ++i)
            {
                drmModeEncoder *e = drmModeGetEncoder(fd, res->encoders[i]);
                if (!e)
                    continue;
                for (int j = 0; j < res->count_crtcs; ++j)
                {
                    if (e->possible_crtcs & (1 << j))
                    {
                        crtc_id = res->crtcs[j];
                        break;
                    }
                }
                drmModeFreeEncoder(e);
                if (crtc_id)
                    break;
            }
        }
    }

    if (!crtc_id)
    {
        // fallback: pick first CRTC
        if (res->count_crtcs > 0)
            crtc_id = res->crtcs[0];
    }

    if (!crtc_id)
        fatal("Failed to find a CRTC");

    old_crtc = drmModeGetCrtc(fd, crtc_id);

    uint32_t width = mode.hdisplay;
    uint32_t height = mode.vdisplay;

    // Use GBM to create a buffer object suitable for scanout and mapping
    struct gbm_device *gbm = gbm_create_device(fd);
    if (!gbm)
    {
        std::cerr << "gbm_create_device failed\n";
        return 1;
    }

    struct gbm_bo *bo = gbm_bo_create(gbm, width, height, GBM_FORMAT_XRGB8888,
                                      GBM_BO_USE_SCANOUT | GBM_BO_USE_WRITE);
    if (!bo)
    {
        std::cerr << "gbm_bo_create failed\n";
        gbm_device_destroy(gbm);
        return 1;
    }

    uint32_t fb_id = 0;
    uint32_t handle = gbm_bo_get_handle(bo).u32;
    uint32_t pitch = gbm_bo_get_stride(bo);

    uint32_t handles[4] = {handle, 0, 0, 0};
    uint32_t pitches[4] = {pitch, 0, 0, 0};
    uint32_t offsets[4] = {0, 0, 0, 0};

    if (drmModeAddFB2(fd, width, height, DRM_FORMAT_XRGB8888, handles, pitches, offsets, &fb_id, 0))
    {
        std::cerr << "drmModeAddFB2 failed: " << strerror(errno) << "\n";
        gbm_bo_destroy(bo);
        gbm_device_destroy(gbm);
        return 1;
    }

    // Use the draw_ticker library to animate a line from point A to point B.
    // Configure these values as needed.
    int start_x = 1358;
    int start_y = 987;
    int end_x = 2448;
    int end_y = 1087;
    uint32_t color = 0x00FF0000; // red
    int thickness = 50;
    int duration_seconds = 1;
    int fps = 30;

    draw_ticker::build_line(fd, bo, fb_id, crtc_id, conn_id, mode,
                            start_x, start_y, end_x, end_y,
                            color, thickness, duration_seconds, fps,
                            true /* clear background each frame */);

    int start_x_2 = 200;
    int start_y_2 = 1400;
    int end_x_2 = 47;
    int end_y_2 = 23;
    uint32_t color_2 = 0x0000FF00; // dark green
    int thickness_2 = 25;
    int duration_seconds_2 = 2;
    int fps_2 = 30;

    // Draw a second line with different parameters
    draw_ticker::build_line(fd, bo, fb_id, crtc_id, conn_id, mode,
                            start_x_2, start_y_2, end_x_2, end_y_2,
                            color_2, thickness_2, duration_seconds_2, fps_2,
                            false /* preserve previous drawing */);

    // restore old crtc if present
    if (old_crtc)
    {
        drmModeSetCrtc(fd, old_crtc->crtc_id, old_crtc->buffer_id, old_crtc->x, old_crtc->y, &conn_id, 1, &old_crtc->mode);
        drmModeFreeCrtc(old_crtc);
    }

    // cleanup
    drmModeRmFB(fd, fb_id);
    gbm_bo_destroy(bo);
    gbm_device_destroy(gbm);
    drmModeFreeConnector(conn);
    drmModeFreeResources(res);
    close(fd);
    return 0;
}