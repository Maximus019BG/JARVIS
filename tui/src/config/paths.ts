import { homedir } from "node:os"
import { join } from "node:path"

const home = homedir()

/** ~/.config/jarvis — user-global config, themes, agents, commands. */
export const configDir = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "jarvis")

/** ~/.local/share/jarvis — sessions and other persisted state. */
export const dataDir = join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "jarvis")

export const sessionDir = join(dataDir, "sessions")

/** Per-project override directory, resolved against a project root. */
export const projectDir = (root: string) => join(root, ".jarvis")

export const configNames = ["jarvis.jsonc", "jarvis.json"]
