#pragma once
#include <string>
#include <cstdint>

class HttpClient
{
public:
    // timeout_ms applies to connect() and read() operations.
    std::string get(const std::string &host, uint16_t port, const std::string &path,
                    int timeout_ms = 3000, bool use_tls = false);

    // POST body (raw) to path; returns response body or empty on error
    std::string post(const std::string &host, uint16_t port, const std::string &path,
                     const std::string &body, const std::string &content_type = "application/json",
                     int timeout_ms = 3000, bool use_tls = false);

    const std::string &last_error() const { return last_error_; }

private:
    std::string last_error_;
};
