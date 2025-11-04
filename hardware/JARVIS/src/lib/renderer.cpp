#include "renderer.h"
#include "http_client.h"
#include "draw_ticker.h"

#include <gbm.h>
#include <iostream>
#include <vector>
#include <tuple>
#include <regex>
#include <cstdio>
#include <algorithm>

namespace renderer
{

    static uint32_t parse_hex_color(const std::string &hex)
    {
        // Expect "#RRGGBB" or "RRGGBB"
        std::string s = hex;
        if (!s.empty() && s[0] == '#')
            s = s.substr(1);
        if (s.size() != 6)
            return 0x00FFFFFF; // white fallback
        unsigned int r = 0, g = 0, b = 0;
        std::sscanf(s.c_str(), "%02x%02x%02x", &r, &g, &b);
        return (r << 16) | (g << 8) | b; // 0x00RRGGBB
    }

    bool render_frame(const std::string &host, uint16_t port, const std::string &path,
                      bool use_gbm, struct gbm_bo *bo,
                      void *dumb_map, uint32_t dumb_pitch,
                      uint32_t width, uint32_t height)
    {
        HttpClient client;
        std::string body = client.get(host, port, path, 2000);

        // lines: x0,y0,x1,y1,thickness,color
        std::vector<std::tuple<int, int, int, int, int, uint32_t>> lines;
        bool clear_bg = true; // default clear each frame

        if (!body.empty())
        {
            // Order-independent simple extraction: find each object and then pick fields inside it.
            try
            {
                std::regex obj_re(R"RX(\{[^}]*\})RX");
                std::regex x0_re(R"RX("x0"\s*:\s*(-?\d+))RX");
                std::regex y0_re(R"RX("y0"\s*:\s*(-?\d+))RX");
                std::regex x1_re(R"RX("x1"\s*:\s*(-?\d+))RX");
                std::regex y1_re(R"RX("y1"\s*:\s*(-?\d+))RX");
                std::regex th_re(R"RX("thickness"\s*:\s*(\d+))RX");
                std::regex c_re(R"RX("color"\s*:\s*"(#[0-9a-fA-F]{6})")RX");
                std::regex clear_re(R"RX("clear"\s*:\s*(true|false))RX");

                // optional top-level clear flag
                {
                    std::smatch m;
                    if (std::regex_search(body, m, clear_re))
                    {
                        clear_bg = (m[1].str() == "true");
                    }
                }
                auto begin = std::sregex_iterator(body.begin(), body.end(), obj_re);
                auto end = std::sregex_iterator();
                for (auto it = begin; it != end; ++it)
                {
                    std::string obj = it->str();
                    std::smatch m;
                    int x0 = 0, y0 = 0, x1 = 0, y1 = 0, thickness = 3;
                    uint32_t color = 0x00FFFFFF;
                    bool has_any = false;
                    if (std::regex_search(obj, m, x0_re))
                    {
                        x0 = std::stoi(m[1].str());
                        has_any = true;
                    }
                    if (std::regex_search(obj, m, y0_re))
                    {
                        y0 = std::stoi(m[1].str());
                        has_any = true;
                    }
                    if (std::regex_search(obj, m, x1_re))
                    {
                        x1 = std::stoi(m[1].str());
                        has_any = true;
                    }
                    if (std::regex_search(obj, m, y1_re))
                    {
                        y1 = std::stoi(m[1].str());
                        has_any = true;
                    }
                    if (std::regex_search(obj, m, th_re))
                        thickness = std::stoi(m[1].str());
                    if (std::regex_search(obj, m, c_re))
                        color = parse_hex_color(m[1].str());
                    if (has_any)
                    {
                        lines.emplace_back(x0, y0, x1, y1, thickness, color);
                    }
                }
                if (lines.empty())
                {
                    // Only warn if response contained a 'lines' array hint, otherwise remain quiet
                    if (body.find("\"lines\"") != std::string::npos)
                        std::cerr << "Warning: no lines parsed from response" << "\n";
                }
            }
            catch (const std::exception &e)
            {
                std::cerr << "Parse error: " << e.what() << "\n";
                return false;
            }
        }
        else
        {
            if (!client.last_error().empty())
            {
                std::cerr << "HTTP error: " << client.last_error() << "\n";
            }
            return false;
        }

        uint32_t map_stride = 0;
        void *map_data = nullptr;
        if (use_gbm)
        {
            void *ret = gbm_bo_map(bo, 0, 0, width, height, GBM_BO_TRANSFER_WRITE, &map_stride, &map_data);
            if (!ret)
            {
                std::cerr << "gbm_bo_map failed in render_frame" << std::endl;
                return false;
            }
        }
        else
        {
            map_stride = dumb_pitch;
            map_data = dumb_map;
        }

        // Clear background optionally
        if (clear_bg)
        {
            draw_ticker::clear_buffer(map_data, map_stride, width, height, 0x00000000);
        }

        // Draw lines
        for (const auto &t : lines)
        {
            int x0, y0, x1, y1, thickness;
            uint32_t c;
            std::tie(x0, y0, x1, y1, thickness, c) = t;
            draw_ticker::draw_line(map_data, map_stride, width, height, x0, y0, x1, y1, c, std::max(1, thickness));
        }

        if (use_gbm)
        {
            gbm_bo_unmap(bo, map_data);
        }

        return true;
    }

} // namespace renderer
