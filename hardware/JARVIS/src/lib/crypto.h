#pragma once
#include <string>

namespace crypto {

// Encrypt plaintext using AES-256-CBC with the given secret key.
// Returns hex-encoded ciphertext (including IV prepended).
// On error, returns empty string.
std::string aes256_encrypt(const std::string& plaintext, const std::string& secret);

} // namespace crypto
