#include <iostream>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <cstdlib>
#include <cerrno>
#include <iomanip>
#include <sys/mman.h>
#include <sys/ioctl.h>
#include <dirent.h>
#include <sys/types.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <gbm.h>
#include <drm_fourcc.h>
#include <drm.h>
#include <drm_mode.h>
#include <string>
#include <vector>

#include "draw_ticker.hpp"
#include "http_client.hpp"
#include "renderer.hpp"
#include "crypto.hpp"
#include "camera.hpp"
#include "hand_detector.hpp"
#include "hand_detector_production.hpp"
#include "hand_detector_mediapipe.hpp"
#include "hand_detector_hybrid.hpp"
#include "sketch_pad.hpp"

#define JARVIS_BLUEPRINT_ID "TestBlueprint456"

static void fatal(const char *msg)
{
    std::cerr << msg << "\n";
    std::exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
    // ---------------------------------------------------------------------------
    // Startup argument parsing (lightweight, no external deps)
    // Supported flags:
    //   --imx500         Enable IMX500 NPU postprocessing (sets env var)
    //   --model <path>   Override hand landmark model path (env JARVIS_MODEL_PATH)
    // ---------------------------------------------------------------------------
    for (int i = 1; i < argc; ++i)
    {
        std::string arg = argv[i];
        if (arg == "--imx500")
        {
            setenv("JARVIS_USE_IMX500_POSTPROCESS", "1", 1);
        }
        else if (arg == "--model" && i + 1 < argc)
        {
            setenv("JARVIS_MODEL_PATH", argv[i + 1], 1);
            ++i;
        }
        else if (arg == "--help" || arg == "-h")
        {
            std::cout << "JARVIS Options:\n"
                      << "  --imx500            Enable IMX500 hand landmark acceleration\n"
                      << "  --model <path>      Override hand landmark model file\n"
                      << "  --help              Show this help\n\n";
            return 0;
        }
    }

    // If no arguments provided, enable IMX500 by default
    if (argc == 0)
    {
        setenv("JARVIS_USE_IMX500_POSTPROCESS", "1", 1);
    }

    // Auto-enable IMX500 if config/json present and not explicitly disabled
    if (getenv("JARVIS_USE_IMX500_POSTPROCESS") == nullptr)
    {
        const char *hand_json = "/usr/share/rpi-camera-assets/imx500_hand_landmarks.json";
        if (access(hand_json, R_OK) == 0)
        {
            setenv("JARVIS_USE_IMX500_POSTPROCESS", "1", 1);
        }
    }

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

    // Framebuffer setup: try GBM first; if it fails, fall back to DRM dumb buffer
    bool use_gbm = true;
    struct gbm_device *gbm = gbm_create_device(fd);
    struct gbm_bo *bo = nullptr;
    uint32_t fb_id = 0;

    // Dumb buffer state
    uint32_t dumb_handle = 0;
    uint32_t dumb_pitch = 0;
    uint64_t dumb_size = 0;
    void *dumb_map = nullptr;

    if (!gbm)
    {
        std::cerr << "gbm_create_device failed — attempting dumb buffer fallback\n";
        use_gbm = false;
    }

    if (use_gbm)
    {
        bo = gbm_bo_create(gbm, width, height, GBM_FORMAT_XRGB8888,
                           GBM_BO_USE_SCANOUT | GBM_BO_USE_WRITE);
        if (!bo)
        {
            std::cerr << "gbm_bo_create failed — attempting dumb buffer fallback\n";
            use_gbm = false;
        }
    }

    if (use_gbm)
    {
        uint32_t handle = gbm_bo_get_handle(bo).u32;
        uint32_t pitch = gbm_bo_get_stride(bo);
        uint32_t handles[4] = {handle, 0, 0, 0};
        uint32_t pitches[4] = {pitch, 0, 0, 0};
        uint32_t offsets[4] = {0, 0, 0, 0};
        if (drmModeAddFB2(fd, width, height, DRM_FORMAT_XRGB8888, handles, pitches, offsets, &fb_id, 0))
        {
            std::cerr << "drmModeAddFB2 failed — attempting dumb buffer fallback: " << strerror(errno) << "\n";
            gbm_bo_destroy(bo);
            bo = nullptr;
            gbm_device_destroy(gbm);
            gbm = nullptr;
            use_gbm = false;
        }
    }

    if (!use_gbm)
    {
        // Create a dumb buffer
        struct drm_mode_create_dumb creq = {};
        creq.width = width;
        creq.height = height;
        creq.bpp = 32; // XRGB8888
        if (ioctl(fd, DRM_IOCTL_MODE_CREATE_DUMB, &creq) < 0)
        {
            std::cerr << "DRM_IOCTL_MODE_CREATE_DUMB failed: " << strerror(errno) << "\n";
            // Cleanup resources allocated earlier
            if (conn)
                drmModeFreeConnector(conn);
            if (res)
                drmModeFreeResources(res);
            if (old_crtc)
                drmModeFreeCrtc(old_crtc);
            close(fd);
            return 1;
        }
        dumb_handle = creq.handle;
        dumb_pitch = creq.pitch;
        dumb_size = creq.size;

        if (drmModeAddFB(fd, width, height, 24, 32, dumb_pitch, dumb_handle, &fb_id))
        {
            std::cerr << "drmModeAddFB (dumb) failed: " << strerror(errno) << "\n";
            struct drm_mode_destroy_dumb dreq = {};
            dreq.handle = dumb_handle;
            ioctl(fd, DRM_IOCTL_MODE_DESTROY_DUMB, &dreq);
            if (conn)
                drmModeFreeConnector(conn);
            if (res)
                drmModeFreeResources(res);
            if (old_crtc)
                drmModeFreeCrtc(old_crtc);
            close(fd);
            return 1;
        }

        struct drm_mode_map_dumb mreq = {};
        mreq.handle = dumb_handle;
        if (ioctl(fd, DRM_IOCTL_MODE_MAP_DUMB, &mreq) < 0)
        {
            std::cerr << "DRM_IOCTL_MODE_MAP_DUMB failed: " << strerror(errno) << "\n";
            drmModeRmFB(fd, fb_id);
            struct drm_mode_destroy_dumb dreq = {};
            dreq.handle = dumb_handle;
            ioctl(fd, DRM_IOCTL_MODE_DESTROY_DUMB, &dreq);
            if (conn)
                drmModeFreeConnector(conn);
            if (res)
                drmModeFreeResources(res);
            if (old_crtc)
                drmModeFreeCrtc(old_crtc);
            close(fd);
            return 1;
        }
        dumb_map = mmap(0, dumb_size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, mreq.offset);
        if (dumb_map == MAP_FAILED)
        {
            std::cerr << "mmap dumb buffer failed: " << strerror(errno) << "\n";
            drmModeRmFB(fd, fb_id);
            struct drm_mode_destroy_dumb dreq = {};
            dreq.handle = dumb_handle;
            ioctl(fd, DRM_IOCTL_MODE_DESTROY_DUMB, &dreq);
            if (conn)
                drmModeFreeConnector(conn);
            if (res)
                drmModeFreeResources(res);
            if (old_crtc)
                drmModeFreeCrtc(old_crtc);
            close(fd);
            return 1;
        }
    }

    // ---- Realtime dots from server loop ----
    // Try to load .env if JARVIS_SERVER is not present in the process env.
    auto trim_ws = [](const std::string &s)
    {
        size_t a = s.find_first_not_of(" \t\r\n");
        if (a == std::string::npos)
            return std::string();
        size_t b = s.find_last_not_of(" \t\r\n");
        return s.substr(a, b - a + 1);
    };

    if (const char *existing = std::getenv("JARVIS_SERVER"); !(existing && *existing))
    {
        // Candidate .env paths: CWD/.env, parent/.env, alongside executable and its parent
        std::vector<std::string> candidates;
        candidates.emplace_back(".env");
        candidates.emplace_back("../.env");
        // derive from /proc/self/exe
        char exe_path[4096] = {0};
        ssize_t n = readlink("/proc/self/exe", exe_path, sizeof(exe_path) - 1);
        if (n > 0)
        {
            std::string exe(exe_path, static_cast<size_t>(n));
            auto last_slash = exe.find_last_of('/');
            std::string exe_dir = last_slash == std::string::npos ? std::string(".") : exe.substr(0, last_slash);
            candidates.push_back(exe_dir + "/.env");
            // parent of exe_dir
            auto last2 = exe_dir.find_last_of('/');
            std::string exe_parent = last2 == std::string::npos ? std::string(".") : exe_dir.substr(0, last2);
            candidates.push_back(exe_parent + "/.env");
        }

        for (const auto &p : candidates)
        {
            FILE *f = std::fopen(p.c_str(), "r");
            if (!f)
                continue;
            char line[4096];
            while (std::fgets(line, sizeof(line), f))
            {
                std::string s(line);
                s = trim_ws(s);
                if (s.empty() || s[0] == '#')
                    continue;
                auto eq = s.find('=');
                if (eq == std::string::npos)
                    continue;
                std::string key = trim_ws(s.substr(0, eq));
                std::string val = trim_ws(s.substr(eq + 1));
                if (!key.empty())
                {
                    // do not override if already set in process env
                    if (!std::getenv(key.c_str()))
                    {
                        setenv(key.c_str(), val.c_str(), 0);
                    }
                }
            }
            std::fclose(f);
            // Stop after first readable .env
            break;
        }
    }

    // Endpoint selection (env or defaults): prefer single JARVIS_SERVER like
    //   http://example.com/api/workstation/blueprint/load
    // The client will append /[encrypted_workstation_id]/[encrypted_blueprint_id]
    std::string host = "127.0.0.1";
    uint16_t port = 8080;
    std::string path = "/dots";

    // Read device ID from environment
    std::string device_id = "TestDevice123"; // default fallback
    if (const char *env_device_id = std::getenv("JARVIS_DEVICE_ID"); env_device_id && *env_device_id)
    {
        device_id = trim_ws(env_device_id);
    }

    // Read secret for encryption
    std::string secret;
    if (const char *env_secret = std::getenv("JARVIS_SECRET"); env_secret && *env_secret)
    {
        secret = trim_ws(env_secret);
    }

    if (const char *env_server = std::getenv("JARVIS_SERVER"); env_server && *env_server)
    {
        std::string url = trim_ws(env_server);
        // strip scheme if present
        auto pos_scheme = url.find("://");
        if (pos_scheme != std::string::npos)
            url = url.substr(pos_scheme + 3);
        // split host[:port] and path
        std::string hostport = url;
        std::string new_path;
        auto slash = url.find('/');
        if (slash != std::string::npos)
        {
            hostport = url.substr(0, slash);
            new_path = url.substr(slash);
        }
        // parse host and optional port
        auto colon = hostport.rfind(':');
        if (colon != std::string::npos)
        {
            host = hostport.substr(0, colon);
            std::string port_str = hostport.substr(colon + 1);
            int p = std::atoi(port_str.c_str());
            if (p > 0 && p < 65536)
                port = static_cast<uint16_t>(p);
        }
        else
        {
            host = hostport;
        }
        if (!new_path.empty())
            path = new_path;
        if (path.empty() || path[0] != '/')
            path = "/" + path;

        // Append encrypted IDs if secret is available
        if (!secret.empty())
        {
            std::string enc_workstation = crypto::aes256_encrypt(device_id, secret);
            std::string enc_blueprint = crypto::aes256_encrypt(JARVIS_BLUEPRINT_ID, secret);
            if (!enc_workstation.empty() && !enc_blueprint.empty())
            {
                if (path.back() != '/')
                    path += "/";
                path += enc_workstation + "/" + enc_blueprint;
            }
            else
            {
                std::cerr << "Warning: encryption failed; using base path only.\n";
            }
        }
        else
        {
            std::cerr << "Warning: JARVIS_SECRET not set; using base path only.\n";
        }
    }

    std::cerr << "Polling server http://" << host << ":" << port << path << " for lines.\n";
    std::cerr << "Commands:\n";
    std::cerr << "  <Enter>      - Render a frame\n";
    std::cerr << "  hand         - Drawing mode (follow index finger)\n";
    std::cerr << "  hand-prod    - Production hand detector (testing)\n";
    std::cerr << "  load <name>  - Load a .jarvis sketch\n";
    std::cerr << "  stop         - Exit\n";

    while (true)
    {
        std::string line;
        std::getline(std::cin, line);

        if (line.empty())
        {
            // User pressed Enter; fetch and render
            bool ok = renderer::render_frame(host, port, path, use_gbm, bo, dumb_map, dumb_pitch, width, height);
            if (ok)
            {
                if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                {
                    std::cerr << "drmModeSetCrtc failed during render: " << strerror(errno) << "\n";
                    break;
                }
            }
        }
        else if (line == "hand")
        {
            // Drawing mode - follow index finger to draw
            std::cerr << "\n╔════════════════════════════════════════════════════════════╗\n";
            std::cerr << "║   JARVIS ENTERPRISE DRAWING SYSTEM FOR ARCHITECTS          ║\n";
            std::cerr << "╚════════════════════════════════════════════════════════════╝\n";

            // Ask for sketch name
            std::cout << "Enter project name: ";
            std::cout.flush();
            std::string sketch_name;
            std::getline(std::cin, sketch_name);

            if (sketch_name.empty())
            {
                sketch_name = "untitled_project";
            }

            std::cerr << "\n[SYSTEM] Initializing camera subsystem...\n";

            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 640;
            cam_config.height = 480;
            cam_config.framerate = 30;
            cam_config.verbose = false;

            if (!cam.init(cam_config))
            {
                std::cerr << "[ERROR] Camera initialization failed: " << cam.get_error() << "\n";
                std::cerr << "[INFO] Ensure IMX500 camera is connected and drivers are loaded.\n";
                continue;
            }

            if (!cam.start())
            {
                std::cerr << "[ERROR] Camera start failed: " << cam.get_error() << "\n";
                continue;
            }

            std::cerr << "[SYSTEM] Camera initialized: 640x480 @ 30fps\n";
            std::cerr << "[SYSTEM] Initializing enterprise hand detection AI...\n";

            // Use hybrid detector for best performance
            // Automatically uses IMX500 neural network if available,
            // falls back to optimized computer vision
            hand_detector::HybridDetectorConfig hybrid_config;
            hybrid_config.prefer_neural_network = true;
            hybrid_config.fallback_to_cv = true;
            hybrid_config.verbose = true;

            // Configure neural network backend (IMX500 NPU)
            hybrid_config.nn_config.model_path = "models/hand_landmark_full.tflite";
            hybrid_config.nn_config.detection_confidence = 0.65f; // Slightly lower for better detection
            hybrid_config.nn_config.landmark_confidence = 0.60f;
            hybrid_config.nn_config.gesture_confidence = 0.70f;
            hybrid_config.nn_config.use_npu = true;                // CRITICAL: Use IMX500 NPU
            hybrid_config.nn_config.use_xnnpack = false;           // NPU handles acceleration
            hybrid_config.nn_config.num_threads = 2;               // Fewer threads since NPU does work
            hybrid_config.nn_config.temporal_smoothing_frames = 7; // More smoothing
            hybrid_config.nn_config.enable_tracking = true;
            hybrid_config.nn_config.enable_multi_hand = true;

            // Configure classical CV fallback
            hybrid_config.cv_config.verbose = false;
            hybrid_config.cv_config.enable_gesture = true;
            hybrid_config.cv_config.min_hand_area = 2000;
            hybrid_config.cv_config.downscale_factor = 2;

            hand_detector::HybridHandDetector detector(hybrid_config);

            std::cerr << "[SYSTEM] Hand detection initialized\n";
            std::cerr << "[SYSTEM] Backend: " << detector.get_active_backend() << "\n";

            // Initialize enterprise sketch pad
            sketch::SketchPad sketchpad(width, height);
            sketchpad.init(sketch_name, width, height);
            sketchpad.set_color(0x00FFFFFF);      // White for projection
            sketchpad.set_thickness(4);           // Clear lines for architects
            sketchpad.set_confirmation_frames(5); // 5 frame confirmation as requested
            sketchpad.enable_anti_aliasing(true);
            sketchpad.enable_subpixel_rendering(true);

            std::cerr << "[SYSTEM] Enterprise drawing system ready\n\n";
            std::cerr << "╔════════════════════════════════════════════════════════════╗\n";
            std::cerr << "║                   DRAWING INSTRUCTIONS                     ║\n";
            std::cerr << "╠════════════════════════════════════════════════════════════╣\n";
            std::cerr << "║  1. Point with index finger for 5 frames → START locked   ║\n";
            std::cerr << "║  2. Change gesture (open palm, fist, etc.)                 ║\n";
            std::cerr << "║  3. Point again for 5 frames → END locked                  ║\n";
            std::cerr << "║  4. Line drawn automatically from START to END             ║\n";
            std::cerr << "║                                                            ║\n";
            std::cerr << "║  Visual Indicators:                                        ║\n";
            std::cerr << "║    • Green circle  = START point locked                    ║\n";
            std::cerr << "║    • Yellow pulse  = Confirming END point                  ║\n";
            std::cerr << "║    • Preview line  = Current line being drawn              ║\n";
            std::cerr << "╠════════════════════════════════════════════════════════════╣\n";
            std::cerr << "║  Commands:                                                 ║\n";
            std::cerr << "║    's' - Save project                                      ║\n";
            std::cerr << "║    'c' - Clear all lines                                   ║\n";
            std::cerr << "║    'i' - Show project info                                 ║\n";
            std::cerr << "║    'q' - Quit and save                                     ║\n";
            std::cerr << "╚════════════════════════════════════════════════════════════╝\n\n";

            // Set stdin to non-blocking
            int stdin_flags = fcntl(STDIN_FILENO, F_GETFL, 0);
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags | O_NONBLOCK);

            bool quit = false;
            bool calibrated = false;
            uint64_t frame_counter = 0;
            int render_every = 2; // Render every 2 frames for smooth architects experience

            while (!quit)
            {
                camera::Frame *frame = cam.capture_frame();
                if (!frame)
                {
                    std::cerr << "[ERROR] Camera capture error: " << cam.get_error() << "\n";
                    break;
                }

                // Detect hands
                auto detections = detector.detect(*frame);
                frame_counter++;

                // Auto-calibrate on first good detection
                if (!calibrated && !detections.empty() &&
                    detections[0].bbox.confidence > 0.7f)
                {
                    if (detector.auto_calibrate(*frame))
                    {
                        std::cerr << "[SYSTEM] ✓ Auto-calibrated hand detection\n";
                        calibrated = true;
                    }
                }

                // Update sketch with hand detections
                sketchpad.update(detections);

                // Render to screen every N frames
                if (frame_counter % render_every == 0)
                {
                    void *map_data = nullptr;
                    uint32_t map_stride = 0;

                    if (use_gbm)
                    {
                        map_data = gbm_bo_map(bo, 0, 0, width, height,
                                              GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
                    }
                    else
                    {
                        map_stride = dumb_pitch;
                        map_data = dumb_map;
                    }

                    if (map_data)
                    {
                        // Clear background (black for projector)
                        draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);

                        // Render sketch with anti-aliasing
                        sketchpad.render(map_data, map_stride, width, height);

                        if (use_gbm)
                        {
                            gbm_bo_unmap(bo, map_data);
                        }

                        // Update display
                        if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                        {
                            std::cerr << "[ERROR] Display update failed\n";
                        }
                    }
                }

                // Check for commands
                char buf[16];
                ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
                if (n > 0)
                {
                    for (ssize_t i = 0; i < n; ++i)
                    {
                        char c = buf[i];
                        if (c == 'q' || c == 'Q')
                        {
                            // Save and quit
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "\n[SYSTEM] ✓ Project saved: '" << sketch_name << ".jarvis'\n";
                            }
                            quit = true;
                            break;
                        }
                        if (c == 's' || c == 'S')
                        {
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "\n[SYSTEM] ✓ Project saved: '" << sketch_name << ".jarvis'\n";
                            }
                            else
                            {
                                std::cerr << "\n[ERROR] Save failed\n";
                            }
                        }
                        if (c == 'c' || c == 'C')
                        {
                            sketchpad.clear();
                            std::cerr << "\n[SYSTEM] ✓ Project cleared\n";
                        }
                        if (c == 'i' || c == 'I')
                        {
                            std::cerr << "\n╔════════════════════════════════════════════════════════════╗\n";
                            std::cerr << "║                    PROJECT INFORMATION                     ║\n";
                            std::cerr << "╠════════════════════════════════════════════════════════════╣\n";
                            std::cerr << "║  Project: " << std::left << std::setw(48) << sketch_name << "║\n";
                            std::cerr << "║  Lines drawn: " << std::left << std::setw(44) << sketchpad.get_stroke_count() << "║\n";
                            std::cerr << "║  Resolution: " << width << "x" << height << std::setw(36) << " " << "║\n";

                            // Show current state
                            std::string state_str;
                            switch (sketchpad.get_state())
                            {
                            case sketch::DrawingState::WAITING_FOR_START:
                                state_str = "Waiting for START point (point 5 frames)";
                                break;
                            case sketch::DrawingState::START_CONFIRMED:
                                state_str = "START locked - change gesture";
                                break;
                            case sketch::DrawingState::WAITING_FOR_END:
                                state_str = "Waiting for END point (point 5 frames)";
                                break;
                            case sketch::DrawingState::END_CONFIRMED:
                                state_str = "Line completed!";
                                break;
                            }
                            std::cerr << "║  State: " << std::left << std::setw(48) << state_str << "║\n";
                            std::cerr << "╚════════════════════════════════════════════════════════════╝\n\n";
                        }
                    }
                }
            }

            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "\n[SYSTEM] Enterprise drawing session ended.\n\n";
        }
        else if (line == "hand-prod")
        {
            // Production hand recognition mode
            std::cerr << "\n=== JARVIS Production Hand Recognition Mode ===\n";
            std::cerr << "Initializing camera...\n";

            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 640;
            cam_config.height = 480;
            cam_config.framerate = 30;
            cam_config.verbose = true;

            if (!cam.init(cam_config))
            {
                std::cerr << "Failed to initialize camera: " << cam.get_error() << "\n";
                std::cerr << "Make sure rpicam is installed and camera is connected.\n";
                continue;
            }

            if (!cam.start())
            {
                std::cerr << "Failed to start camera: " << cam.get_error() << "\n";
                continue;
            }

            std::cerr << "Camera started successfully.\n";
            std::cerr << "Initializing production hand detector...\n";

            // Configure base detector
            hand_detector::DetectorConfig det_config;
            det_config.verbose = false; // Less verbose for production
            det_config.enable_gesture = true;
            det_config.min_hand_area = 2000;
            det_config.downscale_factor = 2;

            // Configure production features
            hand_detector::ProductionConfig prod_config;
            prod_config.enable_tracking = true;
            prod_config.adaptive_lighting = true;
            prod_config.gesture_stabilization_frames = 10;
            prod_config.tracking_history_frames = 5;
            prod_config.filter_low_confidence = true;
            prod_config.min_detection_quality = 0.5f;
            prod_config.verbose = true;

            hand_detector::ProductionHandDetector detector(det_config, prod_config);

            std::cerr << "Production hand detector initialized.\n";
            std::cerr << "Features enabled:\n";
            std::cerr << "  - Multi-frame tracking\n";
            std::cerr << "  - Adaptive lighting compensation\n";
            std::cerr << "  - Gesture stabilization (10 frames)\n";
            std::cerr << "  - Quality filtering\n";
            std::cerr << "\nCommands (non-blocking):\n";
            std::cerr << "  'c' - Manual calibrate (place hand in center)\n";
            std::cerr << "  'a' - Auto-calibrate from current detection\n";
            std::cerr << "  's' - Show stats\n";
            std::cerr << "  'r' - Reset tracking\n";
            std::cerr << "  'l' - Clear logs\n";
            std::cerr << "  'q' - Quit production mode\n";
            std::cerr << "Logging detections live (auto-calibration on first detection)...\n\n";

            // Set stdin to non-blocking
            int stdin_flags = fcntl(STDIN_FILENO, F_GETFL, 0);
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags | O_NONBLOCK);

            bool quit = false;
            bool calibrated = false;
            uint64_t frame_counter = 0;

            while (!quit)
            {
                camera::Frame *frame = cam.capture_frame();
                if (!frame)
                {
                    std::cerr << "Camera capture error: " << cam.get_error() << "\n";
                    break;
                }

                auto detections = detector.detect(*frame);
                frame_counter++;

                // Auto-calibrate on first good detection
                if (!calibrated && !detections.empty() &&
                    detections[0].bbox.confidence > 0.7f)
                {
                    if (detector.auto_calibrate(*frame))
                    {
                        std::cerr << "[AUTO-CALIBRATE] Successfully calibrated skin detection from hand\n";
                        calibrated = true;
                    }
                }

                // Only log when detections occur or every 30 frames
                if (!detections.empty() || frame_counter % 30 == 0)
                {
                    std::cout << "[frame " << frame_counter << "] " << detections.size() << " hand(s)";
                    if (detections.empty())
                    {
                        std::cout << "\n";
                    }
                }

                for (size_t i = 0; i < detections.size(); ++i)
                {
                    const auto &hand = detections[i];
                    std::string label = hand_detector::HandDetector::gesture_to_string(hand.gesture);

                    // Highlight main gestures
                    if (hand.gesture == hand_detector::Gesture::OPEN_PALM)
                        label = "OPEN PALM ✋";
                    else if (hand.gesture == hand_detector::Gesture::FIST)
                        label = "FIST ✊";
                    else if (hand.gesture == hand_detector::Gesture::POINTING)
                        label = "POINTING ☝";
                    else if (hand.gesture == hand_detector::Gesture::PEACE)
                        label = "PEACE ✌";
                    else if (hand.gesture == hand_detector::Gesture::OK_SIGN)
                        label = "OK 👌";

                    std::cout << "\n  ➜ Hand #" << (i + 1)
                              << ": " << label
                              << " | fingers=" << hand.num_fingers
                              << " | conf=" << (int)(hand.bbox.confidence * 100) << "%"
                              << " | pos=(" << hand.center.x << "," << hand.center.y << ")";
                }
                if (!detections.empty())
                {
                    std::cout << "\n";
                }

                // Check for commands
                char buf[16];
                ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
                if (n > 0)
                {
                    for (ssize_t i = 0; i < n; ++i)
                    {
                        char c = buf[i];
                        if (c == 'q' || c == 'Q')
                        {
                            quit = true;
                            break;
                        }
                        if (c == 's' || c == 'S')
                        {
                            auto stats = detector.get_stats();
                            std::cerr << "\n[STATS]\n";
                            std::cerr << "  Frames processed: " << stats.frames_processed << "\n";
                            std::cerr << "  Hands detected: " << stats.hands_detected << "\n";
                            std::cerr << "  Avg time: " << stats.avg_process_time_ms << " ms\n";
                            std::cerr << "  FPS: " << (1000.0 / stats.avg_process_time_ms) << "\n\n";
                        }
                        if (c == 'c' || c == 'C')
                        {
                            int roi_x = (frame->width - 100) / 2;
                            int roi_y = (frame->height - 100) / 2;
                            if (detector.calibrate_skin(*frame, roi_x, roi_y, 100, 100))
                            {
                                std::cerr << "[CALIBRATE] Manual calibration successful\n";
                                calibrated = true;
                            }
                            else
                            {
                                std::cerr << "[CALIBRATE] Manual calibration failed\n";
                            }
                        }
                        if (c == 'a' || c == 'A')
                        {
                            if (detector.auto_calibrate(*frame))
                            {
                                std::cerr << "[AUTO-CALIBRATE] Calibration successful\n";
                                calibrated = true;
                            }
                            else
                            {
                                std::cerr << "[AUTO-CALIBRATE] No hand detected for calibration\n";
                            }
                        }
                        if (c == 'r' || c == 'R')
                        {
                            detector.reset_tracking();
                            std::cerr << "[RESET] Tracking reset\n";
                        }
                        if (c == 'l' || c == 'L')
                        {
                            std::cout << "\033[2J\033[H" << std::flush;
                        }
                    }
                }
            }

            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "Exited production hand recognition mode.\n\n";
        }
        else if (line.substr(0, 5) == "load ")
        {
            // Load sketch command
            std::string sketch_name = line.substr(5);

            // Trim whitespace
            sketch_name.erase(0, sketch_name.find_first_not_of(" \t"));
            sketch_name.erase(sketch_name.find_last_not_of(" \t") + 1);

            if (sketch_name.empty())
            {
                std::cerr << "Usage: load <sketch_name>\n";
                std::cerr << "Example: load my_drawing\n";
                continue;
            }

            std::cerr << "\n=== JARVIS Load Sketch Mode ===\n";
            std::cerr << "Loading sketch: '" << sketch_name << "'\n";

            // Load sketch
            sketch::SketchPad sketchpad(width, height);
            if (!sketchpad.load(sketch_name))
            {
                std::cerr << "Failed to load sketch '" << sketch_name << ".jarvis'\n";
                std::cerr << "Make sure the file exists in the current directory.\n";
                continue;
            }

            std::cerr << "✓ Sketch loaded successfully\n";
            std::cerr << "  Strokes: " << sketchpad.get_stroke_count() << "\n";
            std::cerr << "  Points: " << sketchpad.get_total_points() << "\n";
            std::cerr << "\nRendering sketch...\n";

            // Render sketch to display
            void *map_data = nullptr;
            uint32_t map_stride = 0;

            if (use_gbm)
            {
                map_data = gbm_bo_map(bo, 0, 0, width, height,
                                      GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
            }
            else
            {
                map_stride = dumb_pitch;
                map_data = dumb_map;
            }

            if (map_data)
            {
                // Clear background
                draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);

                // Render sketch
                sketchpad.render(map_data, map_stride, width, height);

                if (use_gbm)
                {
                    gbm_bo_unmap(bo, map_data);
                }

                // Update display
                if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                {
                    std::cerr << "drmModeSetCrtc failed\n";
                }
                else
                {
                    std::cerr << "✓ Sketch displayed on screen\n";
                }
            }
            else
            {
                std::cerr << "Failed to map display buffer\n";
            }

            std::cerr << "Press Enter to continue...\n";
            std::getline(std::cin, line);
        }
        else if (line == "stop")
        {
            // User typed "stop"; exit the loop
            break;
        }
        // Ignore any other input (no message printed)
    }

    // restore old crtc if present
    if (old_crtc)
    {
        drmModeSetCrtc(fd, old_crtc->crtc_id, old_crtc->buffer_id, old_crtc->x, old_crtc->y, &conn_id, 1, &old_crtc->mode);
        drmModeFreeCrtc(old_crtc);
    }

    // cleanup
    drmModeRmFB(fd, fb_id);
    if (use_gbm)
    {
        if (bo)
            gbm_bo_destroy(bo);
        if (gbm)
            gbm_device_destroy(gbm);
    }
    else
    {
        if (dumb_map && dumb_map != MAP_FAILED)
            munmap(dumb_map, dumb_size);
        struct drm_mode_destroy_dumb dreq = {};
        dreq.handle = dumb_handle;
        ioctl(fd, DRM_IOCTL_MODE_DESTROY_DUMB, &dreq);
    }
    drmModeFreeConnector(conn);
    drmModeFreeResources(res);
    close(fd);
    return 0;
}