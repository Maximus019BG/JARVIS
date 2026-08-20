import { tool } from "ai"
import { z } from "zod"
import type { ToolContext } from "../tools/context.ts"
import { checkDoc, formatReport } from "./check.ts"
import { applyOps, OpSchema } from "./ops.ts"
import { blueprintSymbolTool } from "./symbol-tool.ts"
import { autoView, renderBraille } from "./render-braille.ts"
import { toSvg } from "./render-svg.ts"
import { DEFAULT_VIEW_BOX, emptyDoc, serialize, UNITS, type BlueprintDoc } from "./schema.ts"
import { pull, push, status } from "./sync.ts"
import {
  blueprintRoot,
  deleteDoc,
  docAt,
  ensureRepo,
  exists,
  history,
  listBlueprints,
  readDoc,
  readOrCreate,
  safeName,
  writeDoc,
} from "./store.ts"

/** Preview size for the render handed back to the model after every edit. */
const PREVIEW = { cols: 76, rows: 22 }

const viewBox = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe("Sheet bounds as [minX, minY, width, height], like an SVG viewBox")

const view = viewBox.optional().describe("Region to show; omitted fits the drawing")

function preview(doc: BlueprintDoc, options: { view?: [number, number, number, number]; layers?: string[] } = {}): string {
  const lines = renderBraille(doc, { ...PREVIEW, view: options.view, layers: options.layers })
  const [vx, vy, vw, vh] = options.view ?? autoView(doc, options.layers)
  const round = (n: number) => Math.round(n * 100) / 100
  return [
    ...lines,
    "",
    `view [${round(vx)}, ${round(vy)}, ${round(vw)}, ${round(vh)}] ${doc.units} · ${doc.entities.length} entities`,
  ].join("\n")
}

const idList = (doc: BlueprintDoc) =>
  doc.entities.map((entity) => `  ${entity.id}  ${entity.type.padEnd(9)} ${entity.layer}`).join("\n")

export const blueprintTool = (ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Manage blueprint files: list them, create one, inspect one, or read its version history.",
      "Blueprints are 2D technical drawings stored as versioned JSON; every edit is committed to git automatically.",
      "Use `blueprint_edit` to draw and `blueprint_view` to look.",
    ].join(" "),
    inputSchema: z.object({
      action: z.enum(["list", "create", "info", "history", "delete"]),
      name: z.string().optional().describe("Blueprint name: lowercase letters, digits and hyphens"),
      units: z.enum(UNITS).optional().describe("Only for create; defaults to mm"),
      viewBox: viewBox.optional().describe("Only for create; defaults to A4 landscape [0, 0, 297, 210]"),
    }),
    execute: async ({ action, name, units, viewBox: box }) => {
      if (action === "list") {
        const found = listBlueprints(root)
        if (found.length === 0) return "no blueprints yet — create one with action: \"create\""
        return found
          .map(
            (item) =>
              `${item.name}  ${item.entities} entities, ${item.layers} layers` +
              (item.head ? `  ${item.head} ${item.updated}${item.message ? ` — ${item.message}` : ""}` : ""),
          )
          .join("\n")
      }

      if (!name) throw new Error(`action "${action}" needs a name`)
      const safe = safeName(name)

      if (action === "create") {
        await ctx.gate.check({
          tool: "blueprint",
          title: `create blueprint ${safe}`,
          detail: `${root}/${safe}.blueprint.json`,
          subject: safe,
        })
        ensureRepo(root)
        if (exists(root, safe)) throw new Error(`blueprint "${safe}" already exists`)
        const doc = emptyDoc(safe, box ?? DEFAULT_VIEW_BOX, units ?? "mm")
        const sha = writeDoc(root, safe, doc, "create")
        return `created ${safe} (${doc.units}, sheet ${doc.viewBox.join(" ")}) at ${sha}`
      }

      if (action === "delete") {
        await ctx.gate.check({
          tool: "blueprint",
          title: `delete blueprint ${safe}`,
          detail: `${root}/${safe}.blueprint.json`,
          subject: safe,
        })
        deleteDoc(root, safe)
        return `deleted ${safe}`
      }

      if (action === "history") {
        const commits = history(root, safe)
        if (commits.length === 0) return `${safe} has no history yet`
        return commits.map((commit) => `${commit.sha}  ${commit.relative.padEnd(16)}  ${commit.message}`).join("\n")
      }

      const doc = readDoc(root, safe)
      const layers = doc.layers
        .map((layer) => {
          const count = doc.entities.filter((entity) => entity.layer === layer.id).length
          return `  ${layer.id}  ${layer.name} (${count})${layer.visible === false ? " hidden" : ""}`
        })
        .join("\n")
      return [
        `${safe} — ${doc.entities.length} entities, ${doc.units}, sheet ${doc.viewBox.join(" ")}`,
        "layers:",
        layers,
        doc.entities.length > 0 ? "entities:" : "",
        idList(doc),
      ]
        .filter(Boolean)
        .join("\n")
    },
  })

export const blueprintEditTool = (ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Draw on a blueprint by applying a list of operations, then commit them to git.",
      'A blueprint that does not exist yet is created by the first edit; `blueprint` action:"create" is only needed to set non-default units or sheet size.',
      "Coordinates are in the drawing's units with Y pointing DOWN, like SVG.",
      "Entity ids are assigned automatically on `add` — read them back from the preview or `blueprint` action:\"info\".",
      // The three ops that exist so nobody has to do trigonometry. Stated as the method
      // rather than as an option, because a model given the choice draws wires by hand.
      'For anything made of standard parts use op:"place" to drop a symbol roughly where it belongs with a `label`,',
      'then op:"connect" with from:"R1.2" and to:"U1.5" to wire two ports — the route is found for you, around the',
      'other parts. Do NOT work out wire coordinates yourself. op:"arrange" snaps parts to the grid and separates',
      "any that overlap, so rough placement is enough.",
      "Returns a braille rendering of the result, so check it and fix what looks wrong.",
      "Batch a whole figure into one call rather than one op per call.",
    ].join(" "),
    inputSchema: z.object({
      name: z.string().describe("Blueprint to edit"),
      ops: z.array(OpSchema).min(1).describe("Operations, applied in order"),
      message: z.string().optional().describe("Commit message; a summary of the ops is used if omitted"),
      view: view,
    }),
    execute: async ({ name, ops, message, view: region }) => {
      const safe = safeName(name)
      const doc = readOrCreate(root, safe)
      // Apply first: an op set that will not apply should never reach the permission
      // prompt, let alone the disk.
      const { doc: next, summary, warnings } = applyOps(doc, ops)

      await ctx.gate.check({
        tool: "blueprint_edit",
        title: `edit blueprint ${safe} — ${summary}`,
        detail: serialize(next),
        subject: safe,
      })

      const sha = writeDoc(root, safe, next, message ?? summary)
      // Warnings first: a wire that had to cross a part is the one thing in the result the
      // model must act on, and the preview below is 22 rows tall.
      const notes = warnings.map((warning) => `warning: ${warning}`).join("\n")
      return `${safe} ${sha} — ${summary}\n${notes ? `${notes}\n` : ""}\n${preview(next, { view: region })}`
    },
  })

export const blueprintViewTool = (ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Render a blueprint: `braille` to look at it, `svg` to export it, `json` to read the exact entity data.",
      "Pass `at` with a commit sha from `blueprint` action:\"history\" to see an older version.",
    ].join(" "),
    inputSchema: z.object({
      name: z.string(),
      format: z.enum(["braille", "svg", "json"]).default("braille"),
      view: view,
      layers: z.array(z.string()).optional().describe("Only these layer ids; omitted shows every visible layer"),
      at: z.string().optional().describe("Commit sha to read instead of the working copy"),
    }),
    execute: async ({ name, format, view: region, layers, at }) => {
      const safe = safeName(name)
      const doc = at ? docAt(root, safe, at) : readDoc(root, safe)
      if (format === "json") return serialize(doc)
      if (format === "svg") return toSvg(doc, { layers })
      return preview(doc, { view: region, layers })
    },
  })

export const blueprintSyncTool = (ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Sync a blueprint with the cloud so its history shows up on the web.",
      "`push` sends local commits, `pull` brings down newer ones, `status` compares without changing anything.",
      "If the two histories have diverged, push merges them and reports any conflicts — it never discards work.",
      "Requires the device to be paired: run `jarvis pair` in a terminal first.",
    ].join(" "),
    inputSchema: z.object({
      action: z.enum(["push", "pull", "status"]),
      name: z.string().describe("Blueprint to sync"),
    }),
    execute: async ({ action, name }) => {
      const safe = safeName(name)

      if (action === "status") {
        const state = await status(root, safe)
        if (!state.paired) return "not paired — run `jarvis pair` to connect this device"
        return [
          `paired to ${state.baseUrl} as ${state.deviceId}`,
          `local   ${state.localHead ?? "—"} (${state.localCommits} commits)`,
          `server  ${state.serverHead ?? "—"}${state.serverVersion ? ` (v${state.serverVersion})` : ""}`,
          state.error ? `error   ${state.error}` : "",
          state.localHead && state.serverHead === state.localHead ? "in sync" : "",
        ]
          .filter(Boolean)
          .join("\n")
      }

      await ctx.gate.check({
        tool: "blueprint_sync",
        title: `${action} blueprint ${safe}`,
        detail: `${action} ${safe} ${action === "push" ? "to" : "from"} the jarvis cloud`,
        subject: safe,
      })

      if (action === "pull") {
        const result = await pull(root, safe)
        if (result.status === "up-to-date") return `${safe} is already up to date`
        if (result.status === "fast-forward") return `${safe} updated to server v${result.version} (${result.head})`
        return [
          `${safe} merged with the server at ${result.head}`,
          ...result.renamed.map((entry) => `renamed ${entry}`),
          ...result.conflicts.map((note) => `conflict: ${note}`),
        ].join("\n")
      }

      const result = await push(root, safe)
      if (result.status === "up-to-date") return `${safe} is already pushed (server head ${result.head ?? "—"})`
      if (result.status === "pushed") {
        return `pushed ${result.applied} commit(s) of ${safe}, server now at v${result.version} (${result.head})`
      }
      return [
        `${safe} had diverged — merged and pushed ${result.applied} commit(s), server head ${result.head}`,
        ...result.renamed.map((entry) => `renamed ${entry}`),
        ...result.conflicts.map((note) => `conflict: ${note}`),
        result.conflicts.length > 0 ? "Look at the merged drawing and delete whichever version is wrong." : "",
      ]
        .filter(Boolean)
        .join("\n")
    },
  })

/** All four, keyed by tool name, ready to spread into the tool set. */
export const blueprintCheckTool = (_ctx: ToolContext, root: string) =>
  tool({
    description: [
      "Review a blueprint against domain rules and report what is wrong: geometry problems in any drawing,",
      "and — where entities carry `REF | key=value` annotations on conventionally named layers —",
      "cable sizing and voltage drop against IEC 60364, door widths and stair geometry against EN,",
      "and power budgets, bus voltages and pin clashes for IoT wiring.",
      "Anything it cannot read is listed as NOT CHECKED rather than passed. Run it before calling a drawing finished.",
    ].join(" "),
    inputSchema: z.object({
      name: z.string().describe("Blueprint to check"),
      domain: z
        .enum(["general", "building", "electrical", "iot"])
        .default("general")
        .describe("Which rule set to apply on top of the geometry checks"),
    }),
    execute: async ({ name, domain }) => {
      const safe = safeName(name)
      const doc = readDoc(root, safe)
      return formatReport(safe, domain, checkDoc(doc, domain))
    },
  })

export function blueprintTools(ctx: ToolContext, root: string) {
  return {
    blueprint: blueprintTool(ctx, root),
    blueprint_edit: blueprintEditTool(ctx, root),
    blueprint_view: blueprintViewTool(ctx, root),
    blueprint_symbol: blueprintSymbolTool(ctx, root),
    blueprint_check: blueprintCheckTool(ctx, root),
    blueprint_sync: blueprintSyncTool(ctx, root),
  }
}
