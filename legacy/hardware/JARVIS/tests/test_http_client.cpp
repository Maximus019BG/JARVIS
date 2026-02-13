#include <gtest/gtest.h>
#include "http_client.hpp"
#include <string>

// Note: These tests are basic unit tests for HttpClient structure.
// For full integration testing, you'd need a mock HTTP server or real endpoint.

class HttpClientTest : public ::testing::Test {
protected:
    HttpClient client;
};

// Test that HttpClient can be instantiated
TEST_F(HttpClientTest, Instantiation) {
    EXPECT_NO_THROW(HttpClient());
}

// Test error handling for invalid host
TEST_F(HttpClientTest, InvalidHostReturnsEmpty) {
    std::string result = client.get("invalid-host-that-does-not-exist.local", 80, "/", 500);
    EXPECT_TRUE(result.empty());
    EXPECT_FALSE(client.last_error().empty());
}

// Test error handling for unreachable port
TEST_F(HttpClientTest, UnreachablePortReturnsEmpty) {
    std::string result = client.get("127.0.0.1", 65432, "/", 500);
    EXPECT_TRUE(result.empty());
    EXPECT_FALSE(client.last_error().empty());
}

// Test timeout parameter is accepted
TEST_F(HttpClientTest, TimeoutParameter) {
    // Very short timeout should fail quickly
    auto start = std::chrono::steady_clock::now();
    std::string result = client.get("192.0.2.1", 80, "/", 100); // TEST-NET-1 (non-routable)
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start
    ).count();
    
    EXPECT_TRUE(result.empty());
    // Should timeout relatively quickly (within 500ms including overhead)
    EXPECT_LT(duration, 500);
}

// Test last_error is cleared on success
// (This would need a real/mock server to test properly)
// Placeholder test:
TEST_F(HttpClientTest, LastErrorInitiallyEmpty) {
    HttpClient fresh_client;
    EXPECT_TRUE(fresh_client.last_error().empty());
}

// Test path handling
TEST_F(HttpClientTest, PathHandling) {
    // Just verify it accepts different path formats without crashing
    EXPECT_NO_THROW({
        client.get("127.0.0.1", 8080, "/", 100);
        client.get("127.0.0.1", 8080, "/api/test", 100);
        client.get("127.0.0.1", 8080, "/api/test?param=value", 100);
    });
}
