/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Note: Babel `presets` are NOT a valid `NextConfig` property.
 * If you need custom Babel config, use a `babel.config.js` or `.babelrc` in this `web/` folder.
 */
const config: NextConfig = {
  /** Self-contained server for the Docker image (web/Dockerfile). Traced from the repo root. */
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  /**
   * The blueprint engine lives in `../tui/src/blueprint` and is imported as `@blueprint/*`.
   * It is shared *source*, not a published package: the TUI, this app and the Pi must agree
   * exactly on the document schema, geometry and merge rules, and a copy would drift.
   * `externalDir` lets Next compile TypeScript from outside `web/`.
   */
  experimental: { externalDir: true },
  /**
   * Hand tracking (`/api/device/hand`). onnxruntime-node is a native addon, loaded from
   * node_modules rather than bundled. It picks its `.node` binary from a path computed at
   * runtime, which file tracing cannot follow, so the linux-x64 build (what Vercel and the
   * Docker image run, ~34MB) is included by hand — the package's other platforms (~270MB)
   * never make it in. The models are read from disk at runtime, so they are listed too.
   */
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/device/hand": [
      "./models/hand/*.onnx",
      "../node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/x64/*",
    ],
  },
  turbopack: { root: path.join(__dirname, "..") },
};

export default config;
