/**
 * Blueprint names are filenames on every device that syncs them — the TUI stores each one
 * as `<name>.blueprint.json` in a git repo and `safeName` in `tui/src/blueprint/store.ts`
 * rejects anything outside this pattern. A name the web accepts but a device cannot write
 * is a blueprint that silently fails to sync, so the same rule is enforced here.
 *
 * The regex is duplicated rather than imported because `store.ts` is Bun-only (fs, spawn)
 * and importing it into the web bundle does not compile.
 */
export const BLUEPRINT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isValidBlueprintName = (name: string) => BLUEPRINT_NAME_RE.test(name);

/** Best-effort correction, so typing "Front Panel v2" offers `front-panel-v2` instead of an error. */
export function slugifyBlueprintName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}
