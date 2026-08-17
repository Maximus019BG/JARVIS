/**
 * Jest mock for ~/env
 *
 * The real env.js uses @t3-oss/env-nextjs which is ESM-only and cannot be
 * loaded in a CommonJS Jest environment.  This thin shim reads the same env
 * variables directly from `process.env` so tests can set them in a
 * beforeEach block.
 */
export const env = new Proxy({}, {
  get(_target, key: string) {
    return process.env[key];
  },
});
