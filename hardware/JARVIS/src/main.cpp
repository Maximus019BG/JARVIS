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
#include <linux/fb.h>

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
#include "pipeline.hpp"

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

    // If no arguments provided (argc == 1 means only program name), enable IMX500 by default
    if (argc == 1)
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

    // Declare variables for drawing pipeline and UI
    int width = 1280;
    int height = 720;
    std::string sketch_name = "untitled_project";
    float grid_spacing_cm = 5.0f;

    // Variables for .env loading
    char exe_path[4096] = {0};
    std::vector<std::string> candidates;

    // DRM/GBM/Buffer variables
    bool use_gbm = false;
    struct gbm_bo *bo = nullptr;
    void *dumb_map = nullptr;
    uint32_t dumb_pitch = 0;
    uint32_t fb_id = 0;
    size_t dumb_size = 0;
    uint32_t dumb_handle = 0;
    struct gbm_device *gbm = nullptr;
    // Fallback framebuffer device (/dev/fb0) mapping for systems where DRM GBM mapping isn't created
    int fb0_fd = -1;
    void *fb0_map = nullptr;
    uint32_t fb0_stride = 0;
    size_t fb0_size = 0;
    uint32_t fb0_bpp = 0;

    // Helper for whitespace trimming
    auto trim_ws = [](const std::string &s) -> std::string
    {
        size_t start = s.find_first_not_of(" \t\r\n");
        if (start == std::string::npos)
            return "";
        size_t end = s.find_last_not_of(" \t\r\n");
        return s.substr(start, end - start + 1);
    };

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
                        // All pipeline/sketchpad variables are now in correct scope
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
                    // End of .env loading block
                }
            }
        }
    }

    // --------- MAIN EVENT LOOP AND PIPELINE LOGIC GOES HERE ---------
    // Place the main UI/command loop and pipeline logic here, after all setup is complete.
    // ...existing code for UI/command loop, pipeline, etc...

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
    std::cerr << "  blueprint    - Drawing mode (follow index finger)\n";
    std::cerr << "  test         - Production hand detector (testing)\n";
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
        else if (line == "blueprint")
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

            // Ask for grid spacing
            std::cout << "Enter grid spacing in cm (default: 5): ";
            std::cout.flush();
            std::string spacing_input;
            std::getline(std::cin, spacing_input);
            float grid_spacing_cm = 5.0f;
            if (!spacing_input.empty())
            {
                try
                {
                    grid_spacing_cm = std::stof(spacing_input);
                    if (grid_spacing_cm <= 0.0f)
                        grid_spacing_cm = 5.0f;
                }
                catch (...)
                {
                    grid_spacing_cm = 5.0f;
                }
            }

            std::cerr << "\n[SYSTEM] Initializing camera subsystem...\n";

            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 1280;
            cam_config.height = 720;
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

            std::cerr << "[SYSTEM] Camera initialized: 1280x720 @ 30fps\n";
            std::cerr << "[SYSTEM] Initializing production hand detector...\n";

            // Configure base detector
            hand_detector::DetectorConfig det_config;
            det_config.verbose = false;
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
            prod_config.verbose = false;

            hand_detector::ProductionHandDetector detector(det_config, prod_config);

            std::cerr << "[SYSTEM] Hand detection initialized\n";
            std::cerr << "[SYSTEM] Features: Multi-frame tracking, Adaptive lighting, Gesture stabilization\n";

            // Initialize enterprise sketch pad
            sketch::SketchPad sketchpad(width, height);
            sketchpad.init(sketch_name, width, height);
            sketchpad.set_color(0x00FFFFFF);      // White for projection
            sketchpad.set_thickness(4);           // Clear lines for architects
            sketchpad.set_confirmation_frames(2); // 2 frame confirmation with tolerance
            sketchpad.enable_anti_aliasing(true);
            sketchpad.enable_subpixel_rendering(true);

            // Configure grid system
            sketchpad.set_grid_enabled(true);
            sketchpad.set_real_world_spacing(grid_spacing_cm);
            sketchpad.set_snap_to_grid(true);
            sketchpad.set_show_measurements(true);

            // Try an immediate initial render of the grid so the user sees it
            // as soon as they enter blueprint mode (if display buffer is ready).
            {
                void *map_data = nullptr;
                uint32_t map_stride = 0;

                if (use_gbm && bo)
                {
                    void *ret = gbm_bo_map(bo, 0, 0, width, height, GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
                    if (!ret)
                    {
                        std::cerr << "[SketchPad] Initial render: gbm_bo_map failed\n";
                    }
                    else
                    {
                        draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);
                        sketchpad.render(map_data, map_stride, width, height);
                        gbm_bo_unmap(bo, map_data);
                        if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                        {
                            std::cerr << "[SketchPad] Initial render: drmModeSetCrtc failed\n";
                        }
                    }
                }
                else if (dumb_map)
                {
                    map_stride = dumb_pitch;
                    map_data = dumb_map;
                    draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);
                    sketchpad.render(map_data, map_stride, width, height);
                    if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                    {
                        std::cerr << "[SketchPad] Initial render: drmModeSetCrtc failed\n";
                    }
                }
                else
                {
                    std::cerr << "[SketchPad] Initial render: display buffer not initialized; grid will appear on next render pass.\n";
                }
            }
            // If display buffer wasn't initialized via DRM/GBM, try mapping /dev/fb0 now and re-render there
            if (!use_gbm && !dumb_map && !fb0_map)
            {
                int fb = open("/dev/fb0", O_RDWR);
                if (fb >= 0)
                {
                    struct fb_var_screeninfo vinfo;
                    struct fb_fix_screeninfo finfo;
                    if (ioctl(fb, FBIOGET_FSCREENINFO, &finfo) == -1 || ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) == -1)
                    {
                        std::cerr << "[SketchPad] FB ioctl failed when attempting /dev/fb0 fallback: " << strerror(errno) << "\n";
                        close(fb);
                    }
                    else
                    {
                        fb0_stride = finfo.line_length;
                        fb0_bpp = vinfo.bits_per_pixel;
                        fb0_size = finfo.smem_len;
                        void *m = mmap(NULL, fb0_size, PROT_READ | PROT_WRITE, MAP_SHARED, fb, 0);
                        if (m == MAP_FAILED)
                        {
                            std::cerr << "[SketchPad] mmap(/dev/fb0) failed: " << strerror(errno) << "\n";
                            close(fb);
                        }
                        else
                        {
                            fb0_fd = fb;
                            fb0_map = m;
                            std::cerr << "[SketchPad] Mapped /dev/fb0: " << vinfo.xres << "x" << vinfo.yres << " bpp=" << vinfo.bits_per_pixel << "\n";
                            // Re-init sketchpad to framebuffer resolution so percentage mapping is correct
                            sketchpad.init(sketch_name, vinfo.xres, vinfo.yres);
                            // Render immediately
                            draw_ticker::clear_buffer(fb0_map, fb0_stride, vinfo.xres, vinfo.yres, 0x00000000);
                            sketchpad.render(fb0_map, fb0_stride, vinfo.xres, vinfo.yres);
                            msync(fb0_map, fb0_size, MS_SYNC);
                        }
                    }
                }
            }
            std::cerr << "[SYSTEM] Enterprise drawing system ready\n\n";
            std::cerr << "╔════════════════════════════════════════════════════════════╗\n";
            std::cerr << "║                   DRAWING INSTRUCTIONS                     ║\n";
            std::cerr << "╠════════════════════════════════════════════════════════════╣\n";
            std::cerr << "║  1. Point/Peace gesture for 2 frames → START locked       ║\n";
            std::cerr << "║  2. Move hand and change gesture (open palm, fist, etc.)   ║\n";
            std::cerr << "║  3. Point/Peace gesture for 2 frames → END locked          ║\n";
            std::cerr << "║  4. Line drawn with real-world measurement                 ║\n";
            std::cerr << "║                                                            ║\n";
            std::cerr << "║  Grid System:                                              ║\n";
            std::cerr << "║    • Points snap to grid intersections                     ║\n";
            std::cerr << "║    • Each grid square = " << grid_spacing_cm << " cm                            ║\n";
            std::cerr << "║    • Yellow markers show measurement points                ║\n";
            std::cerr << "║                                                            ║\n";
            std::cerr << "║  Visual Indicators:                                        ║\n";
            std::cerr << "║    • Green circle  = START point locked                    ║\n";
            std::cerr << "║    • Yellow pulse  = Confirming END point                  ║\n";
            std::cerr << "║    • Preview line  = Current line being drawn              ║\n";
            std::cerr << "║    • Gray grid     = Reference grid with snapping          ║\n";
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

            // For simplified Enter-driven drawing: track last fingertip (percent coords)
            sketch::Point last_tip_percent(0, 0);
            bool have_last_tip = false;
            bool have_start_point = false;
            sketch::Point start_point_percent(0, 0);

            while (!quit)
            {
                camera::Frame *frame = cam.capture_frame();
                if (!frame)
                {
                    std::cerr << "[ERROR] Camera capture error: " << cam.get_error() << "\n";
                    // Extra diagnostics for 10x debugging
                    std::cerr << "[DEBUG] Camera config: "
                              << "width=" << cam.get_config().width << ", "
                              << "height=" << cam.get_config().height << ", "
                              << "framerate=" << cam.get_config().framerate << "\n";
                    std::cerr << "[DEBUG] Expected YUV size: "
                              << (cam.get_config().width * cam.get_config().height * 3 / 2) << " bytes\n";
                    std::cerr << "[DEBUG] If using rpicam-vid, try running manually: "
                              << "rpicam-vid -t 0 -n --codec yuv420 --width " << cam.get_config().width
                              << " --height " << cam.get_config().height
                              << " --framerate " << cam.get_config().framerate << " -o - | hexdump -C | head" << std::endl;
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

                // Display detection info (similar to test mode)
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

                    // Highlight drawing gestures
                    if (hand.gesture == hand_detector::Gesture::OPEN_PALM)
                        label = "OPEN PALM ✋";
                    else if (hand.gesture == hand_detector::Gesture::FIST)
                        label = "FIST ✊";
                    else if (hand.gesture == hand_detector::Gesture::POINTING)
                        label = "POINTING ☝ [DRAWING]";
                    else if (hand.gesture == hand_detector::Gesture::PEACE)
                        label = "PEACE ✌ [DRAWING]";
                    else if (hand.gesture == hand_detector::Gesture::OK_SIGN)
                        label = "OK 👌";

                    std::cout << "\n  ➜ Hand #" << (i + 1)
                              << ": " << label
                              << " | fingers=" << hand.num_fingers
                              << " | conf=" << (int)(hand.bbox.confidence * 100) << "%"
                              << " | pos=(" << (int)hand.center.x << "," << (int)hand.center.y << ")";

                    // Show fingertip position if available
                    if (!hand.fingertips.empty())
                    {
                        std::cout << " | tip=(" << (int)hand.fingertips[0].x << "," << (int)hand.fingertips[0].y << ")";
                    }
                }
                if (!detections.empty())
                {
                    std::cout << "\n";
                }

                // Update sketch with hand detections
                sketchpad.update(detections);

                // Track last fingertip when pointing/peace gestures are detected
                if (!detections.empty())
                {
                    // choose highest-confidence pointing/peace detection
                    float best_conf = 0.0f;
                    const hand_detector::HandDetection *best_hand = nullptr;
                    for (const auto &h : detections)
                    {
                        if ((h.gesture == hand_detector::Gesture::POINTING || h.gesture == hand_detector::Gesture::PEACE) && h.bbox.confidence > best_conf)
                        {
                            best_conf = h.bbox.confidence;
                            best_hand = &h;
                        }
                    }
                    if (best_hand && best_conf > 0.5f)
                    {
                        float px, py;
                        if (!best_hand->fingertips.empty())
                        {
                            px = best_hand->fingertips[0].x;
                            py = best_hand->fingertips[0].y;
                        }
                        else
                        {
                            px = best_hand->center.x;
                            py = best_hand->center.y;
                        }
                        last_tip_percent = sketch::Point::from_pixels(px, py, sketchpad.get_sketch().width, sketchpad.get_sketch().height);
                        have_last_tip = true;
                        std::cerr << "[Blueprint] Last tip: (" << last_tip_percent.x << "," << last_tip_percent.y << ")\n";
                    }
                }

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
                    else if (fb0_map)
                    {
                        // Fallback rendering directly to /dev/fb0 mmap
                        // fb0_stride/fb0_map were set earlier when mapping /dev/fb0
                        // Use fb0 resolution for render
                        // We assume sketchpad was re-init'd to fb resolution when mapping occurred
                        draw_ticker::clear_buffer(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height, 0x00000000);
                        sketchpad.render(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height);
                        msync(fb0_map, fb0_size, MS_SYNC);
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
                            have_start_point = false;
                            have_last_tip = false;
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
                        // Enter pressed: set start/end based on last tip
                        if (c == '\n' || c == '\r')
                        {
                            if (!have_last_tip)
                            {
                                std::cerr << "[Blueprint] No fingertip detected yet; cannot set point.\n";
                            }
                            else if (!have_start_point)
                            {
                                // Set start to nearest grid intersection via SketchPad snapping
                                    start_point_percent = last_tip_percent;
                                    have_start_point = true;
                                    // tell sketchpad to show a dot at this start
                                    sketchpad.set_manual_start(start_point_percent);
                                    std::cerr << "[Blueprint] START set at (" << start_point_percent.x << "," << start_point_percent.y << ")\n";
                            }
                            else
                            {
                                // Have start already -> set end and add line
                                sketch::Point end_point = last_tip_percent;
                                // Add line (SketchPad will snap to grid if enabled)
                                sketchpad.add_line(start_point_percent, end_point);
                                std::cerr << "[Blueprint] END set at (" << end_point.x << "," << end_point.y << ") - Line created.\n";
                                have_start_point = false; // reset for next line
                                sketchpad.clear_manual_start();
                            }
                        }
                    }
                }
            }

            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "\n[SYSTEM] Enterprise drawing session ended.\n\n";
        }
        else if (line == "test")
        {
            // Production hand recognition mode
            std::cerr << "\n=== JARVIS Production Hand Recognition Mode ===\n";
            std::cerr << "Initializing camera...\n";

            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 1920;
            cam_config.height = 1080;
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
                    std::cerr << "[DEBUG] Camera config: "
                              << "width=" << cam.get_config().width << ", "
                              << "height=" << cam.get_config().height << ", "
                              << "framerate=" << cam.get_config().framerate << "\n";
                    std::cerr << "[DEBUG] Expected YUV size: "
                              << (cam.get_config().width * cam.get_config().height * 3 / 2) << " bytes\n";
                    std::cerr << "[DEBUG] If using rpicam-vid, try running manually: "
                              << "rpicam-vid -t 0 -n --codec yuv420 --width " << cam.get_config().width
                              << " --height " << cam.get_config().height
                              << " --framerate " << cam.get_config().framerate << " -o - | hexdump -C | head" << std::endl;
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
        else if (line == "test_display")
        {
            std::cerr << "\n[TEST_DISPLAY] Attempting to write test pattern to /dev/fb0...\n";

            int fb = open("/dev/fb0", O_RDWR);
            if (fb < 0)
            {
                std::cerr << "[TEST_DISPLAY] Failed to open /dev/fb0: " << strerror(errno) << "\n";
            }
            else
            {
                struct fb_var_screeninfo vinfo;
                struct fb_fix_screeninfo finfo;
                if (ioctl(fb, FBIOGET_FSCREENINFO, &finfo) == -1 || ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) == -1)
                {
                    std::cerr << "[TEST_DISPLAY] FB ioctl failed: " << strerror(errno) << "\n";
                    close(fb);
                }
                else
                {
                    std::cerr << "[TEST_DISPLAY] FB: resolution=" << vinfo.xres << "x" << vinfo.yres
                              << " bpp=" << vinfo.bits_per_pixel << " line_len=" << finfo.line_length << "\n";

                    size_t screensize = finfo.smem_len;
                    void *fbm = mmap(NULL, screensize, PROT_READ | PROT_WRITE, MAP_SHARED, fb, 0);
                    if (fbm == MAP_FAILED)
                    {
                        std::cerr << "[TEST_DISPLAY] mmap failed: " << strerror(errno) << "\n";
                        close(fb);
                    }
                    else
                    {
                        // Draw a simple checkerboard/high-contrast pattern
                        uint32_t width_fb = vinfo.xres;
                        uint32_t height_fb = vinfo.yres;
                        uint32_t stride = finfo.line_length; // bytes per line
                        std::cerr << "[TEST_DISPLAY] Drawing pattern...\n";

                        for (uint32_t y = 0; y < height_fb; ++y)
                        {
                            uint8_t *row = reinterpret_cast<uint8_t *>(fbm) + y * stride;
                            for (uint32_t x = 0; x < width_fb; ++x)
                            {
                                bool white = (((x / 32) + (y / 32)) % 2) == 0;
                                if (vinfo.bits_per_pixel == 32)
                                {
                                    uint32_t *px = reinterpret_cast<uint32_t *>(row) + x;
                                    *px = white ? 0x00FFFFFF : 0x00000000; // 0x00RRGGBB
                                }
                                else if (vinfo.bits_per_pixel == 16)
                                {
                                    uint16_t *px = reinterpret_cast<uint16_t *>(row) + x;
                                    // 565
                                    *px = white ? 0xFFFF : 0x0000;
                                }
                                else
                                {
                                    // Fallback: set raw bytes (may be paletted)
                                    row[x] = white ? 0xFF : 0x00;
                                }
                            }
                        }

                        // Sync and pause so user can see it
                        msync(fbm, screensize, MS_SYNC);
                        std::cerr << "[TEST_DISPLAY] Pattern drawn to /dev/fb0. Press Enter to restore (or wait 5s)...\n";
                        // Wait for user or timeout
                        fd_set rfds;
                        struct timeval tv;
                        FD_ZERO(&rfds);
                        FD_SET(STDIN_FILENO, &rfds);
                        tv.tv_sec = 5;
                        tv.tv_usec = 0;
                        select(STDIN_FILENO + 1, &rfds, NULL, NULL, &tv);

                        // Clear pattern (black)
                        for (uint32_t y = 0; y < height_fb; ++y)
                        {
                            uint8_t *row = reinterpret_cast<uint8_t *>(fbm) + y * stride;
                            if (vinfo.bits_per_pixel == 32)
                            {
                                uint32_t *px = reinterpret_cast<uint32_t *>(row);
                                for (uint32_t x = 0; x < width_fb; ++x)
                                    px[x] = 0x00000000;
                            }
                            else if (vinfo.bits_per_pixel == 16)
                            {
                                uint16_t *px = reinterpret_cast<uint16_t *>(row);
                                for (uint32_t x = 0; x < width_fb; ++x)
                                    px[x] = 0x0000;
                            }
                            else
                            {
                                memset(row, 0, stride);
                            }
                        }
                        msync(fbm, screensize, MS_SYNC);
                        munmap(fbm, screensize);
                        close(fb);
                        std::cerr << "[TEST_DISPLAY] Restored framebuffer.\n";
                    }
                }
            }
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
    // Unmap and close fallback /dev/fb0 if used
    if (fb0_map && fb0_map != MAP_FAILED)
    {
        msync(fb0_map, fb0_size, MS_SYNC);
        munmap(fb0_map, fb0_size);
    }
    if (fb0_fd >= 0)
        close(fb0_fd);
    drmModeFreeConnector(conn);
    drmModeFreeResources(res);
    close(fd);
    return 0;
}
