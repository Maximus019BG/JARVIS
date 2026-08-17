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
  /**
   * The blueprint engine lives in `../tui/src/blueprint` and is imported as `@blueprint/*`.
   * It is shared *source*, not a published package: the TUI, this app and the Pi must agree
   * exactly on the document schema, geometry and merge rules, and a copy would drift.
   * `externalDir` lets Next compile TypeScript from outside `web/`.
   */
  experimental: { externalDir: true },
  turbopack: { root: path.join(__dirname, "..") },
};

export default config;
