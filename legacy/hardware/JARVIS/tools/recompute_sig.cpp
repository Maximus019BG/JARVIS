// recompute_sig.cpp
// Small utility to recompute the `signature` field in a .jarvis file
// Usage: recompute_sig <path/to/file.jarvis>
// If environment variable JARVIS_SECRET is set, HMAC-SHA256 is used; otherwise plain SHA256 is used.

#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include "../include/crypto.hpp"

int main(int argc, char **argv)
{
    if (argc < 2)
    {
        std::cerr << "Usage: recompute_sig <file.jarvis>\n";
        return 2;
    }
    std::string path = argv[1];

    std::ifstream in(path);
    if (!in.is_open())
    {
        std::cerr << "Failed to open " << path << " for reading\n";
        return 2;
    }
    nlohmann::json j;
    try {
        in >> j;
    } catch (const std::exception &e) {
        std::cerr << "JSON parse error: " << e.what() << "\n";
        return 2;
    }
    in.close();

    // Remove any existing signature
    if (j.contains("signature")) j.erase("signature");

    // Serialize to CBOR deterministic representation
    std::vector<uint8_t> cbor = nlohmann::json::to_cbor(j);
    std::string payload(cbor.begin(), cbor.end());

    const char *secret_env = std::getenv("JARVIS_SECRET");
    std::string sig;
    if (secret_env && *secret_env)
    {
        sig = crypto::hmac_sha256_hex(payload, std::string(secret_env));
    }
    else
    {
        sig = crypto::sha256_hex(payload);
    }

    j["signature"] = sig;

    // Write atomically to a temp file then rename
    std::string tmp = path + ".tmp";
    std::ofstream out(tmp, std::ios::trunc);
    if (!out.is_open())
    {
        std::cerr << "Failed to open temp file for writing: " << tmp << "\n";
        return 2;
    }
    out << j.dump(2) << "\n";
    out.close();

    if (std::rename(tmp.c_str(), path.c_str()) != 0)
    {
        std::perror("rename");
        std::remove(tmp.c_str());
        return 2;
    }

    std::cout << "Recomputed signature and updated: " << path << "\n";
    std::cout << "New signature: " << sig << "\n";
    return 0;
}
