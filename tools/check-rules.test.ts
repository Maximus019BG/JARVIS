import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { docFor, envDrift, expandBraces, parseModuleIndex, pathTokens, SKIP_MARKER, untouchedDocs } from "./check-rules.ts"

const rows = parseModuleIndex(readFileSync(join(import.meta.dir, "../docs/modules/README.md"), "utf8"))

test("expandBraces expands every group", () => {
  expect(expandBraces("a/{b,c}/{d,e}.ts")).toEqual(["a/b/d.ts", "a/b/e.ts", "a/c/d.ts", "a/c/e.ts"])
  expect(expandBraces("plain/")).toEqual(["plain/"])
})

test("docFor picks the most specific row, so the index's 'except' notes hold", () => {
  const doc = (file: string) => docFor(rows, file)
  expect(doc("tui/src/ui/app.tsx")).toBe("docs/modules/tui/ui/README.md")
  expect(doc("tui/src/ui/voice.ts")).toBe("docs/modules/tui/voice/README.md")
  expect(doc("tui/src/cli/voice.ts")).toBe("docs/modules/tui/voice/README.md")
  expect(doc("tui/src/cli/work.ts")).toBe("docs/modules/tui/cli/README.md")
  expect(doc("tui/src/permission.ts")).toBe("docs/modules/tui/tools/README.md")
  expect(doc("web/src/app/api/device/list/route.ts")).toBe("docs/modules/web/devices-and-pairing/README.md")
  expect(doc("web/src/app/api/device/hand/route.ts")).toBe("docs/modules/web/vision/README.md")
  expect(doc("web/src/app/api/workstation/automation/list/x/route.ts")).toBe("docs/modules/web/automations/README.md")
  expect(doc("web/drizzle/0000_init.sql")).toBe("docs/modules/web/database/README.md")
  expect(doc("web/src/app/layout.tsx")).toBe("docs/modules/web/frontend-shell/README.md")
  expect(doc("web/src/components/foo.tsx")).toBe("docs/modules/web/frontend-shell/README.md")
  expect(doc("tui/test/edit.test.ts")).toBeUndefined()
})

test("untouchedDocs flags code changed without its doc, and accepts any file in the doc's folder", () => {
  expect([...untouchedDocs(rows, ["tui/src/tools/edit.ts"]).keys()]).toEqual(["docs/modules/tui/tools/README.md"])
  expect(untouchedDocs(rows, ["tui/src/tools/edit.ts", "docs/modules/tui/tools/README.md"]).size).toBe(0)
  expect(untouchedDocs(rows, ["README.md", "tui/test/x.test.ts"]).size).toBe(0)
})

test("envDrift compares runtimeEnv against .env.example, commented keys included", () => {
  const envJs = "runtimeEnv: {\n  A: process.env.A,\n  B:\n    process.env.B,\n  C: process.env.C,\n}"
  const example = 'A=1\n# C="x"\nD=2\n'
  expect(envDrift(envJs, example)).toEqual({ notInExample: ["B"], notInEnvJs: ["D"] })
})

test("pathTokens keeps repo paths and drops globs, line numbers and placeholders", () => {
  const md = "`tui/src/a.ts:12-14` `web/src/b.ts` `app/api/x` `tui/src/{a,b}.ts` `web/src/<id>/` `k8s/base/`"
  expect(pathTokens(md)).toEqual(["tui/src/a.ts", "web/src/b.ts", "k8s/base"])
})

test("SKIP_MARKER catches focused and skipped tests only", () => {
  expect(SKIP_MARKER.test('test.only("x", () => {})')).toBe(true)
  expect(SKIP_MARKER.test('describe.skip("x", () => {})')).toBe(true)
  expect(SKIP_MARKER.test('it.todo("x")')).toBe(true)
  expect(SKIP_MARKER.test('test("only works", () => {})')).toBe(false)
})
