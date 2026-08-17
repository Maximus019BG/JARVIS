import { env } from "~/env";
import type { GatewayKeyName } from "./upstreams";

/**
 * The upstream credential for a key name. The only gateway module that imports `~/env`, so
 * everything else stays a pure function over data.
 *
 * An explicit switch, not `process.env[name]`: a dynamic index would read variables that
 * src/env.js never validated, which is how a typo'd name becomes a silent `undefined` at
 * request time instead of a boot error.
 */
export function keyFor(name: GatewayKeyName): string | undefined {
  switch (name) {
    case "GATEWAY_KEY_A":
      return env.GATEWAY_KEY_A;
    case "GATEWAY_KEY_B":
      return env.GATEWAY_KEY_B;
    case "GATEWAY_KEY_C":
      return env.GATEWAY_KEY_C;
  }
}

export const gatewayEnabled = (): boolean => env.GATEWAY_ENABLED;
