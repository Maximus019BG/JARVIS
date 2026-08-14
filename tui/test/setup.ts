import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Points the XDG directories at empty temp dirs before anything else loads.
 *
 * `configDir` and `dataDir` in `src/config/paths.ts` are module-level constants read from
 * the environment, so this has to happen in a preload — by the time a test file's imports
 * run it is already too late.
 *
 * Without it, every test that resolves agents, skills, commands or themes also picks up
 * whatever the developer has in `~/.config/jarvis`. That made several tests pass only on a
 * machine with nothing installed, and fail the moment someone ran `install.sh` — a real
 * failure with no real cause, which is the worst kind to debug.
 */
const sandbox = mkdtempSync(join(tmpdir(), "jarvis-test-home-"))
process.env.XDG_CONFIG_HOME = join(sandbox, "config")
process.env.XDG_DATA_HOME = join(sandbox, "data")
