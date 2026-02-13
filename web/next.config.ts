/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Note: Babel `presets` are NOT a valid `NextConfig` property.
 * If you need custom Babel config, use a `babel.config.js` or `.babelrc` in this `web/` folder.
 */
const config: NextConfig = {
  // Add Next.js config options here.
};

export default config;
