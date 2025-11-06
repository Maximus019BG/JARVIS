#include "http_client.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>

#include <cerrno>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

namespace
{

    static bool set_timeouts(int fd, int timeout_ms)
    {
        if (timeout_ms <= 0)
            return true;
        struct timeval tv;
        tv.tv_sec = timeout_ms / 1000;
        tv.tv_usec = (timeout_ms % 1000) * 1000;
        if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) < 0)
            return false;
        if (setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv)) < 0)
            return false;
        return true;
    }

    static int connect_with_timeout(int fd, const struct sockaddr *addr, socklen_t addrlen, int timeout_ms)
    {
        if (timeout_ms <= 0)
        {
            return ::connect(fd, addr, addrlen);
        }
        int flags = fcntl(fd, F_GETFL, 0);
        if (flags < 0)
            return -1;
        if (fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0)
            return -1;

        int rc = ::connect(fd, addr, addrlen);
        if (rc == 0)
        {
            // Connected immediately; restore flags
            fcntl(fd, F_SETFL, flags);
            return 0;
        }
        if (errno != EINPROGRESS && errno != EALREADY)
        {
            // Real error
            fcntl(fd, F_SETFL, flags);
            return -1;
        }

        struct pollfd pfd;
        pfd.fd = fd;
        pfd.events = POLLOUT;
        pfd.revents = 0;
        int prc = poll(&pfd, 1, timeout_ms);
        if (prc <= 0)
        {
            // timeout or poll error
            if (prc == 0)
                errno = ETIMEDOUT;
            fcntl(fd, F_SETFL, flags);
            return -1;
        }
        int soerr = 0;
        socklen_t slen = sizeof(soerr);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &slen) < 0)
        {
            fcntl(fd, F_SETFL, flags);
            return -1;
        }
        if (soerr != 0)
        {
            errno = soerr;
            fcntl(fd, F_SETFL, flags);
            return -1;
        }
        // Success; restore blocking flags
        fcntl(fd, F_SETFL, flags);
        return 0;
    }

    static bool parse_http_response(const std::string &resp, std::string &body_out)
    {
        // Find header/body separator \r\n\r\n
        size_t pos = resp.find("\r\n\r\n");
        if (pos == std::string::npos)
            return false;
        // Optionally validate status line starts with HTTP/1.1 200
        size_t line_end = resp.find("\r\n");
        if (line_end == std::string::npos)
            return false;
        std::string status = resp.substr(0, line_end);
        if (status.find("200") == std::string::npos)
        {
            // still return body for debugging
        }
        body_out = resp.substr(pos + 4);
        return true;
    }

} // namespace

std::string HttpClient::get(const std::string &host, uint16_t port, const std::string &path,
                            int timeout_ms)
{
    last_error_.clear();

    // Resolve host
    struct addrinfo hints;
    std::memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET; // IPv4 only for simplicity
    hints.ai_socktype = SOCK_STREAM;
    struct addrinfo *res = nullptr;
    std::string port_str = std::to_string(port);
    int rc = getaddrinfo(host.c_str(), port_str.c_str(), &hints, &res);
    if (rc != 0)
    {
        last_error_ = std::string("getaddrinfo: ") + gai_strerror(rc);
        return {};
    }

    int fd = -1;
    for (struct addrinfo *p = res; p != nullptr; p = p->ai_next)
    {
        fd = ::socket(p->ai_family, p->ai_socktype, p->ai_protocol);
        if (fd < 0)
            continue;
        if (!set_timeouts(fd, timeout_ms))
        {
            last_error_ = "setsockopt timeouts failed";
            ::close(fd);
            fd = -1;
            continue;
        }
        if (connect_with_timeout(fd, p->ai_addr, p->ai_addrlen, timeout_ms) == 0)
        {
            break; // connected
        }
        else
        {
            last_error_ = std::string("connect failed: ") + std::strerror(errno);
            ::close(fd);
            fd = -1;
            continue;
        }
    }
    freeaddrinfo(res);

    if (fd < 0)
    {
        if (last_error_.empty())
            last_error_ = "could not connect";
        return {};
    }

    // Build request
    std::ostringstream oss;
    oss << "GET " << (path.empty() ? "/" : path) << " HTTP/1.1\r\n";
    oss << "Host: " << host << ":" << port << "\r\n";
    oss << "User-Agent: JARVIS/1.0\r\n";
    oss << "Accept: application/json\r\n";
    oss << "Connection: close\r\n\r\n";
    std::string req = oss.str();

    ssize_t sent = ::send(fd, req.data(), req.size(), 0);
    if (sent < 0)
    {
        last_error_ = std::string("send failed: ") + std::strerror(errno);
        ::close(fd);
        return {};
    }

    std::string resp;
    char buf[4096];
    while (true)
    {
        ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
        if (n > 0)
        {
            resp.append(buf, buf + n);
        }
        else if (n == 0)
        {
            break; // EOF
        }
        else
        {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
            {
                // timed out
                last_error_ = "recv timeout";
            }
            else
            {
                last_error_ = std::string("recv failed: ") + std::strerror(errno);
            }
            ::close(fd);
            return {};
        }
    }
    ::close(fd);

    std::string body;
    if (!parse_http_response(resp, body))
    {
        last_error_ = "invalid HTTP response";
        return {};
    }
    return body;
}
