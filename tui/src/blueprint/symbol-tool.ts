import { tool } from "ai"
import { z } from "zod"
import { ToolError, type ToolContext } from "../tools/context.ts"
import { applyOps, type Op } from "./ops.ts"
import { serialize } from "./schema.ts"
import { readOrCreate, safeName, writeDoc } from "./store.ts"
import { DOMAINS, searchSymbols, type SymbolDomain } from "./symbols/index.ts"

/**
 * Places symbols from the libraries. The placement itself is one `place` op per symbol —
 * `place.ts` does the geometry, `applyOps` records the part, `writeDoc` commits — so this
 * file knows about permissions and the filesystem and nothing else.
 *
 * The reason it is a tool rather than op-JSON in a skill: there are 400-odd symbols, and
 * a model cannot hold their geometry. `list` is how it finds one without reading a
 * library file.
 */

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
      "Placing creates the blueprint if it does not exist yet.",
      "Put symbols roughly where they belong and give each a `label` — schematic parts are snapped to the",
      "2.54 mm grid and pushed apart if they overlap. Do NOT work out wire coordinates: connect them with",
      '`blueprint_edit` using op:"connect" with from:"R1.2", to:"U1.5", and the route is worked out for you.',
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
      const doc = readOrCreate(root, safe)

      const ops: Op[] = effective.map((entry) => ({ op: "place" as const, ...entry }))

      // Apply before asking, exactly as `blueprint_edit` does: a placement that will not
      // apply should never reach the permission prompt, let alone the disk.
      const { doc: next, summary } = applyOps(doc, ops)
      const what = `place ${effective.length} symbol${effective.length === 1 ? "" : "s"}`

      // Report the parts by ref and port count, not by coordinate. The whole point of
      // recording ports is that nobody has to copy them back out — `connect` takes the
      // names printed here.
      const placed = next.parts.slice(next.parts.length - effective.length)
      const report = placed.map(
        (part) =>
          `${part.ref}  ${part.symbol} at [${part.at.map((n) => Math.round(n * 100) / 100).join(", ")}]` +
          (part.ports.length > 0
            ? `  — connect with ${part.ref}.1..${part.ref}.${part.ports.length}`
            : "  — no connection points"),
      )

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
