#pragma once
#include <string>

namespace crypto {

// Encrypt plaintext using AES-256-CBC with the given secret key.
// Returns hex-encoded ciphertext (including IV prepended).
// On error, returns empty string.
std::string aes256_encrypt(const std::string& plaintext, const std::string& secret);
// Compute HMAC-SHA256 hex string (lowercase) using key
std::string hmac_sha256_hex(const std::string& data, const std::string& key);
// Compute SHA256 hex string (lowercase)
std::string sha256_hex(const std::string& data);

} // namespace crypto
