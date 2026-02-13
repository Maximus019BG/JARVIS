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
#include <sys/stat.h>
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
#include <nlohmann/json.hpp>
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

    // Early .env loader: prefer repository .env values before applying defaults.
    // This ensures values like JARVIS_SERVER are available when we resolve
    // host/port/path later in startup.
    {
        std::vector<std::string> candidates;
        // attempt to discover exe dir
        char exe_path_buf[4096] = {0};
        ssize_t rn = readlink("/proc/self/exe", exe_path_buf, sizeof(exe_path_buf) - 1);
        if (rn > 0)
        {
            std::string exe(exe_path_buf, static_cast<size_t>(rn));
            auto last_slash = exe.find_last_of('/');
            std::string exe_dir = last_slash == std::string::npos ? std::string(".") : exe.substr(0, last_slash);
            candidates.push_back(exe_dir + "/.env");
            // parent
            auto ppos = exe_dir.find_last_of('/');
            if (ppos != std::string::npos)
            {
                std::string parent = exe_dir.substr(0, ppos);
                candidates.push_back(parent + "/.env");
            }
        }
        // current working directory
        char cwd_buf[4096] = {0};
        if (getcwd(cwd_buf, sizeof(cwd_buf)))
        {
            std::string cwd(cwd_buf);
            candidates.insert(candidates.begin(), cwd + "/.env");
            // grandparent of cwd
            auto pos = cwd.find_last_of('/');
            if (pos != std::string::npos)
            {
                std::string parent = cwd.substr(0, pos);
                auto pos2 = parent.find_last_of('/');
                if (pos2 != std::string::npos)
                {
                    std::string grand = parent.substr(0, pos2);
                    candidates.push_back(grand + "/.env");
                }
            }
        }

        for (const auto &p : candidates)
        {
            FILE *f = std::fopen(p.c_str(), "r");
            if (!f) continue;
            std::cerr << "[Config] Loading .env from: " << p << "\n";
            char line[4096];
            while (std::fgets(line, sizeof(line), f))
            {
                std::string s(line);
                s = trim_ws(s);
                if (s.empty() || s[0] == '#') continue;
                auto eq = s.find('=');
                if (eq == std::string::npos) continue;
                std::string key = trim_ws(s.substr(0, eq));
                std::string val = trim_ws(s.substr(eq + 1));
                if (val.size() >= 2 && ((val.front() == '"' && val.back() == '"') || (val.front() == '\'' && val.back() == '\'')))
                {
                    val = val.substr(1, val.size() - 2);
                }
                if (!key.empty())
                {
                    if (std::getenv(key.c_str()))
                        std::cerr << "[Config] Overriding existing env var: " << key << "\n";
                    setenv(key.c_str(), val.c_str(), 1);
                }
            }
            std::fclose(f);
            break; // stop after first readable .env
        }
    }

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

                        // Add current working directory and grandparent to search candidates
                        char cwd_buf[4096] = {0};
                        if (getcwd(cwd_buf, sizeof(cwd_buf)))
                        {
                            std::string cwd = std::string(cwd_buf);
                            candidates.insert(candidates.begin(), cwd + "/.env");
                        }
                        // add grandparent if available
                        if (!candidates.empty())
                        {
                            std::string first = candidates.back();
                            // compute parent of parent
                            auto pos = first.find_last_of('/');
                            if (pos != std::string::npos)
                            {
                                std::string parent = first.substr(0, pos);
                                auto pos2 = parent.find_last_of('/');
                                if (pos2 != std::string::npos)
                                {
                                    std::string grand = parent.substr(0, pos2);
                                    candidates.push_back(grand + "/.env");
                                }
                            }
                        }

                        for (const auto &p : candidates)
                        {
                            FILE *f = std::fopen(p.c_str(), "r");
                            if (!f)
                                continue;
                            std::cerr << "[Config] Loading .env from: " << p << "\n";
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
                                // strip surrounding quotes if present
                                if (val.size() >= 2 && ((val.front() == '"' && val.back() == '"') || (val.front() == '\'' && val.back() == '\'')))
                                {
                                    val = val.substr(1, val.size() - 2);
                                }
                                if (!key.empty())
                                {
                                    // Prefer values from a found .env file over any inherited
                                    // process environment so local repo configuration wins.
                                    if (std::getenv(key.c_str()))
                                    {
                                        std::cerr << "[Config] Overriding existing env var: " << key << "\n";
                                    }
                                    setenv(key.c_str(), val.c_str(), 1);
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
    bool server_use_tls = false;

    // Remember last loaded sketch name so blueprint can default to it
    std::string last_loaded_sketch_name;

    // Read device ID from environment (used to build encrypted endpoint IDs)
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

    

    // Forward-declare POST helper so fetch lambda can call it even though
    // the actual lambda definition appears later in this translation unit.
    std::function<bool(const std::string &sketch_name, sketch::SketchPad &sketchpad)> post_local_to_server;

    // Helper: process any queued outbound posts in `blueprints/_outbox/`.
    auto process_outbox = [&]() {
        const char *outdir = "blueprints/_outbox";
        struct stat st = {};
        if (::stat(outdir, &st) != 0)
        {
            // No outbox directory yet - nothing to do
            return;
        }
        DIR *d = opendir(outdir);
        if (!d) return;
        struct dirent *ent;
        while ((ent = readdir(d)) != nullptr)
        {
            std::string name = ent->d_name;
            if (name.size() <= 12) // at minimum "a.pending.json"
                continue;
            if (name.size() < 13) continue;
            const std::string suffix = ".pending.json";
            if (name.size() <= suffix.size()) continue;
            if (name.substr(name.size() - suffix.size()) != suffix)
                continue;
            std::string sketch_name = name.substr(0, name.size() - suffix.size());
            // Attempt to post using a fresh SketchPad instance
            sketch::SketchPad sp(width, height);
            sp.init(sketch_name, width, height);
            // Ensure the sketch is loaded so post_local_to_server can find the path
            sp.load(sketch_name);
            bool ok = false;
            try { ok = post_local_to_server(sketch_name, sp); } catch (...) { ok = false; }
            std::string fullpath = std::string(outdir) + "/" + name;
            if (ok)
            {
                // remove queued file
                unlink(fullpath.c_str());
                std::cerr << "[Outbox] Posted queued blueprint: " << sketch_name << "\n";
            }
            else
            {
                std::cerr << "[Outbox] Still queued (post failed): " << sketch_name << "\n";
            }
        }
        closedir(d);
    };

    // Helper: perform server blueprint load and update local file if server has a different version
    // Returns true if sketchpad has been loaded (from server or local) and is ready
    auto fetch_and_update_from_server = [&](const std::string &sketch_name, sketch::SketchPad &sketchpad) -> bool {
        const char *secret_env = std::getenv("JARVIS_SECRET");
        std::string secret = secret_env ? std::string(secret_env) : std::string();
        // Derive encrypted ids if we have a secret, else use plain ids
        std::string enc_workstation = device_id;
        std::string enc_blueprint = JARVIS_BLUEPRINT_ID;
        if (!secret.empty())
        {
            enc_workstation = crypto::aes256_encrypt(device_id, secret);
            enc_blueprint = crypto::aes256_encrypt(sketch_name, secret);
        }

            // Build endpoint path relative to configured base `path`.
            auto make_blueprint_endpoint = [&](const std::string &action) -> std::string {
                std::string prefix = path; // `path` comes from JARVIS_SERVER parsing; may be empty or start with '/'
                // Normalize prefix to start with '/' unless empty
                if (!prefix.empty() && prefix[0] != '/')
                    prefix = std::string("/") + prefix;

                // If user provided a full API prefix that already contains the blueprint segment,
                // append only the ids. Otherwise build: <prefix>/api/workstation/blueprint/<action>/<enc_ws>/<enc_bp>
                std::string target;
                if (prefix.find("/api/workstation/blueprint") != std::string::npos)
                {
                    if (prefix.back() != '/')
                        prefix += '/';
                    target = prefix + enc_workstation + "/" + enc_blueprint;
                }
                else
                {
                    if (!prefix.empty() && prefix.back() != '/')
                        prefix += '/';
                    target = prefix + std::string("api/workstation/blueprint/") + action + "/" + enc_workstation + "/" + enc_blueprint;
                }
                if (target.empty() || target[0] != '/')
                    target = std::string("/") + target;
                return target;
            };

            std::string server_path = make_blueprint_endpoint("load");
        HttpClient client;
        std::string body = client.get(host, port, server_path, 3000, server_use_tls);

        // If server returned a non-empty body, try to parse and persist it.
        if (!body.empty())
        {
            try
            {
                nlohmann::json j = nlohmann::json::parse(body);
                // stringify deterministically
                std::string server_payload = j.dump(2) + "\n";

                // Determine local path we loaded from (if any)
                std::string local_path = sketchpad.get_last_loaded_path();
                if (local_path.empty())
                {
                    // default target
                    local_path = std::string("blueprints/") + sketch_name;
                    if (local_path.find(".jarvis") == std::string::npos)
                        local_path += ".jarvis";
                }

                // Read local file if exists
                std::string local_contents;
                {
                    FILE *f = fopen(local_path.c_str(), "rb");
                    if (f)
                    {
                        fseek(f, 0, SEEK_END);
                        long sz = ftell(f);
                        fseek(f, 0, SEEK_SET);
                        if (sz > 0)
                        {
                            local_contents.resize(sz);
                            fread(&local_contents[0], 1, sz, f);
                        }
                        fclose(f);
                    }
                }

                if (!local_contents.empty() && local_contents == server_payload)
                {
                    std::cout << "[Server] Local copy is up-to-date (no update)\n";
                    // Attempt to load local file into sketchpad to ensure it's available
                    if (sketchpad.load(sketch_name))
                        return true;
                    else
                        return false;
                }

                // Write server payload atomically to local_path
                std::string tmp = local_path + ".tmp";
                int fd = open(tmp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
                if (fd < 0)
                {
                    std::cerr << "[Server] Failed to open temp file for writing: " << tmp << "\n";
                    // fallthrough to try local load
                }
                else
                {
                    const char *buf = server_payload.data();
                    size_t to_write = server_payload.size();
                    while (to_write > 0)
                    {
                        ssize_t w = write(fd, buf, to_write);
                        if (w < 0)
                        {
                            if (errno == EINTR) continue;
                            std::cerr << "[Server] Write failed: " << strerror(errno) << "\n";
                            close(fd);
                            unlink(tmp.c_str());
                            break;
                        }
                        to_write -= static_cast<size_t>(w);
                        buf += w;
                    }
                    fsync(fd);
                    close(fd);
                    if (rename(tmp.c_str(), local_path.c_str()) != 0)
                    {
                        std::cerr << "[Server] Failed to rename tmp file: " << strerror(errno) << "\n";
                        unlink(tmp.c_str());
                    }
                        else
                        {
                            std::cout << "[Server] Updated local blueprint from server: " << local_path << "\n";
                            if (sketchpad.load(sketch_name))
                                return true;
                            // If standard load failed due to signature verification,
                            // attempt to load the raw JSON payload (recovery path),
                            // then re-save so the file gets a proper signature.
                            if (sketchpad.load_from_json(server_payload, local_path))
                            {
                                std::cerr << "[Server] Loaded server payload via JSON fallback; re-saving to compute signature\n";
                                if (!sketchpad.save(sketch_name))
                                    std::cerr << "[Server] Warning: failed to re-save after JSON fallback\n";
                                return true;
                            }
                            else
                            {
                                std::cerr << "[Server] Warning: saved server payload but failed to load into SketchPad\n";
                            }
                        }
                }
            }
            catch (const std::exception &e)
            {
                std::cerr << "[Server] JSON parse error from server response: " << e.what() << "\n";
                // fall through to try local
            }
        }

        // If we reach here, server was not usable/valid. Try to load a local blueprint and
        // then push it to the server so the server has a copy.
        std::string local_path = sketchpad.get_last_loaded_path();
        if (local_path.empty())
        {
            local_path = std::string("blueprints/") + sketch_name;
            if (local_path.find(".jarvis") == std::string::npos)
                local_path += ".jarvis";
        }

        // Try loading from local file into the provided sketchpad
        if (sketchpad.load(sketch_name))
        {
            std::cerr << "[Server] Server unavailable or invalid; loaded local blueprint: " << local_path << "\n";
            // Best-effort: POST the local file to server so it has a copy
            try
            {
                post_local_to_server(sketch_name, sketchpad);
            }
            catch (...) {
                std::cerr << "[Server] Warning: failed to POST local blueprint to server (ignored)\n";
            }
            return true;
        }

        // If standard load failed (likely signature mismatch), try to read
        // the local file and load via JSON fallback, then re-save and POST.
        {
            std::string local_contents2;
            FILE *f2 = fopen(local_path.c_str(), "rb");
            if (f2)
            {
                fseek(f2, 0, SEEK_END);
                long sz2 = ftell(f2);
                fseek(f2, 0, SEEK_SET);
                if (sz2 > 0)
                {
                    local_contents2.resize(sz2);
                    fread(&local_contents2[0], 1, sz2, f2);
                }
                fclose(f2);
            }

            if (!local_contents2.empty())
            {
                if (sketchpad.load_from_json(local_contents2, local_path))
                {
                    std::cerr << "[Server] Loaded local blueprint via JSON fallback despite signature issues: " << local_path << "\n";
                    // Re-save to compute correct signature and persist
                    if (!sketchpad.save(sketch_name))
                        std::cerr << "[Server] Warning: failed to re-save local blueprint after JSON fallback\n";
                    try
                    {
                        post_local_to_server(sketch_name, sketchpad);
                    }
                    catch (...) {
                        std::cerr << "[Server] Warning: failed to POST local blueprint to server (ignored)\n";
                    }
                    return true;
                }
                else
                {
                    std::cerr << "[Server] Local file exists but failed JSON fallback parse: " << local_path << "\n";
                }
            }
        }

        // No server data and failed to load local file
        if (!client.last_error().empty())
            std::cerr << "[Server] GET error: " << client.last_error() << "\n";
        else
            std::cerr << "[Server] No remote blueprint available or empty response and no local copy\n";
        return false;
    };

    // Helper: POST local blueprint to server after a successful save
    post_local_to_server = [&](const std::string &sketch_name, sketch::SketchPad &sketchpad) -> bool {
        const char *secret_env = std::getenv("JARVIS_SECRET");
        std::string secret = secret_env ? std::string(secret_env) : std::string();
        std::string enc_workstation = device_id;
        std::string enc_blueprint = JARVIS_BLUEPRINT_ID;
        if (!secret.empty())
        {
            enc_workstation = crypto::aes256_encrypt(device_id, secret);
            enc_blueprint = crypto::aes256_encrypt(sketch_name, secret);
        }

        auto make_blueprint_endpoint = [&](const std::string &action) -> std::string {
            std::string prefix = path;
            if (!prefix.empty() && prefix[0] != '/')
                prefix = std::string("/") + prefix;
            std::string target;
            if (prefix.find("/api/workstation/blueprint") != std::string::npos)
            {
                if (prefix.back() != '/')
                    prefix += '/';
                target = prefix + enc_workstation + "/" + enc_blueprint;
            }
            else
            {
                if (!prefix.empty() && prefix.back() != '/')
                    prefix += '/';
                target = prefix + std::string("api/workstation/blueprint/") + action + "/" + enc_workstation + "/" + enc_blueprint;
            }
            if (target.empty() || target[0] != '/')
                target = std::string("/") + target;
            return target;
        };

        std::string save_path = make_blueprint_endpoint("save");
        // Read local file JSON to include as `data` in request
        std::string local_path = sketchpad.get_last_loaded_path();
        if (local_path.empty())
        {
            local_path = std::string("blueprints/") + sketch_name;
            if (local_path.find(".jarvis") == std::string::npos)
                local_path += ".jarvis";
        }

        std::string local_contents;
        {
            FILE *f = fopen(local_path.c_str(), "rb");
                if (!f)
                {
                    std::cerr << "[Server] Cannot open local file to POST: " << local_path << "\n";
                    return false;
                }
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            fseek(f, 0, SEEK_SET);
            if (sz > 0)
            {
                local_contents.resize(sz);
                fread(&local_contents[0], 1, sz, f);
            }
            fclose(f);
        }

        if (local_contents.empty())
        {
            std::cerr << "[Server] Local file empty, not posting\n";
            return false;
        }

        try
        {
            nlohmann::json meta = nlohmann::json::parse(local_contents);
            nlohmann::json payload;
            payload["name"] = sketch_name;
            payload["data"] = meta;

            HttpClient client;
            std::string resp = client.post(host, port, save_path, payload.dump(), "application/json", 3000, server_use_tls);
            if (resp.empty())
            {
                std::cerr << "[Server] POST failed: " << client.last_error() << "\n";
                // Queue the payload for later retry in blueprints/_outbox
                std::string outdir = std::string("blueprints/_outbox");
                struct stat st = {};
                if (::stat(outdir.c_str(), &st) != 0)
                {
                    ::mkdir("blueprints", 0755);
                    ::mkdir(outdir.c_str(), 0755);
                }
                std::string pending = outdir + "/" + sketch_name + ".pending.json";
                int fd = open((pending + ".tmp").c_str(), O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR);
                if (fd >= 0)
                {
                    const std::string bodystr = payload.dump(2) + "\n";
                    const char *ptr = bodystr.data();
                    size_t left = bodystr.size();
                    while (left > 0)
                    {
                        ssize_t w = write(fd, ptr, left);
                        if (w <= 0)
                        {
                            if (errno == EINTR) continue;
                            break;
                        }
                        left -= static_cast<size_t>(w);
                        ptr += w;
                    }
                    fsync(fd);
                    close(fd);
                    rename((pending + ".tmp").c_str(), pending.c_str());
                    std::cerr << "[Server] Queued POST for later: " << pending << "\n";
                }
                else
                {
                    std::cerr << "[Server] Failed to queue POST: cannot open " << pending << "\n";
                }
                return false;
            }
            else
            {
                std::cout << "[Server] Posted local changes to server (response length: " << resp.size() << ")\n";
                return true;
            }
        }
        catch (const std::exception &e)
        {
            std::cerr << "[Server] Failed to parse local file JSON before POST: " << e.what() << "\n";
        }
    };

    

    if (const char *env_server = std::getenv("JARVIS_SERVER"); env_server && *env_server)
    {
        std::string url = trim_ws(env_server);
        // detect scheme if present
        auto pos_scheme = url.find("://");
        std::string scheme;
        if (pos_scheme != std::string::npos)
        {
            scheme = url.substr(0, pos_scheme);
            if (scheme == "https")
                server_use_tls = true;
            url = url.substr(pos_scheme + 3);
        }
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
            if (server_use_tls)
                port = 443;
        }
        if (!new_path.empty())
            path = new_path;
        if (path.empty() || path[0] != '/')
            path = "/" + path;

        // Keep `path` as the base URL path provided by JARVIS_SERVER.
        // Do NOT append encrypted IDs here — the fetch/post helpers will
        // construct full API endpoints by combining this base `path` with
        // the appropriate `/api/workstation/blueprint/...` suffix. This
        // allows JARVIS_SERVER to be a simple base like "http://host:3000" or "https://host".
    }

    // Attempt to process any queued outbound posts (retry previous failures)
    process_outbox();

    std::cerr << "Polling server http://" << host << ":" << port << path << " for lines.\n";
    std::cerr << "Commands:\n";
    std::cerr << "  <Enter>      - Render a frame\n";
    std::cerr << "  blueprint    - Drawing mode (follow index finger)\n";
    std::cerr << "  show-config  - Print resolved server and env settings\n";
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
                if (!last_loaded_sketch_name.empty())
                    sketch_name = last_loaded_sketch_name;
                else
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
            // Ensure every successful local save also triggers a POST to server
            sketchpad.set_on_save_callback([&](const std::string &saved_path) {
                // best-effort: post local file to server after each save
                post_local_to_server(sketch_name, sketchpad);
            });
            // If a .jarvis exists for this sketch name, load it so user can update existing blueprint
            if (sketchpad.load(sketch_name))
            {
                std::cerr << "[SketchPad] Loaded existing project: '" << sketch_name << "'\n";
            }
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
                                // Attempt to post local changes to server (best-effort)
                                post_local_to_server(sketch_name, sketchpad);
                            }
                            quit = true;
                            break;
                        }
                        if (c == 's' || c == 'S')
                        {
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "\n[SYSTEM] ✓ Project saved: '" << sketch_name << ".jarvis'\n";
                                post_local_to_server(sketch_name, sketchpad);
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
                            // Persist cleared state
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "[SYSTEM] ✓ Cleared project saved: '" << sketch_name << ".jarvis'\n";
                                post_local_to_server(sketch_name, sketchpad);
                            }
                            else
                            {
                                std::cerr << "[ERROR] Failed to save cleared project\n";
                            }
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
                                    // Persist new line immediately
                                    if (sketchpad.save(sketch_name))
                                    {
                                        std::cerr << "[SketchPad] ✔ Saved project: '" << sketch_name << ".jarvis'\n";
                                        post_local_to_server(sketch_name, sketchpad);
                                    }
                                    else
                                    {
                                        std::cerr << "[SketchPad] ✖ Failed to save project: '" << sketch_name << "'\n";
                                    }
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
        else if (line == "show-config")
        {
            std::cerr << "\n[Config] Effective configuration:\n";
            const char *env_server = std::getenv("JARVIS_SERVER");
            std::cerr << "  JARVIS_SERVER (raw env): " << (env_server ? env_server : "(not set)") << "\n";
            std::cerr << "  Resolved host: " << host << "\n";
            std::cerr << "  Resolved port: " << port << "\n";
            std::cerr << "  Resolved path: " << path << "\n";
            std::cerr << "  TLS enabled: " << (server_use_tls ? "yes" : "no") << "\n";
            const char *dev = std::getenv("JARVIS_DEVICE_ID");
            std::cerr << "  JARVIS_DEVICE_ID: " << (dev ? dev : "(not set)") << "\n";
            std::cerr << "  JARVIS_SECRET set: " << (std::getenv("JARVIS_SECRET") ? "yes" : "no") << "\n\n";
            continue;
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

            // Load sketch (attempt server sync first). Set on-save callback before
            // fetching so any immediate saves/uploads are wired.
            sketch::SketchPad sketchpad(width, height);
            // Ensure cloud-sync after each save during interactive edit
            sketchpad.set_on_save_callback([&](const std::string &saved_path) {
                post_local_to_server(sketch_name, sketchpad);
            });

            // Try fetching an updated copy from server before loading local file.
            // This helper will fall back to loading the local file and will POST it
            // back to the server if the server is unavailable.
            bool loaded_ok = fetch_and_update_from_server(sketch_name, sketchpad);
            if (!loaded_ok)
            {
                std::cerr << "Failed to fetch or load sketch '" << sketch_name << "' (no server and no valid local file)\n";
                std::cerr << "Make sure 'blueprints/" << sketch_name << ".jarvis' exists and is valid.\n";
                continue;
            }

            // Remember this as the last-loaded project so blueprint defaults to it
            last_loaded_sketch_name = sketch_name;

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
            else if (fb0_map)
            {
                // Fallback rendering directly to /dev/fb0 mmap
                draw_ticker::clear_buffer(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height, 0x00000000);
                sketchpad.render(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height);
                msync(fb0_map, fb0_size, MS_SYNC);
                std::cerr << "✓ Sketch displayed via /dev/fb0 mmap\n";
            }
            else
            {
                // Try mapping /dev/fb0 now as a fallback (same logic as blueprint mode)
                int fb = open("/dev/fb0", O_RDWR);
                if (fb < 0)
                {
                    std::cerr << "Failed to open /dev/fb0: " << strerror(errno) << "\n";
                }
                else
                {
                    struct fb_var_screeninfo vinfo;
                    struct fb_fix_screeninfo finfo;
                    if (ioctl(fb, FBIOGET_FSCREENINFO, &finfo) == -1 || ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) == -1)
                    {
                        std::cerr << "FB ioctl failed: " << strerror(errno) << "\n";
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
                            std::cerr << "mmap(/dev/fb0) failed: " << strerror(errno) << "\n";
                            close(fb);
                        }
                        else
                        {
                            fb0_fd = fb;
                            fb0_map = m;
                            std::cerr << "Mapped /dev/fb0: " << vinfo.xres << "x" << vinfo.yres << " bpp=" << vinfo.bits_per_pixel << "\n";
                            // Re-init sketchpad to framebuffer resolution so percentage mapping is correct
                            sketchpad.init(sketch_name, vinfo.xres, vinfo.yres);
                            // Render immediately
                            draw_ticker::clear_buffer(fb0_map, fb0_stride, vinfo.xres, vinfo.yres, 0x00000000);
                            sketchpad.render(fb0_map, fb0_stride, vinfo.xres, vinfo.yres);
                            msync(fb0_map, fb0_size, MS_SYNC);
                            std::cerr << "✓ Sketch displayed via /dev/fb0 mmap\n";
                        }
                    }
                }
            }

            // Instead of a simple pause, enter an interactive editing session
            // so `load <name>` behaves like `blueprint` but starting from the
            // already-loaded sketch. This lets the user continue drawing.

            std::cerr << "Entering interactive edit mode for loaded sketch...\n";

            // Initialize camera for interactive editing
            camera::Camera cam;
            camera::CameraConfig cam_config;
            cam_config.width = 1280;
            cam_config.height = 720;
            cam_config.framerate = 30;
            cam_config.verbose = false;

            if (!cam.init(cam_config))
            {
                std::cerr << "[ERROR] Camera initialization failed: " << cam.get_error() << "\n";
                std::cerr << "[INFO] Edit mode requires a working camera; aborting interactive edit.\n";
                continue;
            }

            if (!cam.start())
            {
                std::cerr << "[ERROR] Camera start failed: " << cam.get_error() << "\n";
                continue;
            }

            // Configure hand detector (same defaults as blueprint)
            hand_detector::DetectorConfig det_config;
            det_config.verbose = false;
            det_config.enable_gesture = true;
            det_config.min_hand_area = 2000;
            det_config.downscale_factor = 2;

            hand_detector::ProductionConfig prod_config;
            prod_config.enable_tracking = true;
            prod_config.adaptive_lighting = true;
            prod_config.gesture_stabilization_frames = 10;
            prod_config.tracking_history_frames = 5;
            prod_config.filter_low_confidence = true;
            prod_config.min_detection_quality = 0.5f;
            prod_config.verbose = false;

            hand_detector::ProductionHandDetector detector(det_config, prod_config);

            // Prepare sketchpad for editing: keep loaded grid/settings but set drawing defaults
            sketchpad.set_color(0x00FFFFFF);
            sketchpad.set_thickness(4);
            sketchpad.set_confirmation_frames(2);
            sketchpad.enable_anti_aliasing(true);
            sketchpad.enable_subpixel_rendering(true);

            std::cerr << "[SYSTEM] Interactive edit mode ready. Use Enter to set START/END, 's' save, 'c' clear, 'q' quit.\n";

            // Set stdin non-blocking for responsive key handling
            int stdin_flags = fcntl(STDIN_FILENO, F_GETFL, 0);
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags | O_NONBLOCK);

            bool quit = false;
            bool calibrated = false;
            uint64_t frame_counter = 0;
            int render_every = 2;

            // Manual start/end helpers (percent coords)
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
                    break;
                }

                auto detections = detector.detect(*frame);
                frame_counter++;

                // Auto-calibrate on first good detection
                if (!calibrated && !detections.empty() && detections[0].bbox.confidence > 0.7f)
                {
                    if (detector.auto_calibrate(*frame))
                    {
                        std::cerr << "[SYSTEM] ✓ Auto-calibrated hand detection\n";
                        calibrated = true;
                    }
                }

                // Print detection summary occasionally
                if (!detections.empty() || frame_counter % 30 == 0)
                {
                    std::cout << "[frame " << frame_counter << "] " << detections.size() << " hand(s)";
                    if (detections.empty())
                        std::cout << "\n";
                }

                for (size_t i = 0; i < detections.size(); ++i)
                {
                    const auto &hand = detections[i];
                    std::string label = hand_detector::HandDetector::gesture_to_string(hand.gesture);
                    if (hand.gesture == hand_detector::Gesture::OPEN_PALM)
                        label = "OPEN PALM ✋";
                    else if (hand.gesture == hand_detector::Gesture::FIST)
                        label = "FIST ✊";
                    else if (hand.gesture == hand_detector::Gesture::POINTING)
                        label = "POINTING ☝ [DRAWING]";
                    else if (hand.gesture == hand_detector::Gesture::PEACE)
                        label = "PEACE ✌ [DRAWING]";

                    std::cout << "\n  ➜ Hand #" << (i + 1)
                              << ": " << label
                              << " | fingers=" << hand.num_fingers
                              << " | conf=" << (int)(hand.bbox.confidence * 100) << "%"
                              << " | pos=(" << (int)hand.center.x << "," << (int)hand.center.y << ")";

                    if (!hand.fingertips.empty())
                        std::cout << " | tip=(" << (int)hand.fingertips[0].x << "," << (int)hand.fingertips[0].y << ")";
                }
                if (!detections.empty())
                    std::cout << "\n";

                // Update sketchpad with detections
                sketchpad.update(detections);

                // Track fingertip for manual controls
                if (!detections.empty())
                {
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
                        std::cerr << "[Edit] Last tip: (" << last_tip_percent.x << "," << last_tip_percent.y << ")\n";
                    }
                }

                // Periodic render
                if (frame_counter % render_every == 0)
                {
                    void *map_data = nullptr;
                    uint32_t map_stride = 0;

                    if (use_gbm && bo)
                    {
                        void *ret = gbm_bo_map(bo, 0, 0, width, height, GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
                        if (!ret)
                        {
                            std::cerr << "[SketchPad] gbm_bo_map failed during interactive edit\n";
                        }
                        else
                        {
                            draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);
                            sketchpad.render(map_data, map_stride, width, height);
                            gbm_bo_unmap(bo, map_data);
                            if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                                std::cerr << "[SketchPad] drmModeSetCrtc failed during interactive edit\n";
                        }
                    }
                    else if (dumb_map)
                    {
                        map_stride = dumb_pitch;
                        map_data = dumb_map;
                        draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);
                        sketchpad.render(map_data, map_stride, width, height);
                        if (drmModeSetCrtc(fd, crtc_id, fb_id, 0, 0, &conn_id, 1, &mode))
                            std::cerr << "[SketchPad] drmModeSetCrtc failed during interactive edit\n";
                    }
                    else if (fb0_map)
                    {
                        draw_ticker::clear_buffer(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height, 0x00000000);
                        sketchpad.render(fb0_map, fb0_stride, sketchpad.get_sketch().width, sketchpad.get_sketch().height);
                        msync(fb0_map, fb0_size, MS_SYNC);
                    }
                }

                // Non-blocking keyboard handling
                char buf[16];
                ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
                if (n > 0)
                {
                    for (ssize_t i = 0; i < n; ++i)
                    {
                        char c = buf[i];
                        if (c == 'q' || c == 'Q')
                        {
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "\n[SYSTEM] ✓ Project saved: '" << sketch_name << ".jarvis'\n";
                                post_local_to_server(sketch_name, sketchpad);
                            }
                            quit = true;
                            break;
                        }
                        if (c == 's' || c == 'S')
                        {
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "\n[SYSTEM] ✓ Project saved: '" << sketch_name << ".jarvis'\n";
                                post_local_to_server(sketch_name, sketchpad);
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
                            if (sketchpad.save(sketch_name))
                            {
                                std::cerr << "[SYSTEM] ✓ Cleared project saved: '" << sketch_name << ".jarvis'\n";
                                post_local_to_server(sketch_name, sketchpad);
                            }
                            else
                            {
                                std::cerr << "[ERROR] Failed to save cleared project\n";
                            }
                        }
                        if (c == 'i' || c == 'I')
                        {
                            std::cerr << "\n╔════════════════════════════════════════════════════════════╗\n";
                            std::cerr << "║                    PROJECT INFORMATION                     ║\n";
                            std::cerr << "╠════════════════════════════════════════════════════════════╣\n";
                            std::cerr << "║  Project: " << std::left << std::setw(48) << sketch_name << "║\n";
                            std::cerr << "║  Lines drawn: " << std::left << std::setw(44) << sketchpad.get_stroke_count() << "║\n";
                            std::cerr << "║  Resolution: " << width << "x" << height << std::setw(36) << " " << "║\n";
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
                        if (c == '\n' || c == '\r')
                        {
                            if (!have_last_tip)
                            {
                                std::cerr << "[Edit] No fingertip detected yet; cannot set point.\n";
                            }
                            else if (!have_start_point)
                            {
                                start_point_percent = last_tip_percent;
                                have_start_point = true;
                                sketchpad.set_manual_start(start_point_percent);
                                std::cerr << "[Edit] START set at (" << start_point_percent.x << "," << start_point_percent.y << ")\n";
                            }
                            else
                            {
                                sketch::Point end_point = last_tip_percent;
                                sketchpad.add_line(start_point_percent, end_point);
                                std::cerr << "[Edit] END set at (" << end_point.x << "," << end_point.y << ") - Line created.\n";
                                have_start_point = false;
                                sketchpad.clear_manual_start();
                                if (sketchpad.save(sketch_name))
                                {
                                    std::cerr << "[SketchPad] ✔ Saved project: '" << sketch_name << ".jarvis'\n";
                                    post_local_to_server(sketch_name, sketchpad);
                                }
                                else
                                {
                                    std::cerr << "[SketchPad] ✖ Failed to save project: '" << sketch_name << "'\n";
                                }
                            }
                        }
                    }
                }
            }

            // Restore stdin flags and stop camera
            fcntl(STDIN_FILENO, F_SETFL, stdin_flags);
            cam.stop();
            std::cerr << "\n[System] Exiting interactive edit mode for '" << sketch_name << "'.\n";
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
