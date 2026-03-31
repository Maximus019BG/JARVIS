/**
 * Jest mock for ~/env
 *
 * The real env.js uses @t3-oss/env-nextjs which is ESM-only and cannot be
 * loaded in a CommonJS Jest environment.  This thin shim reads the same env
 * variables directly from `process.env` so tests can set them via
 *   process.env.BLUEPRINT_SYNC_HMAC_SECRET = 'hmac'
 * in a beforeEach block.
 */
export const env = new Proxy({} as Record<string, string | undefined>, {
  get(_target, key: string) {
    return process.env[key];
  },
});
