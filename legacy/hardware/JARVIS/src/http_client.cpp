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
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <iostream>

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

    static bool parse_http_response(const std::string &resp, std::string &body_out, int &status_out)
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
        // Extract numeric status code if present
        status_out = 0;
        {
            size_t sp1 = status.find(' ');
            if (sp1 != std::string::npos)
            {
                size_t sp2 = status.find(' ', sp1 + 1);
                std::string code = (sp2 == std::string::npos) ? status.substr(sp1 + 1) : status.substr(sp1 + 1, sp2 - sp1 - 1);
                try { status_out = std::stoi(code); } catch (...) { status_out = 0; }
            }
        }
        body_out = resp.substr(pos + 4);
        return true;
    }

} // namespace

// use_tls: if true, initiate TLS over the connected socket (OpenSSL)
std::string HttpClient::get(const std::string &host, uint16_t port, const std::string &path,
                            int timeout_ms, bool use_tls)
{
    last_error_.clear();
    const char *dbg_env = std::getenv("JARVIS_HTTP_DEBUG");
    bool http_debug = dbg_env && *dbg_env;

    // Resolve host
    struct addrinfo hints;
    std::memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC; // allow IPv4 or IPv6
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
            // record which address we attempted for better diagnostics
            char addrbuf[128] = {};
            if (p->ai_family == AF_INET)
            {
                struct sockaddr_in *sin = reinterpret_cast<struct sockaddr_in *>(p->ai_addr);
                inet_ntop(AF_INET, &sin->sin_addr, addrbuf, sizeof(addrbuf));
            }
            else if (p->ai_family == AF_INET6)
            {
                struct sockaddr_in6 *sin6 = reinterpret_cast<struct sockaddr_in6 *>(p->ai_addr);
                inet_ntop(AF_INET6, &sin6->sin6_addr, addrbuf, sizeof(addrbuf));
            }
            last_error_ = std::string("connect failed to ") + addrbuf + ": " + std::strerror(errno);
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

    // If TLS requested, create SSL objects
    SSL_CTX *ctx = nullptr;
    SSL *ssl = nullptr;
    if (use_tls)
    {
        SSL_load_error_strings();
        OpenSSL_add_ssl_algorithms();
        ctx = SSL_CTX_new(TLS_client_method());
        if (!ctx)
        {
            last_error_ = "OpenSSL: SSL_CTX_new failed";
            ::close(fd);
            return {};
        }
        ssl = SSL_new(ctx);
        if (!ssl)
        {
            last_error_ = "OpenSSL: SSL_new failed";
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
        if (!SSL_set_fd(ssl, fd))
        {
            last_error_ = "OpenSSL: SSL_set_fd failed";
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
        // Set Server Name Indication (SNI) so TLS servers can route correctly
        if (!SSL_set_tlsext_host_name(ssl, host.c_str()))
        {
            // Not fatal; continue but log to last_error_ for diagnostics
            unsigned long err = ERR_get_error();
            char buf[256];
            ERR_error_string_n(err, buf, sizeof(buf));
            last_error_ = std::string("SSL_set_tlsext_host_name warning: ") + buf;
        }
        if (SSL_connect(ssl) != 1)
        {
            unsigned long err = ERR_get_error();
            char buf[256];
            ERR_error_string_n(err, buf, sizeof(buf));
            last_error_ = std::string("SSL_connect failed: ") + buf;
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
    }

    // Build request
    std::ostringstream oss;
    oss << "GET " << (path.empty() ? "/" : path) << " HTTP/1.1\r\n";
    oss << "Host: " << host << ":" << port << "\r\n";
    oss << "User-Agent: JARVIS/1.0\r\n";
    oss << "Accept: application/json\r\n";
    oss << "Connection: close\r\n\r\n";
    std::string req = oss.str();
    if (http_debug)
    {
        std::cerr << "[HttpClient] >>> GET " << (use_tls ? "https://" : "http://") << host << ":" << port << path << "\n";
        std::cerr << "[HttpClient] >>> Request:\n" << req << "\n";
    }
    ssize_t sent = 0;
    if (use_tls)
    {
        sent = SSL_write(ssl, req.data(), static_cast<int>(req.size()));
        if (sent <= 0)
        {
            last_error_ = "SSL_write failed";
            SSL_shutdown(ssl);
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
    }
    else
    {
        sent = ::send(fd, req.data(), req.size(), 0);
        if (sent < 0)
        {
            last_error_ = std::string("send failed: ") + std::strerror(errno);
            ::close(fd);
            return {};
        }
    }

    std::string resp;
    char buf[4096];
    while (true)
    {
        ssize_t n = 0;
        if (use_tls)
            n = SSL_read(ssl, buf, sizeof(buf));
        else
            n = ::recv(fd, buf, sizeof(buf), 0);

        if (n > 0)
        {
            resp.append(buf, buf + n);
            continue;
        }
        if (n == 0)
            break; // EOF

        // error
        if (use_tls)
        {
            int err = SSL_get_error(ssl, static_cast<int>(n));
            if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE)
            {
                last_error_ = "SSL read timeout";
            }
            else
            {
                last_error_ = "SSL_read failed";
            }
        }
        else
        {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                last_error_ = "recv timeout";
            else
                last_error_ = std::string("recv failed: ") + std::strerror(errno);
        }
        break;
    }

    if (use_tls)
    {
        SSL_shutdown(ssl);
        SSL_free(ssl);
        SSL_CTX_free(ctx);
    }
    ::close(fd);

    int status = 0;
    std::string body;
    if (!parse_http_response(resp, body, status))
    {
        last_error_ = "invalid HTTP response";
        if (http_debug)
        {
            std::cerr << "[HttpClient] <<< Invalid HTTP response (raw length=" << resp.size() << "):\n";
            std::cerr << resp << "\n";
        }
        return {};
    }
    if (http_debug)
    {
        std::cerr << "[HttpClient] <<< Response status=" << status << " body_len=" << body.size() << "\n";
        // Print a truncated body for readability
        std::string body_snip = body.substr(0, std::min<size_t>(body.size(), 4096));
        std::cerr << "[HttpClient] <<< Body (first " << body_snip.size() << " bytes):\n" << body_snip << "\n";
    }
    if (status < 200 || status >= 300)
    {
        last_error_ = std::string("HTTP error: ") + std::to_string(status) + " body=" + body;
        return {};
    }
    return body;
}

std::string HttpClient::post(const std::string &host, uint16_t port, const std::string &path,
                            const std::string &body, const std::string &content_type,
                            int timeout_ms, bool use_tls)
{
    last_error_.clear();
    const char *dbg_env = std::getenv("JARVIS_HTTP_DEBUG");
    bool http_debug = dbg_env && *dbg_env;

    // Resolve host
    struct addrinfo hints;
    std::memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC; // allow IPv4 or IPv6
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
            char addrbuf[128] = {};
            if (p->ai_family == AF_INET)
            {
                struct sockaddr_in *sin = reinterpret_cast<struct sockaddr_in *>(p->ai_addr);
                inet_ntop(AF_INET, &sin->sin_addr, addrbuf, sizeof(addrbuf));
            }
            else if (p->ai_family == AF_INET6)
            {
                struct sockaddr_in6 *sin6 = reinterpret_cast<struct sockaddr_in6 *>(p->ai_addr);
                inet_ntop(AF_INET6, &sin6->sin6_addr, addrbuf, sizeof(addrbuf));
            }
            last_error_ = std::string("connect failed to ") + addrbuf + ": " + std::strerror(errno);
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

    // If TLS requested, create SSL objects
    SSL_CTX *ctx = nullptr;
    SSL *ssl = nullptr;
    if (use_tls)
    {
        SSL_load_error_strings();
        OpenSSL_add_ssl_algorithms();
        ctx = SSL_CTX_new(TLS_client_method());
        if (!ctx)
        {
            last_error_ = "OpenSSL: SSL_CTX_new failed";
            ::close(fd);
            return {};
        }
        ssl = SSL_new(ctx);
        if (!ssl)
        {
            last_error_ = "OpenSSL: SSL_new failed";
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
        if (!SSL_set_fd(ssl, fd))
        {
            last_error_ = "OpenSSL: SSL_set_fd failed";
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
        if (SSL_connect(ssl) != 1)
        {
            unsigned long err = ERR_get_error();
            char buf[256];
            ERR_error_string_n(err, buf, sizeof(buf));
            last_error_ = std::string("SSL_connect failed: ") + buf;
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
    }

    // Build request
    std::ostringstream oss;
    oss << "POST " << (path.empty() ? "/" : path) << " HTTP/1.1\r\n";
    oss << "Host: " << host << ":" << port << "\r\n";
    oss << "User-Agent: JARVIS/1.0\r\n";
    oss << "Accept: application/json\r\n";
    oss << "Content-Type: " << content_type << "\r\n";
    oss << "Content-Length: " << body.size() << "\r\n";
    oss << "Connection: close\r\n\r\n";
    std::string header = oss.str();

    if (http_debug)
    {
        std::cerr << "[HttpClient] >>> POST " << (use_tls ? "https://" : "http://") << host << ":" << port << path << "\n";
        std::cerr << "[HttpClient] >>> Headers:\n" << header << "\n";
        std::string body_snip = body.substr(0, std::min<size_t>(body.size(), 8192));
        std::cerr << "[HttpClient] >>> Body (first " << body_snip.size() << " bytes):\n" << body_snip << "\n";
    }

    // send header + body (using SSL if requested)
    if (use_tls)
    {
        ssize_t s = SSL_write(ssl, header.data(), static_cast<int>(header.size()));
        if (s <= 0)
        {
            last_error_ = "SSL_write(header) failed";
            SSL_shutdown(ssl);
            SSL_free(ssl);
            SSL_CTX_free(ctx);
            ::close(fd);
            return {};
        }
        size_t to_send = body.size();
        const char *ptr = body.data();
        while (to_send > 0)
        {
            int sent = SSL_write(ssl, ptr, static_cast<int>(to_send));
            if (sent <= 0)
            {
                last_error_ = "SSL_write(body) failed";
                SSL_shutdown(ssl);
                SSL_free(ssl);
                SSL_CTX_free(ctx);
                ::close(fd);
                return {};
            }
            to_send -= static_cast<size_t>(sent);
            ptr += sent;
        }
    }
    else
    {
        ssize_t sent = ::send(fd, header.data(), header.size(), 0);
        if (sent < 0)
        {
            last_error_ = std::string("send header failed: ") + std::strerror(errno);
            ::close(fd);
            return {};
        }
        size_t to_send = body.size();
        const char *ptr = body.data();
        while (to_send > 0)
        {
            ssize_t s = ::send(fd, ptr, to_send, 0);
            if (s < 0)
            {
                last_error_ = std::string("send body failed: ") + std::strerror(errno);
                ::close(fd);
                return {};
            }
            to_send -= static_cast<size_t>(s);
            ptr += s;
        }
    }

    std::string resp;
    char buf[4096];
    while (true)
    {
        ssize_t n = 0;
        if (use_tls)
            n = SSL_read(ssl, buf, sizeof(buf));
        else
            n = ::recv(fd, buf, sizeof(buf), 0);

        if (n > 0)
        {
            resp.append(buf, buf + n);
            continue;
        }
        if (n == 0)
            break; // EOF

        if (use_tls)
        {
            int err = SSL_get_error(ssl, static_cast<int>(n));
            if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE)
                last_error_ = "SSL read timeout";
            else
                last_error_ = "SSL_read failed";
        }
        else
        {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                last_error_ = "recv timeout";
            else
                last_error_ = std::string("recv failed: ") + std::strerror(errno);
        }
        break;
    }

    if (use_tls)
    {
        SSL_shutdown(ssl);
        SSL_free(ssl);
        SSL_CTX_free(ctx);
    }
    ::close(fd);

    int status = 0;
    std::string body_out;
    if (!parse_http_response(resp, body_out, status))
    {
        last_error_ = "invalid HTTP response";
        if (http_debug)
        {
            std::cerr << "[HttpClient] <<< Invalid HTTP response (raw length=" << resp.size() << "):\n";
            std::cerr << resp << "\n";
        }
        return {};
    }
    if (http_debug)
    {
        std::cerr << "[HttpClient] <<< Response status=" << status << " body_len=" << body_out.size() << "\n";
        std::string body_snip = body_out.substr(0, std::min<size_t>(body_out.size(), 4096));
        std::cerr << "[HttpClient] <<< Body (first " << body_snip.size() << " bytes):\n" << body_snip << "\n";
    }
    if (status < 200 || status >= 300)
    {
        last_error_ = std::string("HTTP error: ") + std::to_string(status) + " body=" + body_out;
        return {};
    }
    return body_out;
}
