import { describe, expect, test } from "bun:test"
import { NO_EXTENSIONS, type Extensions } from "../src/extend/extensions.ts"
import { bootReport, since, type BootFacts } from "../src/ui/boot.ts"

const extensions = (over: Partial<Extensions> = {}): Extensions => ({ ...NO_EXTENSIONS, ...over })
const facts = (over: Partial<BootFacts> = {}): BootFacts => ({ extensions: extensions(), mcp: [], ...over })
const row = (report: ReturnType<typeof bootReport>, label: string) => report.find((entry) => entry.label === label)!

describe("since", () => {
  const now = Date.parse("2026-09-08T12:00:00Z")

  test("collapses a duration to one token", () => {
    expect(since(now - 30_000, now)).toBe("just now")
    expect(since(now - 12 * 60_000, now)).toBe("12m ago")
    expect(since(now - 4 * 3_600_000, now)).toBe("4h ago")
    expect(since(now - 3 * 86_400_000, now)).toBe("3d ago")
  })

  // Clock skew between the session header and now is not a reason to print "-2m ago".
  test("a future timestamp reads as now rather than as a negative", () => {
    expect(since(now + 60_000, now)).toBe("just now")
  })
})

describe("bootReport", () => {
  test("an unpaired machine with nothing loaded still reports every fixed row", () => {
    const report = bootReport(facts())
    expect(report.map((entry) => entry.label)).toEqual(["link", "loaded", "voice"])
    expect(row(report, "link").value).toBe("standalone")
    expect(row(report, "voice").value).toBe("off")
    expect(row(report, "link").tone).toBe("off")
  })

  test("the link row names the device and the host, not the whole url", () => {
    const report = bootReport(facts({ link: { name: "bench-pi", baseUrl: "https://jarvis.example/api" } }))
    expect(row(report, "link").value).toBe("bench-pi · jarvis.example")
  })

  test("tool counts sum custom tools and every healthy mcp server", () => {
    const report = bootReport(
      facts({
        // Only the counts are read, so the entries are shaped to the report's needs rather
        // than to a real tool or skill.
        extensions: extensions({
          tools: { lint: {}, deploy: {} } as unknown as Extensions["tools"],
          skills: [{}, {}, {}] as unknown as Extensions["skills"],
        }),
        mcp: [
          { server: "cloud", tools: 12 },
          { server: "docs", tools: 3 },
        ],
      }),
    )
    expect(row(report, "loaded").value).toBe("17 tools · 3 skills · 2 mcp")
    expect(row(report, "loaded").tone).toBe("ok")
  })

  // The counts are reassurance, and reassurance printed over a load error is worse than
  // nothing — so a broken server or plugin is the one thing here that changes colour.
  test("failures are counted and colour the row", () => {
    const report = bootReport(
      facts({
        extensions: extensions({ errors: ["plugin foo: boom"] }),
        mcp: [{ server: "cloud", tools: 0, error: "ConnectionRefused" }],
      }),
    )
    expect(row(report, "loaded").value).toContain("(2 failed)")
    expect(row(report, "loaded").tone).toBe("warn")
  })

  // One row, both directions: "voice" is one thing to the person reading it.
  test("the voice row names whichever half is configured", () => {
    expect(row(bootReport(facts({ voiceModel: "groq/whisper-large-v3-turbo" })), "voice").value).toBe(
      "in groq/whisper-large-v3-turbo",
    )
    expect(row(bootReport(facts({ speaks: "piper" })), "voice").value).toBe("out piper")
    expect(row(bootReport(facts({ voiceModel: "openai/whisper-1", speaks: "piper" })), "voice").value).toBe(
      "in openai/whisper-1 · out piper",
    )
  })

  // Its own row rather than a clause on the voice line: this one decides whether the agent
  // listens to a person at all.
  test("the voices row appears only when the gate is on, and warns when it is empty", () => {
    expect(bootReport(facts()).find((entry) => entry.label === "voices")).toBeUndefined()
    expect(row(bootReport(facts({ enrolled: ["Maximus", "Ada"] })), "voices").value).toBe("Maximus, Ada")
    // A gate with nobody behind it refuses everything, which is worth saying in colour.
    expect(row(bootReport(facts({ enrolled: [] })), "voices").tone).toBe("warn")
  })

  test("the last-session row appears only when there was one", () => {
    const now = Date.parse("2026-09-08T12:00:00Z")
    expect(bootReport(facts({ now })).find((entry) => entry.label === "last")).toBeUndefined()
    const report = bootReport(
      facts({ now, previous: { id: "s1", cwd: "/w", created: now - 7_200_000, title: "wire the DHT22" } }),
    )
    expect(row(report, "last").value).toBe("wire the DHT22 · 2h ago")
  })
})
