#include "crypto.hpp"
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <cstring>
#include <vector>
#include <sstream>
#include <iomanip>
#include <openssl/hmac.h>

namespace crypto {

static std::string to_hex(const unsigned char* data, size_t len) {
    std::ostringstream oss;
    for (size_t i = 0; i < len; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0') << (int)data[i];
    }
    return oss.str();
}

std::string aes256_encrypt(const std::string& plaintext, const std::string& secret) {
    if (plaintext.empty() || secret.empty()) return {};

    // Derive a 32-byte key from secret using SHA256
    unsigned char key[32];
    SHA256(reinterpret_cast<const unsigned char*>(secret.data()), secret.size(), key);

    // Generate random 16-byte IV
    unsigned char iv[16];
    if (RAND_bytes(iv, sizeof(iv)) != 1) return {};

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return {};

    if (EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), nullptr, key, iv) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        return {};
    }

    std::vector<unsigned char> ciphertext(plaintext.size() + EVP_CIPHER_block_size(EVP_aes_256_cbc()));
    int len = 0, ciphertext_len = 0;

    if (EVP_EncryptUpdate(ctx, ciphertext.data(), &len,
                          reinterpret_cast<const unsigned char*>(plaintext.data()),
                          static_cast<int>(plaintext.size())) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        return {};
    }
    ciphertext_len = len;

    if (EVP_EncryptFinal_ex(ctx, ciphertext.data() + len, &len) != 1) {
        EVP_CIPHER_CTX_free(ctx);
        return {};
    }
    ciphertext_len += len;
    EVP_CIPHER_CTX_free(ctx);

    // Prepend IV to ciphertext and return as hex
    std::string result = to_hex(iv, sizeof(iv)) + to_hex(ciphertext.data(), ciphertext_len);
    return result;
}

std::string hmac_sha256_hex(const std::string& data, const std::string& key)
{
    unsigned int len = EVP_MAX_MD_SIZE;
    unsigned char out[EVP_MAX_MD_SIZE];
    if (!HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
              reinterpret_cast<const unsigned char*>(data.data()), static_cast<int>(data.size()), out, &len))
    {
        return std::string();
    }
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (unsigned int i = 0; i < len; ++i)
        oss << std::setw(2) << static_cast<int>(out[i]);
    return oss.str();
}

std::string sha256_hex(const std::string& data)
{
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(data.data()), data.size(), hash);
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (int i = 0; i < SHA256_DIGEST_LENGTH; ++i)
        oss << std::setw(2) << static_cast<int>(hash[i]);
    return oss.str();
}

} // namespace crypto
