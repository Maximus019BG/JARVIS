import crypto from "crypto";
import { env } from "~/env";

/**
 * Converts a URL-safe base64 string to standard base64
 */
function b64UrlToB64(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return b64;
}

/**
 * Attempts to decode a URL-safe base64 string to a Buffer
 * Returns null if decoding fails
 */
export function tryBase64UrlDecode(s: string): Buffer | null {
  try {
    const b = Buffer.from(b64UrlToB64(s), "base64");
    return b.length ? b : null;
  } catch {
    return null;
  }
}

/**
 * Attempts to decode a hex string to a Buffer
 * Returns null if the string is not valid hex or decoding fails
 */
export function tryHexDecode(s: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) return null;
  try {
    return Buffer.from(s, "hex");
  } catch {
    return null;
  }
}

/**
 * Derives a 32-byte AES key from a secret string using SHA-256
 */
export function aesKeyFromSecret(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest(); // 32 bytes
}

/**
 * Attempts to decrypt data using AES-256-CBC
 * Expects the buffer to contain IV (16 bytes) followed by ciphertext
 * Returns null if decryption fails
 */
export function tryDecryptAes256Cbc(buf: Buffer, key: Buffer): string | null {
  if (buf.length <= 16) return null;
  const iv = buf.subarray(0, 16);
  const ct = buf.subarray(16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Attempts to decrypt data using AES-256-ECB
 * Returns null if decryption fails
 */
export function tryDecryptAes256Ecb(buf: Buffer, key: Buffer): string | null {
  try {
    const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
    decipher.setAutoPadding(true);
    const out = Buffer.concat([decipher.update(buf), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Decodes an encrypted ID using the provided secret
 * Tries multiple decryption methods:
 * 1. URL-safe base64 -> AES-256-CBC
 * 2. URL-safe base64 -> AES-256-ECB
 * 3. Hex -> AES-256-CBC
 * 4. Hex -> AES-256-ECB
 * Falls back to returning the input as-is if all methods fail
 */
export function decodeId(input: string, secret: string): string {
  const key = aesKeyFromSecret(secret);

  // 1) Try URL-safe base64 -> AES-256-CBC (iv|ct)
  const b64buf = tryBase64UrlDecode(input);
  if (b64buf) {
    const cbc = tryDecryptAes256Cbc(b64buf, key);
    if (cbc) return cbc;

    const ecb = tryDecryptAes256Ecb(b64buf, key);
    if (ecb) return ecb;
  }

  // 2) Try hex -> AES-256-CBC / AES-256-ECB
  const hexbuf = tryHexDecode(input);
  if (hexbuf) {
    const cbc = tryDecryptAes256Cbc(hexbuf, key);
    if (cbc) return cbc;

    const ecb = tryDecryptAes256Ecb(hexbuf, key);
    if (ecb) return ecb;
  }

  // 3) Fallback: return as-is (supports unencrypted IDs too)
  return input;
}

/**
 * Gets the encryption secret from environment variables
 * Throws an error if the secret is not configured
 */
export function getEncryptionSecret(): string {
  const secret = env.ENCRYPTION_SECRET as string | undefined;

  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error("ENCRYPTION_SECRET environment variable is not configured");
  }

  return secret;
}