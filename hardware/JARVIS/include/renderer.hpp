#pragma once
#include <string>
#include <cstdint>
#include <xf86drmMode.h>

struct gbm_bo;

namespace renderer {

// Fetch lines from server and render them to the given framebuffer.
// Returns true on success, false if fetch or render failed.
// host, port, path: server endpoint
// use_gbm: if true, use GBM BO mapping; else use dumb buffer
// bo: GBM buffer object (ignored if !use_gbm)
// dumb_map, dumb_pitch: dumb buffer mapping (ignored if use_gbm)
// width, height: display dimensions
bool render_frame(const std::string& host, uint16_t port, const std::string& path,
                  bool use_gbm, struct gbm_bo* bo,
                  void* dumb_map, uint32_t dumb_pitch,
                  uint32_t width, uint32_t height);

} // namespace renderer
