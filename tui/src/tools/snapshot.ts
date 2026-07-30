import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** `null` means the file did not exist, so undoing the change deletes it again. */
type Change = { path: string; before: string | null }

type Stack = { undo: Change[][]; redo: Change[][] }

/**
 * File contents from before the agent touched them, grouped per turn, in memory only.
 *
 * ponytail: dies with the process, unlike opencode's git snapshots. That covers the actual
 * ask — "undo what it just did" — and git already covers the durable case. If sessions
 * need to be undoable after a restart, write the groups to dataDir.
 */
const stacks = new Map<string, Stack>()

const stack = (session: string): Stack => {
  const found = stacks.get(session) ?? { undo: [], redo: [] }
  stacks.set(session, found)
  return found
}

/**
 * Opens a group so everything one turn writes is undone together. Without it each file
 * would be its own undo step, which is tedious after a refactor across ten files.
 */
export function beginGroup(session: string) {
  const { undo, redo } = stack(session)
  undo.push([])
  // A new change makes the redo history unreachable, same as any editor.
  redo.length = 0
}

/** Records a file's current content before it is overwritten. */
export function record(session: string, path: string) {
  const { undo } = stack(session)
  // No open group means no turn is running (headless, a subagent): give it its own.
  if (undo.length === 0) undo.push([])
  const group = undo[undo.length - 1]!
  // Only the first write in a group matters; later ones would shadow the real original.
  if (group.some((change) => change.path === path)) return
  group.push({ path, before: existsSync(path) ? readFileSync(path, "utf8") : null })
}

/** Drops the group if the turn wrote nothing, so /undo never reports "0 files". */
export function endGroup(session: string) {
  const { undo } = stack(session)
  if (undo.length > 0 && undo[undo.length - 1]!.length === 0) undo.pop()
}

function restore(changes: Change[]): Change[] {
  const inverse: Change[] = []
  for (const { path, before } of changes) {
    inverse.push({ path, before: existsSync(path) ? readFileSync(path, "utf8") : null })
    if (before === null) rmSync(path, { force: true })
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, before)
    }
  }
  return inverse
}

export type UndoResult = { files: string[] } | { error: string }

export function undo(session: string): UndoResult {
  const { undo, redo } = stack(session)
  const group = undo.pop()
  if (!group) return { error: "nothing to undo" }
  redo.push(restore(group))
  return { files: group.map((change) => change.path) }
}

export function redo(session: string): UndoResult {
  const { undo, redo } = stack(session)
  const group = redo.pop()
  if (!group) return { error: "nothing to redo" }
  undo.push(restore(group))
  return { files: group.map((change) => change.path) }
}

export function clearSnapshots(session: string) {
  stacks.delete(session)
}
