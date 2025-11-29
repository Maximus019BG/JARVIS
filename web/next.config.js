/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	eslint: {
		// Allow builds to complete locally even if ESLint reports issues.
		ignoreDuringBuilds: true,
	},
	typescript: {
		// Allow builds to complete locally even if TypeScript reports type errors.
		ignoreBuildErrors: true,
	},
};

export default config;
