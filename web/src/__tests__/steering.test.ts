import { FRESH_MS, MAX_PENDING, steerable, type SessionRow } from "~/server/steering";

const NOW = Date.parse("2026-09-08T12:00:00Z");

const row = (over: Partial<SessionRow> & { id: string }): SessionRow => ({
  title: "a session",
  cwd: "/home/max/project",
  workstation: "bench",
  updatedAt: new Date(NOW),
  queued: 0,
  ...over,
});

describe("steerable", () => {
  it("puts the least idle session first, whatever order the rows arrive in", () => {
    const rows = [
      row({ id: "old", updatedAt: new Date(NOW - 3 * 60 * 60 * 1000) }),
      row({ id: "new", updatedAt: new Date(NOW - 60 * 1000) }),
      row({ id: "middle", updatedAt: new Date(NOW - 10 * 60 * 1000) }),
    ];
    expect(steerable(rows, NOW).map((session) => session.id)).toEqual(["new", "middle", "old"]);
  });

  it("reports idleness in milliseconds, never negative", () => {
    // A workstation clock a little ahead of the server's should read as "just now", not as a
    // negative age that sorts in front of everything.
    const ahead = steerable([row({ id: "a", updatedAt: new Date(NOW + 5000) })], NOW)[0]!;
    expect(ahead.idleMs).toBe(0);
    expect(steerable([row({ id: "a", updatedAt: new Date(NOW - 90_000) })], NOW)[0]!.idleMs).toBe(90_000);
  });

  it("marks the recently updated as fresh", () => {
    const rows = [
      row({ id: "fresh", updatedAt: new Date(NOW - FRESH_MS + 1000) }),
      row({ id: "stale", updatedAt: new Date(NOW - FRESH_MS - 1000) }),
    ];
    const [fresh, stale] = steerable(rows, NOW);
    expect(fresh!.fresh).toBe(true);
    expect(stale!.fresh).toBe(false);
  });

  /**
   * The reason the endpoint exists. Finding out the queue was full *after* dictating a
   * paragraph into a phone is a bad way to learn it, so the flag has to agree exactly with
   * the number the prompt route refuses at.
   */
  it("flags a full queue at the same count the prompt route refuses at", () => {
    expect(steerable([row({ id: "a", queued: MAX_PENDING - 1 })], NOW)[0]!.full).toBe(false);
    expect(steerable([row({ id: "a", queued: MAX_PENDING })], NOW)[0]!.full).toBe(true);
    expect(steerable([row({ id: "a", queued: MAX_PENDING + 3 })], NOW)[0]!.full).toBe(true);
  });

  it("caps the list after annotating, not before", () => {
    // Ordering is by idleness, which is computed here — a LIMIT in SQL would have cut the
    // list on whatever order the query happened to return.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ id: `s${i}`, updatedAt: new Date(NOW - (10 - i) * 60_000) }),
    );
    const capped = steerable(rows, NOW, 3);
    expect(capped).toHaveLength(3);
    expect(capped.map((session) => session.id)).toEqual(["s9", "s8", "s7"]);
  });

  it("survives an empty account", () => {
    expect(steerable([], NOW)).toEqual([]);
  });
});
