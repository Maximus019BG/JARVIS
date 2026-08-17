import { checkDoc, formatReport } from "@blueprint/check.ts";
import { diffDocs, summarise } from "@blueprint/diff.ts";
import { applyOps, OpSchema } from "@blueprint/ops.ts";
import { renderBraille } from "@blueprint/render-braille.ts";
import { toSvg } from "@blueprint/render-svg.ts";
import { BlueprintDocSchema, serialize, type BlueprintDoc } from "@blueprint/schema.ts";
import { searchSymbols } from "@blueprint/symbols/index.ts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "~/server/db";
import { blueprint } from "~/server/db/schemas/blueprint";
import { blueprintVersion } from "~/server/db/schemas/blueprint_version";
import { appendBlueprintVersion } from "~/server/blueprint-write";
import { readableBlueprintIds } from "~/server/device-auth";
import { toolError } from "~/server/mcp/result";
import { requireBlueprintAccess } from "~/server/mcp/tools/shared";
import type { McpModule } from "~/server/mcp/types";
import { tool } from "~/server/mcp/types";

/**
 * Blueprints over MCP.
 *
 * Every tool here delegates to the shared engine in `../../../../tui/src/blueprint` — the
 * same `applyOps`, `checkDoc` and renderers the TUI uses. That is the whole reason these are
 * a few lines each, and the reason an agent editing through MCP cannot produce a document
 * the TUI would reject.
 */

const blueprintId = z.string().min(1).describe("Blueprint id, from blueprint_list.");

/**
 * Two blueprint formats exist in this database.
 *
 * The one these tools speak is `BlueprintDoc` — `schema: 1`, layers and entities — which is
 * what a device pushes and what the shared engine's ops, checks and renderers understand.
 * The other is the older shape the web editor writes (`created_timestamp`, `grid`, `lines`),
 * which predates it and carries no entity ids at all.
 *
 * A legacy row is not a corrupt row, and saying so is the difference between an agent
 * telling the user something true and an agent giving up.
 */
const LEGACY_HINT =
  "It is in the older web-editor format (created_timestamp/grid/lines), not the versioned document format these tools operate on. Open it in the TUI and push it, or edit it in the web editor instead.";

const parseOrExplain = (json: string, what: string): BlueprintDoc => {
  const parsed = BlueprintDocSchema.safeParse(JSON.parse(json));
  if (parsed.success) return parsed.data;
  toolError(`${what} cannot be read as a blueprint document. ${LEGACY_HINT}`);
};
const ref = z
  .string()
  .min(1)
  .describe("A version: `v3`, or a git commit sha. Omit for the current one.");

/** Loads one version, or the current document when no ref is given. */
async function loadDoc(id: string, at?: string): Promise<{ doc: BlueprintDoc; version: number | null }> {
  if (!at) {
    const row = (
      await db
        .select({ metadata: blueprint.metadata, version: blueprint.version })
        .from(blueprint)
        .where(eq(blueprint.id, id))
        .limit(1)
    )[0];
    if (!row?.metadata) toolError("That blueprint has no saved content yet.");
    return { doc: parseOrExplain(row.metadata, "This blueprint"), version: row.version };
  }

  const version = /^v\d+$/.test(at) ? Number(at.slice(1)) : undefined;
  const row = (
    await db
      .select()
      .from(blueprintVersion)
      .where(
        and(
          eq(blueprintVersion.blueprintId, id),
          version === undefined
            ? eq(blueprintVersion.commitSha, at)
            : eq(blueprintVersion.version, version),
        ),
      )
      .limit(1)
  )[0];
  if (!row) toolError(`No version ${at} of that blueprint.`);

  return { doc: parseOrExplain(row.metadata, `Version ${at}`), version: row.version };
}

export const blueprintsModule: McpModule = {
  area: "blueprints",
  tools: [
    tool({
      name: "blueprint_list",
      title: "List blueprints",
      description:
        "Blueprints this token may read. Narrower than the workstation's full set when the token was granted only specific ones.",
      scope: "blueprints:read",
      input: z.object({}),
      handler: async (_args, ctx) => {
        const readable = await readableBlueprintIds(ctx.deviceId);
        if (readable !== "all" && readable.size === 0) return [];

        const rows = await db
          .select({
            id: blueprint.id,
            name: blueprint.name,
            version: blueprint.version,
            updatedAt: blueprint.updatedAt,
            syncStatus: blueprint.syncStatus,
          })
          .from(blueprint)
          .where(
            readable === "all"
              ? eq(blueprint.workstationId, ctx.workstationId)
              : and(
                  eq(blueprint.workstationId, ctx.workstationId),
                  inArray(blueprint.id, [...readable]),
                ),
          );
        return rows;
      },
    }),

    tool({
      name: "blueprint_get",
      title: "Get a blueprint document",
      description:
        "The full document as JSON: layers, entities, viewBox, units. This is the shape blueprint_edit operates on — read it before editing so you know the entity ids.",
      scope: "blueprints:read",
      input: z.object({ blueprintId, at: ref.optional() }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "read");
        const { doc, version } = await loadDoc(args.blueprintId, args.at);
        return { version, doc };
      },
    }),

    tool({
      name: "blueprint_view",
      title: "Render a blueprint",
      description:
        "Renders the drawing. `braille` is compact text you can read directly — use it to check a change looks right. `svg` is for handing to a human.",
      scope: "blueprints:read",
      input: z.object({
        blueprintId,
        at: ref.optional(),
        format: z.enum(["braille", "svg"]).default("braille"),
        layers: z.array(z.string()).optional().describe("Only these layer ids. Omit for all visible."),
        cols: z.number().int().min(20).max(200).default(80).describe("braille only"),
        rows: z.number().int().min(5).max(80).default(24).describe("braille only"),
      }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "read");
        const { doc } = await loadDoc(args.blueprintId, args.at);

        if (args.format === "svg") return toSvg(doc, { layers: args.layers });
        return renderBraille(doc, {
          cols: args.cols,
          rows: args.rows,
          layers: args.layers,
          frame: true,
        }).join("\n");
      },
    }),

    tool({
      name: "blueprint_versions",
      title: "List blueprint versions",
      description: "History, newest first. Version numbers are what blueprint_diff and blueprint_restore take.",
      scope: "blueprints:read",
      input: z.object({ blueprintId, limit: z.number().int().min(1).max(100).default(30) }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "read");
        return db
          .select({
            version: blueprintVersion.version,
            commitSha: blueprintVersion.commitSha,
            message: blueprintVersion.message,
            createdAt: blueprintVersion.createdAt,
          })
          .from(blueprintVersion)
          .where(eq(blueprintVersion.blueprintId, args.blueprintId))
          .orderBy(desc(blueprintVersion.version))
          .limit(args.limit);
      },
    }),

    tool({
      name: "blueprint_diff",
      title: "Diff two versions",
      description:
        "Entity-level differences between two versions, computed with the same comparison the sync merge uses — so what this calls changed is what a merge would treat as changed.",
      scope: "blueprints:read",
      input: z.object({ blueprintId, a: ref, b: ref }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "read");
        const [before, after] = await Promise.all([
          loadDoc(args.blueprintId, args.a),
          loadDoc(args.blueprintId, args.b),
        ]);
        const diff = diffDocs(before.doc, after.doc);
        return {
          summary: summarise(diff),
          counts: diff.counts,
          changes: diff.entities
            .filter((change) => change.kind !== "unchanged")
            .map((change) => ({ kind: change.kind, id: change.id })),
        };
      },
    }),

    tool({
      name: "blueprint_check",
      title: "Check a blueprint against design rules",
      description:
        "Runs the engineering checks: IEC 60364 cable sizing and voltage drop for `electrical`, EN door widths and stair geometry for `building`, power budgets and pin clashes for `iot`. Use after an edit — geometry that draws fine can still be wrong.",
      scope: "blueprints:read",
      input: z.object({
        blueprintId,
        at: ref.optional(),
        domain: z.enum(["general", "building", "electrical", "iot"]).default("general"),
      }),
      handler: async (args, ctx) => {
        const found = await requireBlueprintAccess(ctx, args.blueprintId, "read");
        const { doc } = await loadDoc(args.blueprintId, args.at);
        return formatReport(found.name, args.domain, checkDoc(doc, args.domain));
      },
    }),

    tool({
      name: "blueprint_symbols",
      title: "Search the symbol library",
      description:
        "Standard symbols — electrical, building, IoT — you can place with blueprint_edit. Search before inventing geometry by hand.",
      scope: "blueprints:read",
      input: z.object({
        query: z.string().optional(),
        domain: z.enum(["electrical", "building", "iot"]).optional(),
      }),
      handler: async (args) =>
        searchSymbols({ domain: args.domain, query: args.query }).map((entry) => ({
          name: entry.name,
          describe: entry.symbol.describe,
          standard: entry.symbol.standard,
        })),
    }),

    tool({
      name: "blueprint_edit",
      title: "Edit a blueprint",
      description:
        "Applies operations and saves the result as a new version. Ops are applied in order and all-or-nothing: an unknown entity or layer id fails the whole edit rather than half-applying it. Read the document with blueprint_get first — ids are not guessable.",
      scope: "blueprints:write",
      input: z.object({
        blueprintId,
        ops: z.array(OpSchema).min(1),
        message: z.string().max(500).optional().describe("History entry. Defaults to a tally of the ops."),
      }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "write");
        const { doc } = await loadDoc(args.blueprintId);

        // `applyOps` never mutates its input and throws on a bad id, so a failure here
        // leaves the stored document exactly as it was.
        const { doc: next, summary } = applyOps(doc, args.ops);

        const { version } = await appendBlueprintVersion({
          blueprintId: args.blueprintId,
          metadata: serialize(next),
          message: args.message ?? summary,
          action: "edit",
          userId: ctx.userId,
          deviceId: ctx.deviceId,
        });

        return { version, summary };
      },
    }),

    tool({
      name: "blueprint_restore",
      title: "Restore an old version",
      description:
        "Appends a new version identical to an old one. Nothing is rewritten — the restore itself appears on the timeline, and paired devices reconcile on their next sync.",
      scope: "blueprints:write",
      input: z.object({ blueprintId, at: ref }),
      handler: async (args, ctx) => {
        await requireBlueprintAccess(ctx, args.blueprintId, "write");
        const source = await loadDoc(args.blueprintId, args.at);
        const current = await loadDoc(args.blueprintId);
        if (source.version === current.version) {
          toolError(`Version ${args.at} is already the current one.`);
        }

        const { version } = await appendBlueprintVersion({
          blueprintId: args.blueprintId,
          metadata: serialize(source.doc),
          message: `restore v${source.version}`,
          action: "restore",
          userId: ctx.userId,
          deviceId: ctx.deviceId,
        });

        return { version, restoredFrom: source.version };
      },
    }),
  ],
};
