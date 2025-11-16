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

#define JARVIS_BLUEPRINT_ID "TestBlueprint456"

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
    if (const char *env_device_id = std::getenv("JARVIS_DEVICE_ID"); env_device_id && *env_device_id) {
        device_id = trim_ws(env_device_id);
    }

    // Read secret for encryption
    std::string secret;
    if (const char *env_secret = std::getenv("JARVIS_SECRET"); env_secret && *env_secret) {
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
        if (!secret.empty()) {
            std::string enc_workstation = crypto::aes256_encrypt(device_id, secret);
            std::string enc_blueprint = crypto::aes256_encrypt(JARVIS_BLUEPRINT_ID, secret);
            if (!enc_workstation.empty() && !enc_blueprint.empty()) {
                if (path.back() != '/') path += "/";
                path += enc_workstation + "/" + enc_blueprint;
            } else {
                std::cerr << "Warning: encryption failed; using base path only.\n";
            }
        } else {
            std::cerr << "Warning: JARVIS_SECRET not set; using base path only.\n";
        }
    }

    std::cerr << "Polling server http://" << host << ":" << port << path << " for lines.\n";
    std::cerr << "Press Enter to render a frame, type 'hand' for classical CV hand detection,\n";
    std::cerr << "'hand-prod' for production detector, or 'stop' to exit.\n";

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
            // Hand recognition mode
            std::cerr << "\n=== JARVIS Hand Recognition Mode ===\n";
            std::cerr << "Initializing camera...\n";
            
            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 640;
            cam_config.height = 480;
            cam_config.framerate = 30;
            cam_config.verbose = true;
            
            if (!cam.init(cam_config)) {
                std::cerr << "Failed to initialize camera: " << cam.get_error() << "\n";
                std::cerr << "Make sure rpicam is installed and camera is connected.\n";
                continue;
            }
            
            if (!cam.start()) {
                std::cerr << "Failed to start camera: " << cam.get_error() << "\n";
                continue;
            }
            
            std::cerr << "Camera started successfully.\n";
            std::cerr << "Initializing hand detector...\n";
            
            hand_detector::DetectorConfig det_config;
            det_config.verbose = true;
            det_config.enable_gesture = true;
            det_config.min_hand_area = 2000;
            det_config.downscale_factor = 2; // Process at half resolution for speed
            
            hand_detector::HandDetector detector(det_config);
            
            std::cerr << "Hand detector initialized.\n";
            std::cerr << "\nCommands (non-blocking):\n";
            std::cerr << "  'c' - Calibrate (place hand in center)\n";
            std::cerr << "  's' - Show stats\n";
            std::cerr << "  'l' - Clear logs\n";
            std::cerr << "  'q' - Quit hand mode\n";
            std::cerr << "Logging detections live (no video output)...\n\n";
            
            // Set stdin to non-blocking
            int stdin_flags = fcntl(STDIN_FILENO, F_GETFL, 0);
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags | O_NONBLOCK);

            bool quit = false;
            uint64_t frame_counter = 0;
            while (!quit) {
                camera::Frame* frame = cam.capture_frame();
                if (!frame) {
                    std::cerr << "Camera capture error: " << cam.get_error() << "\n";
                    break;
                }
                auto detections = detector.detect(*frame);
                frame_counter++;
                std::cout << "[frame " << frame_counter << "] " << detections.size() << " hand(s)\n";
                for (size_t i = 0; i < detections.size(); ++i) {
                    const auto& hand = detections[i];
                    std::string label = hand_detector::HandDetector::gesture_to_string(hand.gesture);
                    if (hand.gesture == hand_detector::Gesture::OPEN_PALM) label = "Open Palm";
                    else if (hand.gesture == hand_detector::Gesture::FIST) label = "Fist";
                    else if (hand.gesture == hand_detector::Gesture::POINTING) label = "Pointing";
                    else if (hand.gesture == hand_detector::Gesture::PEACE) label = "Two Fingers";
                    else if (hand.gesture == hand_detector::Gesture::OK_SIGN) label = "OK";
                    std::cout << "  - hand #" << (i+1)
                              << ": gesture='" << label << "' fingers=" << hand.num_fingers
                              << " center=(" << hand.center.x << "," << hand.center.y << ")"
                              << " bbox=(x=" << hand.bbox.x << ",y=" << hand.bbox.y
                              << ",w=" << hand.bbox.width << ",h=" << hand.bbox.height << ")"
                              << " conf=" << (int)(hand.bbox.confidence * 100) << "%\n";
                }
                char buf[16];
                ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
                if (n > 0) {
                    for (ssize_t i = 0; i < n; ++i) {
                        char c = buf[i];
                        if (c == 'q' || c == 'Q') { quit = true; break; }
                        if (c == 's' || c == 'S') {
                            auto stats = detector.get_stats();
                            std::cerr << "[stats] frames=" << stats.frames_processed
                                      << " hands=" << stats.hands_detected
                                      << " avgMs=" << stats.avg_process_time_ms << "\n";
                        }
                        if (c == 'c' || c == 'C') {
                            int roi_x = (frame->width - 100)/2; int roi_y = (frame->height - 100)/2;
                            if (detector.calibrate_skin(*frame, roi_x, roi_y, 100, 100))
                                std::cerr << "[calibrate] ok\n"; else std::cerr << "[calibrate] failed\n";
                        }
                        if (c == 'l' || c == 'L') {
                            std::cout << "\033[2J\033[H" << std::flush;
                        }
                    }
                }
            }
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "Exited hand recognition mode.\n\n";
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
            
            if (!cam.init(cam_config)) {
                std::cerr << "Failed to initialize camera: " << cam.get_error() << "\n";
                std::cerr << "Make sure rpicam is installed and camera is connected.\n";
                continue;
            }
            
            if (!cam.start()) {
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
            
            while (!quit) {
                camera::Frame* frame = cam.capture_frame();
                if (!frame) {
                    std::cerr << "Camera capture error: " << cam.get_error() << "\n";
                    break;
                }
                
                auto detections = detector.detect(*frame);
                frame_counter++;
                
                // Auto-calibrate on first good detection
                if (!calibrated && !detections.empty() && 
                    detections[0].bbox.confidence > 0.7f) {
                    if (detector.auto_calibrate(*frame)) {
                        std::cerr << "[AUTO-CALIBRATE] Successfully calibrated skin detection from hand\n";
                        calibrated = true;
                    }
                }
                
                // Only log when detections occur or every 30 frames
                if (!detections.empty() || frame_counter % 30 == 0) {
                    std::cout << "[frame " << frame_counter << "] " << detections.size() << " hand(s)";
                    if (detections.empty()) {
                        std::cout << "\n";
                    }
                }
                
                for (size_t i = 0; i < detections.size(); ++i) {
                    const auto& hand = detections[i];
                    std::string label = hand_detector::HandDetector::gesture_to_string(hand.gesture);
                    
                    // Highlight main gestures
                    if (hand.gesture == hand_detector::Gesture::OPEN_PALM) label = "OPEN PALM ✋";
                    else if (hand.gesture == hand_detector::Gesture::FIST) label = "FIST ✊";
                    else if (hand.gesture == hand_detector::Gesture::POINTING) label = "POINTING ☝";
                    else if (hand.gesture == hand_detector::Gesture::PEACE) label = "PEACE ✌";
                    else if (hand.gesture == hand_detector::Gesture::OK_SIGN) label = "OK 👌";
                    
                    std::cout << "\n  ➜ Hand #" << (i+1)
                              << ": " << label
                              << " | fingers=" << hand.num_fingers
                              << " | conf=" << (int)(hand.bbox.confidence * 100) << "%"
                              << " | pos=(" << hand.center.x << "," << hand.center.y << ")";
                }
                if (!detections.empty()) {
                    std::cout << "\n";
                }
                
                // Check for commands
                char buf[16];
                ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
                if (n > 0) {
                    for (ssize_t i = 0; i < n; ++i) {
                        char c = buf[i];
                        if (c == 'q' || c == 'Q') { 
                            quit = true; 
                            break; 
                        }
                        if (c == 's' || c == 'S') {
                            auto stats = detector.get_stats();
                            std::cerr << "\n[STATS]\n";
                            std::cerr << "  Frames processed: " << stats.frames_processed << "\n";
                            std::cerr << "  Hands detected: " << stats.hands_detected << "\n";
                            std::cerr << "  Avg time: " << stats.avg_process_time_ms << " ms\n";
                            std::cerr << "  FPS: " << (1000.0 / stats.avg_process_time_ms) << "\n\n";
                        }
                        if (c == 'c' || c == 'C') {
                            int roi_x = (frame->width - 100)/2; 
                            int roi_y = (frame->height - 100)/2;
                            if (detector.calibrate_skin(*frame, roi_x, roi_y, 100, 100)) {
                                std::cerr << "[CALIBRATE] Manual calibration successful\n";
                                calibrated = true;
                            } else {
                                std::cerr << "[CALIBRATE] Manual calibration failed\n";
                            }
                        }
                        if (c == 'a' || c == 'A') {
                            if (detector.auto_calibrate(*frame)) {
                                std::cerr << "[AUTO-CALIBRATE] Calibration successful\n";
                                calibrated = true;
                            } else {
                                std::cerr << "[AUTO-CALIBRATE] No hand detected for calibration\n";
                            }
                        }
                        if (c == 'r' || c == 'R') {
                            detector.reset_tracking();
                            std::cerr << "[RESET] Tracking reset\n";
                        }
                        if (c == 'l' || c == 'L') {
                            std::cout << "\033[2J\033[H" << std::flush;
                        }
                    }
                }
            }
            
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "Exited production hand recognition mode.\n\n";
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