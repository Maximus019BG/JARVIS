#pragma once
#include <string>
#include <cstdint>

// Minimal blocking HTTP client for simple GET requests over IPv4.
// Not production-grade; intended for LAN polling.
// Usage:
//   HttpClient client;
//   std::string body = client.get("127.0.0.1", 8080, "/dots");
// Returns empty string on error; check last_error() for details.
class HttpClient
{
public:
    // timeout_ms applies to connect() and read() operations.
    std::string get(const std::string &host, uint16_t port, const std::string &path,
                    int timeout_ms = 3000);

    const std::string &last_error() const { return last_error_; }

private:
    std::string last_error_;
};
