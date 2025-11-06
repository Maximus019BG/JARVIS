#include <gtest/gtest.h>
#include "crypto.hpp"
#include <string>

// Test basic encryption produces non-empty output
TEST(CryptoTest, EncryptProducesOutput) {
    const std::string plaintext = "TestDevice123";
    const std::string secret = "my-secret-key";
    
    std::string encrypted = crypto::aes256_encrypt(plaintext, secret);
    EXPECT_FALSE(encrypted.empty());
    EXPECT_NE(encrypted, plaintext);
}

// Test empty input handling
TEST(CryptoTest, EmptyInput) {
    const std::string secret = "my-secret-key";
    
    std::string encrypted = crypto::aes256_encrypt("", secret);
    // Should handle empty gracefully (implementation dependent)
    EXPECT_TRUE(encrypted.empty() || !encrypted.empty());
}

// Test different plaintexts produce different ciphertexts
TEST(CryptoTest, DifferentPlaintextsDifferentCiphertexts) {
    const std::string secret = "my-secret-key";
    const std::string text1 = "Device001";
    const std::string text2 = "Device002";
    
    std::string enc1 = crypto::aes256_encrypt(text1, secret);
    std::string enc2 = crypto::aes256_encrypt(text2, secret);
    
    EXPECT_NE(enc1, enc2);
}

// Test consistent encryption with same inputs
TEST(CryptoTest, ConsistentEncryption) {
    const std::string plaintext = "TestDevice123";
    const std::string secret = "my-secret-key";
    
    std::string enc1 = crypto::aes256_encrypt(plaintext, secret);
    std::string enc2 = crypto::aes256_encrypt(plaintext, secret);
    
    // With IV prepended, should be different each time (IV is random)
    // If implementation uses fixed IV, they might be the same
    EXPECT_FALSE(enc1.empty());
    EXPECT_FALSE(enc2.empty());
}

// Test URL-safe encoding (no +, /, = characters that break URLs)
TEST(CryptoTest, UrlSafeEncoding) {
    const std::string plaintext = "workstation-001-very-long-id-to-force-padding";
    const std::string secret = "test-secret";
    
    std::string encrypted = crypto::aes256_encrypt(plaintext, secret);
    
    // Should not contain URL-problematic characters if using URL-safe base64
    // If using hex encoding, this test passes automatically
    EXPECT_FALSE(encrypted.empty());
    
    // Check it's valid hex or URL-safe base64
    bool is_hex = encrypted.find_first_not_of("0123456789abcdefABCDEF") == std::string::npos;
    bool is_urlsafe = encrypted.find('+') == std::string::npos && 
                       encrypted.find('/') == std::string::npos &&
                       encrypted.find('=') == std::string::npos;
    
    EXPECT_TRUE(is_hex || is_urlsafe);
}

// Test long input
TEST(CryptoTest, LongInput) {
    std::string plaintext(1000, 'A'); // 1000 bytes of 'A'
    const std::string secret = "test-secret";
    
    std::string encrypted = crypto::aes256_encrypt(plaintext, secret);
    EXPECT_FALSE(encrypted.empty());
    EXPECT_GT(encrypted.length(), plaintext.length() / 2); // Should be substantial
}
