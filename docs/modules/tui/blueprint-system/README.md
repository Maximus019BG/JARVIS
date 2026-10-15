# Blueprint system

Code: `tui/src/blueprint/` · Verified: 2026-10-14 @ c9135de

## Purpose
The engine behind 2D technical drawings ("blueprints"): the document format, every edit
operation, symbol libraries, wire routing, rendering (braille and SVG), domain checks, a
git-backed local store and sync with the web app. The agent tools, the terminal editor, the
Pi hand-drawing loop and the web app all drive the same code. Usage is in
[`tui/README.md`](../../../../tui/README.md#blueprints).

Topic pages:

- [Data model](data-model.md): document shape, entities, ids, parts, pins, nets, serialization.
- [Editing](editing.md): ops, placing symbols, auto-wiring, routing, labels, merge, fit, check, pick, the agent tools.
- [Rendering](rendering.md): geometry, braille, SVG, diff, the tool model.
- [Sync and history](sync-and-history.md): git store, cloud push and pull, credentials, versions.

## How it works

1. **A document is JSON.** `schema.ts` → `BlueprintDocSchema` defines it. `parseDoc` reads it
   and backfills ids and layers. `serialize` is the only writer, with fixed key order and
   numbers rounded to 4 decimals so the same drawing always gives the same bytes (and the
   same git diff).
2. **Every change is an op.** `ops.ts` → `applyOps(doc, ops)` returns a new document and never
   mutates its input. It runs the literal ops (`runOps`), then four derived passes in order:
   `route.ts` → `rerouteOps`, `autowire.ts` → `autowireOps`, `route.ts` → `junctionOps`,
   `labels.ts` → `placeLabelOps`. That is why callers never give wire coordinates: wires,
   junction dots and label positions are recomputed from the parts after every edit.
3. **Symbols are data.** `symbols/index.ts` → `findSymbol` looks up about 400 symbols in three
   libraries. A `place` op calls `place.ts` → `placeSymbol`, which turns them into ordinary
   `add` ops plus a `parts` record holding the transformed ports, pin names and pin directions.
4. **Storage is a git repo.** `store.ts` → `writeDoc` writes `<name>.blueprint.json` and commits
   it. History, `docAt` and diffs read git.
5. **Sync mirrors git to the web.** `sync.ts` → `push` and `pull` talk to `/api/blueprint/push` and
   `/api/blueprint/pull` with the device token from `credentials.ts` (`call` times out after 60 s
   unless the caller passes its own `signal`). A diverged history is
   three-way merged with `merge.ts` → `merge3`, which never drops geometry.
6. **Agent tools wrap all of it.** `tools.ts` → `blueprintTools` returns six AI-SDK tools. Every
   writing tool applies the ops *before* asking for permission, so a batch that fails never
   reaches the prompt or the disk.

Only `store.ts`, `sync.ts`, `credentials.ts`, `tools.ts` and `symbol-tool.ts` touch Bun, the
filesystem, the network or the tool context. Everything else is pure, which is what lets the web
app compile it through the `@blueprint/*` alias (see [web/blueprints](../../web/blueprints/README.md)).

## Files
| File | Responsibility |
|---|---|
| `tui/src/blueprint/schema.ts` | Zod schemas for entities, layers, parts, nets and the document. `parseDoc`, `serialize`, `canonicalEntity`, `seqOf`, `emptyDoc`, `BlueprintError`. See [data-model](data-model.md). |
| `tui/src/blueprint/ops.ts` | `OpSchema` (13 ops) and `applyOps`: literal ops, then the derived passes. See [editing](editing.md#ops). |
| `tui/src/blueprint/place.ts` | Turns one symbol placement into `add` ops plus a `Part` record: grid snap, id prefix, transformed ports and pin directions. |
| `tui/src/blueprint/arrange.ts` | `arrangeParts`: snap parts to the 2.54 mm grid and push overlapping ones apart. Returns moves, not a document. |
| `tui/src/blueprint/autowire.ts` | `autowireOps`: three fixed rules that draw the connections a drawing already implies. `voltsOf` stops two rail voltages being joined. |
| `tui/src/blueprint/route.ts` | Orthogonal wire routing (`routeWire`), port lookup (`portAt`, `dirAt`), the reroute pass for stale nets and the junction-dot pass. |
| `tui/src/blueprint/labels.ts` | `placeLabelOps`: moves part labels off parts, wires and each other. |
| `tui/src/blueprint/merge.ts` | `merge3`: three-way merge keyed by entity id. Keeps both versions on a conflict. |
| `tui/src/blueprint/diff.ts` | `diffDocs` and `summarise`: entity-level diff. The same primitive `merge3` uses. |
| `tui/src/blueprint/geom.ts` | Affine matrices, `flatten` (every entity to polylines), `bbox`, `textBox`, `transform`. |
| `tui/src/blueprint/render-braille.ts` | `renderCells` and `renderBraille`: draws a document as Unicode braille, with a layer per cell. `autoView` fits the content. |
| `tui/src/blueprint/render-svg.ts` | `toSvg`: SVG export with real arcs and béziers. |
| `tui/src/blueprint/draw.ts` | The drawing tool model (`TOOLS`, `shapeFrom`) shared by the terminal editor. |
| `tui/src/blueprint/pick.ts` | Selection geometry: `hitTest`, `entitiesWithin`, `gridStep`. |
| `tui/src/blueprint/fit.ts` | `fitStroke`: turns a hand-drawn stroke into one clean entity (smooth, simplify, classify, snap). |
| `tui/src/blueprint/check.ts` | `checkDoc` and `formatReport`: geometry and connectivity checks, plus electrical, building and IoT rules read from `REF \| key=value` annotations. |
| `tui/src/blueprint/store.ts` | The git-backed store: `safeName`, `readDoc`, `readOrCreate`, `writeDoc`, `deleteDoc`, `history`, `docAt`, `listBlueprints`. Also exports `git` and `gitOrThrow` for `tui/src/code/`. |
| `tui/src/blueprint/sync.ts` | `push`, `pull` and `status` against the web API. Exports `call`, the authenticated fetch helper other modules reuse. |
| `tui/src/blueprint/credentials.ts` | Reads and writes the device pairing file (`credentials.json`, mode 0600). |
| `tui/src/blueprint/tools.ts` | The agent tools `blueprint`, `blueprint_edit`, `blueprint_view`, `blueprint_check`, `blueprint_sync`, and `blueprintTools`, which also adds `blueprint_symbol`. |
| `tui/src/blueprint/symbol-tool.ts` | The `blueprint_symbol` tool: `list` searches the libraries, `place` applies `place` ops. |
| `tui/src/blueprint/symbols/index.ts` | `BlueprintSymbol` type, `LIBRARIES`, `DOMAINS`, `GRID`, `findSymbol`, `searchSymbols`, `roleOf` (pin supply role) and `portDirs` (derived pin directions). |
| `tui/src/blueprint/symbols/electrical.ts` | `ELECTRICAL`: 151 IEC 60617 schematic and installation symbols on the 2.54 mm grid. |
| `tui/src/blueprint/symbols/building.ts` | `BUILDING`: 123 architectural plan symbols at real size in millimetres (no grid). |
| `tui/src/blueprint/symbols/iot.ts` | `IOT`: 128 boards, modules, sensors, radios, power and bus blocks. Most declare pin names. |

## Interfaces

**Agent tools** (registered by `tui/src/tools/index.ts` through `blueprintTools`). Details and
parameters are in [editing](editing.md#agent-tools).

| Tool | Actions | Permission prompt |
|---|---|---|
| `blueprint` | `list`, `create`, `info`, `history`, `delete` | `create`, `delete` |
| `blueprint_edit` | apply `ops` and commit | always |
| `blueprint_view` | render as `braille`, `svg` or `json`, optionally `at` a commit | never |
| `blueprint_symbol` | `list`, `place` | `place` |
| `blueprint_check` | run `checkDoc` for a domain | never |
| `blueprint_sync` | `push`, `pull`, `status` | `push`, `pull` |

**Config keys** (`tui/src/config/config.ts`): `blueprint.dir` overrides the store root;
`blueprint.workspace` (default `"default"`) picks the subfolder and maps to a web workstation.
`blueprint.pi.*` belongs to [Pi vision](../pi-vision/README.md).

**HTTP** (client side only): `POST /api/blueprint/push`, `GET /api/blueprint/pull`. The server side
is in [web/blueprints](../../web/blueprints/README.md#interfaces).

## Data and state

- Store: `<dataDir>/blueprints/<workspace>/<name>.blueprint.json`, one git repo per workspace
  (branch `main`, local identity `jarvis <jarvis@localhost>`). `dataDir` is
  `$XDG_DATA_HOME/jarvis` or `~/.local/share/jarvis` (`tui/src/config/paths.ts`).
- Credentials: `<dataDir>/credentials.json`, mode 0600. Fields `baseUrl`, `deviceId`, `token`,
  `workstationId`, optional `name`.
- No in-memory caches. Every tool call reads the file again.

## Depends on / used by

**Depends on:** `zod`, `ai` (`tool`), `tui/src/tools/context.ts` (`ToolContext`, `ToolError`),
`tui/src/config/` (`Config`, `dataDir`), `tui/src/engineering/formulas.ts` (`evaluate`, `RHO`,
used by `check.ts`), the `git` binary.

**Used by:**
- [Tools](../tools/README.md): `tui/src/tools/index.ts` spreads `blueprintTools` and uses `isPaired`.
- [UI](../ui/README.md): `tui/src/ui/components/blueprint-editor.tsx` and `blueprint-view.tsx` (the
  `/blueprint` terminal editor), `pickers.ts`, `builtin-commands.ts`, `app.tsx`.
- [Pi vision](../pi-vision/README.md): `tui/src/pi/index.ts` uses `fitStroke`, `applyOps`, the store.
- [Code projects](../code-projects/README.md): `tui/src/code/` reuses `git`, `gitOrThrow`, `safeName`, `call`.
- Agent, CLI, voice and vision code read `credentials.ts` for the device token.
- [web/blueprints](../../web/blueprints/README.md) and [web/mcp](../../web/mcp/README.md) import the
  pure files through `@blueprint/*`.

## Gotchas

- **Keep the pure files pure.** Importing `store.ts`, `sync.ts` or `credentials.ts` from any file
  the web imports breaks the web build (`Cannot find name 'Bun'`). `place.ts` says so in its header.
- **Ids are never reused.** `seq` in the file only grows. Wire ids (`w1`…), net ids (`n1`…) and
  part prefixes (`r1-1-…`) are separate series. Never hand-edit ids, or diff and merge will
  confuse two entities. See [data-model](data-model.md#ids).
- **Every derived pass must be idempotent.** The web editor replays its op journal on the client and
  the server replays it again. A pass that changes its mind on a second run would save a drawing
  that differs from the one the user approved.
- **A failed batch changes nothing.** `applyOps` throws `BlueprintError` on an unknown id, layer,
  symbol or ref. Tools apply before the permission prompt, so nothing partial is written.
- **`blueprint_check` never passes what it cannot read.** Unannotated items go in a NOT CHECKED
  list. Keep it that way when adding rules.
- `ponytail:` shortcuts in this folder: `routeWire` tries five orthogonal shapes per escape pair,
  with no grid search; `textCorners` uses a fixed 0.6 em glyph advance; `transform` scales radii
  by the mean scale (no ellipse entity); `pull` fetches the whole history each time.

## Tests

| File | Covers |
|---|---|
| `tui/test/blueprint-core.test.ts` | Flat `add` validation, `serialize`, geometry, `applyOps`, both renderers, parts. |
| `tui/test/blueprint-wiring.test.ts` | Routing, auto-wiring, polarity, stale nets, labels, merge of nets. |
| `tui/test/blueprint-symbols.test.ts` | Every library symbol is valid; `findSymbol`, `searchSymbols`, `blueprint_symbol`. |
| `tui/test/blueprint-check.test.ts` | `parseAnnotation`, geometry, electrical, building and IoT checks, `formatReport`. |
| `tui/test/blueprint-merge.test.ts` | `diffDocs`, `merge3` (including parts). |
| `tui/test/blueprint-fit.test.ts` | `simplify`, `fitStroke` classification, forced tools, snapping. |
| `tui/test/blueprint-store.test.ts` | `safeName`, `readOrCreate`, the git store, `blueprintRoot`. |
| `tui/test/blueprint-sync.test.ts` | `push`, `pull`, `status` against a fake server, including divergence. |
| `tui/test/blueprint-ui.test.tsx` | The terminal editor (`tui/src/ui/components/blueprint-editor.tsx`) on top of this engine. |

Run with `cd tui && bun test blueprint`.
