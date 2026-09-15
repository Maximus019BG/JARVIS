/**
 * What a remote client — the phone, the web session view — needs to know before it tries to
 * steer a terminal.
 *
 * The queue is the reason this exists. `POST /api/session/[id]/prompt` refuses once
 * `MAX_PENDING` prompts are waiting, and finding that out *after* dictating a paragraph into a
 * phone is a bad way to learn it. Handing the count back with the list lets a client grey the
 * microphone out before somebody starts talking.
 */

/** Prompts already waiting before another is refused, so a stuck terminal cannot be flooded. */
export const MAX_PENDING = 10;

/** How long after its last update a session stops being worth offering as "probably live". */
export const FRESH_MS = 30 * 60 * 1000;

export type SessionRow = {
  id: string;
  title: string;
  cwd: string;
  workstation: string | null;
  updatedAt: Date;
  /** Prompts queued and not yet picked up by the terminal. */
  queued: number;
};

export type SteerableSession = SessionRow & {
  /** Milliseconds since the terminal last pushed anything. */
  idleMs: number;
  /**
   * Whether this is worth offering first. Not a promise that the terminal is running — the
   * TUI only mirrors sessions when `syncSessions` is on, so a genuinely live session can look
   * stale. It is a hint for ordering, never a gate on sending.
   */
  fresh: boolean;
  /** The queue is full: sending would be refused, so a client should say so up front. */
  full: boolean;
};

/**
 * Newest first, annotated, capped.
 *
 * Sorting here rather than in SQL because the annotations are what a caller actually orders
 * by, and a `LIMIT` applied before them would cut the list on a different rule than the one
 * the client sees.
 */
export function steerable(rows: readonly SessionRow[], now: number, limit = 50): SteerableSession[] {
  return rows
    .map((row) => {
      const idleMs = Math.max(0, now - row.updatedAt.getTime());
      return { ...row, idleMs, fresh: idleMs < FRESH_MS, full: row.queued >= MAX_PENDING };
    })
    .sort((a, b) => a.idleMs - b.idleMs)
    .slice(0, limit);
}
