import { tool } from "ai"
import { z } from "zod"
import { ToolError, type ToolContext } from "../tools/context.ts"
import { apply, compose, rotate, scale, transform, translate, type Mat } from "./geom.ts"
import { applyOps, type Op } from "./ops.ts"
import { serialize, type Entity, type Pt } from "./schema.ts"
import { readDoc, safeName, writeDoc } from "./store.ts"
import { DOMAINS, findSymbol, searchSymbols, type SymbolDomain } from "./symbols/index.ts"

/**
 * Places symbols from the libraries. Everything here is composition of things that
 * already exist — `geom.transform` moves the entities, `applyOps` adds them, `writeDoc`
 * commits — so a symbol is data and this is the only code that knows it is a symbol.
 *
 * The reason it is a tool rather than op-JSON in a skill: there are 400-odd symbols, and
 * a model cannot hold their geometry. `list` is how it finds one without reading a
 * library file.
 */

/**
 * Ids get a per-placement prefix so a symbol's parts move as a unit later. `e` is
 * excluded deliberately: `seqOf` parses `^e(\d+)` to find the next free id, so a symbol
 * called `e5-a` would poison the counter and the next `add` would collide.
 */
function prefixFor(label: string | undefined, symbol: string, index: number): string {
  const base = (label ?? symbol.replace(/^[a-z]+\//, "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const safe = base.replace(/^e(?=\d)/, "x") || "sym"
  return `${safe}-${index}`
}

const point = z.tuple([z.number(), z.number()])

const placement = z.object({
  symbol: z.string().describe('Symbol name, e.g. "resistor" or "electrical/resistor" when the bare name is ambiguous'),
  at: point.describe("Where to put the symbol's origin, as [x, y]"),
  rotate: z.number().optional().describe("Degrees clockwise about `at`, because Y points down"),
  scale: z.number().positive().optional().describe("Uniform scale about `at`; 1 is the library size"),
  layer: z.string().optional().describe("Layer id for every entity of this symbol"),
  label: z.string().optional().describe('Reference to draw beside it and to build ids from, e.g. "R1" or "D3"'),
  labelOffset: point.optional().describe("Where the label sits relative to `at`; defaults to just above"),
})

/**
 * Every placement field as a flat, top-level, optional field. Some providers' models
 * flatten the `placements` array into a single object; accepting both shapes means a
 * structurally sloppy call still places one symbol instead of dying at validation.
 */
const flat = z.object({
  symbol: placement.shape.symbol.optional(),
  at: placement.shape.at.optional(),
  rotate: placement.shape.rotate.optional(),
  scale: placement.shape.scale.optional(),
  layer: placement.shape.layer.optional(),
  label: placement.shape.label.optional(),
  labelOffset: placement.shape.labelOffset.optional(),
})

export const blueprintSymbolTool = (ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Place standard symbols on a blueprint: IEC 60617 electrical, architectural plan symbols, and IoT wiring blocks.",
      'Call it with action:"list" and a query first to find the name you want, then action:"place".',
      'Placing needs the blueprint to exist — call `blueprint` action:"create" before the first placement.',
      "Placing returns each symbol's connection points already transformed, so wire them up with `blueprint_edit`",
      "using those coordinates rather than working out the trigonometry.",
      "Batch every symbol of one figure into a single place call: pass `placements` as an array of {symbol, at}.",
      "A single symbol may instead be given flattened, e.g. symbol:\"resistor\", at:[10,10], label:\"R1\" — accepted so a model that cannot nest the array still works.",
    ].join(" "),
    inputSchema: z.object({
      action: z.enum(["list", "place"]),
      name: z.string().optional().describe("Blueprint to draw on. Required for place"),
      domain: z.enum(DOMAINS).optional().describe("Restrict a list to one library"),
      query: z.string().optional().describe("Free text for list; every word must match"),
      placements: z.array(placement).min(1).optional().describe("Symbols to place, one entry per symbol. Preferred form"),
      ...flat.shape,
      message: z.string().optional().describe("Commit message"),
    }),
    execute: async ({
      action,
      name,
      domain,
      query,
      placements,
      message,
      symbol: flatSymbol,
      at: flatAt,
      rotate: flatRotate,
      scale: flatScale,
      layer: flatLayer,
      label: flatLabel,
      labelOffset: flatLabelOffset,
    }) => {
      if (action === "list") {
        const found = searchSymbols({ domain: domain as SymbolDomain | undefined, query })
        if (found.length === 0) return `no symbols match${query ? ` "${query}"` : ""}`
        const pad = Math.max(...found.map((entry) => entry.name.length))
        const lines = found.map(({ name: symbolName, symbol }) => {
          const ports = symbol.ports?.length ?? 0
          const cite = symbol.standard ? ` [${symbol.standard}]` : ""
          return `${symbolName.padEnd(pad)}  ${ports} port${ports === 1 ? "" : "s"}  ${symbol.describe}${cite}`
        })
        return [`${found.length} symbols`, ...lines].join("\n")
      }

      if (!name) throw new ToolError("place needs a blueprint name")
      // Models on some providers flatten the placements array into top-level fields. Normalize
      // that form into a single placement so a structurally sloppy call still does something.
      const effective = placements ??
        (flatSymbol !== undefined && flatAt !== undefined
          ? [
              {
                symbol: flatSymbol,
                at: flatAt,
                ...(flatRotate !== undefined && { rotate: flatRotate }),
                ...(flatScale !== undefined && { scale: flatScale }),
                ...(flatLayer !== undefined && { layer: flatLayer }),
                ...(flatLabel !== undefined && { label: flatLabel }),
                ...(flatLabelOffset !== undefined && { labelOffset: flatLabelOffset }),
              },
            ]
          : undefined)
      if (!effective) throw new ToolError("place needs at least one placement — pass `placements` or a flat `symbol` with `at`")

      const safe = safeName(name)
      const doc = readDoc(root, safe)

      const ops: Op[] = []
      const report: string[] = []
      effective.forEach((entry, index) => {
        const found = findSymbol(entry.symbol)
        if (!found) {
          throw new ToolError(`no such symbol: ${entry.symbol} — use action:"list" with a query to find one`)
        }
        const { symbol } = found
        // Scale, then rotate, then translate: `compose(a, b)` applies b first, so the
        // symbol is shaped and turned about its own origin before it is moved into place.
        const matrix: Mat = compose(
          translate(entry.at[0], entry.at[1]),
          compose(rotate(entry.rotate ?? 0), scale(entry.scale ?? 1, entry.scale ?? 1)),
        )
        const prefix = prefixFor(entry.label, entry.symbol, index + 1)
        symbol.entities.forEach((source, i) => {
          const placed = transform(source, matrix) as Entity
          ops.push({
            op: "add",
            entity: { ...placed, id: `${prefix}-${i}`, ...(entry.layer ? { layer: entry.layer } : {}) },
          })
        })
        if (entry.label) {
          const [dx, dy] = entry.labelOffset ?? [0, -6 * (entry.scale ?? 1)]
          ops.push({
            op: "add",
            entity: {
              type: "text",
              at: [entry.at[0] + dx, entry.at[1] + dy],
              text: entry.label,
              size: 2.5 * (entry.scale ?? 1),
              id: `${prefix}-label`,
              ...(entry.layer ? { layer: entry.layer } : {}),
            },
          })
        }
        const ports: Pt[] = (symbol.ports ?? []).map((port) => apply(matrix, port))
        const round = (n: number) => Math.round(n * 100) / 100
        report.push(
          `${entry.label ? `${entry.label} ` : ""}${entry.symbol} at [${entry.at.join(", ")}]${entry.rotate ? ` rot ${entry.rotate}°` : ""} → ids ${prefix}-*` +
            (ports.length > 0 ? `\n  ports: ${ports.map((p, i) => `${i + 1}:[${round(p[0])}, ${round(p[1])}]`).join("  ")}` : ""),
        )
      })

      // Apply before asking, exactly as `blueprint_edit` does: a placement that will not
      // apply should never reach the permission prompt, let alone the disk.
      const { doc: next, summary } = applyOps(doc, ops)
      const what = `place ${effective.length} symbol${effective.length === 1 ? "" : "s"}`

      await ctx.gate.check({
        tool: "blueprint_symbol",
        title: `${what} on ${safe}`,
        detail: serialize(next),
        subject: safe,
      })

      const sha = writeDoc(root, safe, next, message ?? `${what}: ${summary}`)
      return [`${safe} ${sha} — ${what}`, "", ...report].join("\n")
    },
  })
