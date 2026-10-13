# Blueprint editing

Part of [Blueprint system](README.md). Code: `tui/src/blueprint/{ops,place,arrange,autowire,route,labels,merge,fit,check,pick,tools,symbol-tool}.ts` · Verified: 2026-10-13 @ c292f2f

## Ops

`ops.ts` → `OpSchema`, a discriminated union on `op`. Ops in one batch run in order.

| `op` | Fields | Effect |
|---|---|---|
| `add` | `entity` | Adds one entity. Allocates `e<n>` unless `entity.id` is given (must be unused). Layer defaults to the first layer. |
| `update` | `id`, `patch` | Merges `patch` into the entity and re-validates. `patch` cannot change `type`; that is a delete plus an add. |
| `delete` | `ids` | Removes entities. Also drops parts with no entities left and nets whose wire or part is gone. |
| `move` | `ids`, `by: [dx, dy]` | Translates. A part moves its `at` and `ports` too, but only if *all* its entities are selected. |
| `rotate` | `ids`, `deg`, `about?` | Clockwise (Y down). Pivot defaults to the selection's bbox centre. |
| `scale` | `ids`, `by`, `about?` | Uniform scale. Same pivot rule. |
| `restyle` | `ids`, `stroke?`, `width?`, `dash?`, `layer?` | Sets style fields or moves entities to another layer. |
| `addLayer` | `layer` | `id` defaults to `l<count>`. Duplicate ids are an error. |
| `setLayer` | `id`, `patch` | Renames, recolours or hides a layer. |
| `setView` | `viewBox` | Changes the sheet. |
| `place` | `symbol`, `at`, `rotate?`, `scale?`, `layer?`, `label?`, `labelOffset?` | Places a library symbol and records a part. See [Placing](#placing-symbols). |
| `connect` | `from`, `to`, `layer?`, `label?` | Wires two ports (`"REF.PORT"`) and records a net. See [Routing](#routing). |
| `arrange` | `refs?` | Snaps parts to the grid and separates overlaps. Omitted `refs` means every part. |

The `add` payload is a flat schema (`FlatEntitySchema`): `type` plus every entity field, all
optional. It is narrowed with `EntitySchema.safeParse` inside `runOps`. The comment explains why:
nesting the 8-way entity union inside the 13-way op union gave `blueprint_edit` a 7.6 KB schema,
17 levels deep, that mid-sized models fumble and Groq rejects.

### applyOps

`applyOps(doc, ops)` → `OpResult` `{ doc, summary, warnings }`.

1. `runOps` applies the literal ops to a copy. Any unknown entity id, layer, symbol, ref or port
   throws `BlueprintError`, and the caller's document is untouched.
2. Then the derived passes in `PASSES`, each a pure `doc → Op[]`, applied with `runOps` in turn:

   | Order | Pass | Why this position |
   |---|---|---|
   | 1 | `route.ts` → `rerouteOps` | Put existing nets back on their ports before anything reads the wires. |
   | 2 | `autowire.ts` → `autowireOps` | Sees the wires as they will be. |
   | 3 | `route.ts` → `junctionOps` | Only now are all wires final. |
   | 4 | `labels.ts` → `placeLabelOps` | Labels dodge wires; wires do not dodge labels. |

3. `summary` is a tally of ops (`add line ×3, connect`), plus `auto-wired R1.1→BT1.1, …` when the
   autowire pass drew anything. Auto-wiring is never silent.
4. `warnings` lists routes that had to cross a part (`blocked`).

Every pass must be idempotent: applying `[]` to a settled drawing must produce the same bytes. The
web saves by replaying the client's op journal on the server, so a pass that changed its mind
would store a different drawing from the one the user saw.

## Placing symbols

`place.ts` → `placeSymbol(placement, index)` returns `{ ops, part }`, or `undefined` for an unknown
symbol. It has no Bun or filesystem imports, because the web compiles it.

1. `findSymbol` resolves the name.
2. `snapAt` rounds `at` to `GRID` (2.54 mm), except for `building` symbols, which are real size.
3. The matrix is scale, then rotate, then translate (`compose` applies the right operand first).
4. Each library entity becomes an `add` with id `<prefix>-<n>`. A `label` adds a `text` entity
   `<prefix>-label`, by default 6 units above `at`.
5. The `Part` stores transformed `ports`, `pins`, and `dirs` (`applyDir`, snapped to an axis so a
   part at 30° still has one of four escape directions).

In `runOps`, `place` finds a free prefix, refuses a duplicate `ref`, and runs the generated `add`s
through `runOps` recursively so they get the same validation as hand-drawn entities.

A label may carry an annotation: `"U1 | mA=240, V=3.3"`. `refIn` takes the part before `|` as the
ref, so annotating a part for `blueprint_check` does not break `connect`.

## Arranging

`arrange.ts` → `arrangeParts(doc, refs?)` returns a `Map<ref, [dx, dy]>`; `runOps` turns each into
a `move` of that part's entities. It snaps each part to the grid, then nudges it one grid step at
a time (up to 64 steps) along the axis with the least travel until its footprint, grown by half a
grid step, clears every other part. Building parts never move. Parts already in place are left
out, so arranging a tidy drawing commits nothing.

## Auto-wiring

`autowire.ts` → `autowireOps(doc)` returns `connect` ops for connections the drawing already
implies. Rules run in order; each claims ports so later rules cannot use them.

| Rule | Fires when | Notes |
|---|---|---|
| 1. Touching | Two free ports within `GRID/2` (but not at the identical point), or a free port lying on an existing wire | On a wire, it connects to the `to` end of that wire's net. |
| 2. Supply rails | A free pin whose `roleOf` is `+` or `-`, and a matching pin on a *source* part (`SOURCE` regex: `supply-`, `ground`, `earth`, `battery`, `cell`, `psu`, `power-supply`) | Nearest wins, no radius; ties go to the lower address. `voltsOf` reads `3V3`, `5V`, `3.3v` from pin names and refuses to put two voltages on one rail, seeded from existing nets. |
| 3. Lone pair | Two parts with no connections at all that are each other's nearest unconnected neighbour | Two-port parts only. Pairs by polarity when both sides declare it, else nearest ends. A one-port load gets both terminals. |

Safety properties, from the file header:

- A port that already has a net is never a candidate, so re-running on a settled drawing produces
  nothing and a deliberately deleted wire is not redrawn. Rail markers (sources) are the
  exception: one ground symbol can take many GND pins.
- Junction dots and building symbols are never auto-wired.
- `wiredPairs(ops)` names every pair drawn, for the summary.

## Routing

`route.ts` → `routeWire(request)` returns `{ path, blocked }`. Wires are orthogonal.

- Each end gets a one-grid-step stub along its pin direction (`fromDir`/`toDir`, from
  `dirAt`). A port with direction `[0, 0]` tries all four axes.
- Candidate shapes per pair of escape directions: a straight run (only if the stub ends line up),
  two L shapes, and Z shapes through corridors. Corridors are the midpoint plus lanes just outside
  every part's footprint and one grid step either side of each endpoint, each with its neighbour
  lanes so a second wire can run beside the first.
- A candidate must still leave and arrive along the pin after `tidy` removes collinear points.
- Score, in order: least length shared with existing wires (`sharedRun`), fewest part crossings
  (stubs exempt), fewest bends, shortest length. Crossing another wire at a right angle is free;
  running along one is not, because two conductors on one line look like one.
- If no candidate satisfies the escape rules, it falls back to a plain L and sets `blocked`.

Other exports:

| Export | Use |
|---|---|
| `portAt(doc, "R1.2")` | Port coordinate. Errors list the refs that exist, or the valid port range. |
| `dirAt`, `pinAt`, `refOf`, `netTouches` | Lookups on a `"REF.PORT"` address or net. |
| `obstaclesFor(doc)` | Every part's footprint grown by `GRID/2`, including the two being wired. |
| `wireSegments(doc, exclude?)` | Every run of every `w<n>` polyline. |
| `routeNet(doc, net)` | Routes one net ignoring its own current wire. |
| `staleNets(doc)` | Nets whose wire ends no longer sit on their ports. Only these are rerouted; rerouting all nets would let two nets swap paths forever. |
| `rerouteOps(doc)` | `update` ops that replace `pts` of stale wires (same id) and move their labels. |
| `junctionOps(doc, layer?)` | Places a `<domain>/junction-dot` where a wire end lands mid-way along another wire; deletes dots that no longer match. |

## Labels

`labels.ts` → `placeLabelOps(doc)` moves each part's `<prefix>-label` when its box (`textBox`)
hits a part footprint, a wire or an already placed label. It tries, in order, above, below, right,
left, then the four corners, in three rings each one grid step further out. A clear label never
moves. If nothing is clear, the label stays and `blueprint_check` reports the overlap. Parts are
processed in prefix order so the result does not depend on placement order.

## Merge

`merge.ts` → `merge3(base, ours, theirs)` → `{ doc, conflicts, renamed }`. Keyed by entity id,
using `canonicalEntity` to decide "changed".

| Case | Result |
|---|---|
| Only one side changed an entity | That side's version. |
| Both changed it differently | Ours keeps the id; theirs is added as `<id>-b`. A `both-modified` conflict if the base had it, otherwise just a rename (both sides added with the same new id). |
| Deleted on one side, edited on the other | The edit is kept, with a conflict. |
| Deleted on one side, untouched on the other | Deleted. |

Then: layers merge with ours winning (a layer is presentation, not worth a conflict); entities on
a missing layer move to the first layer; `viewBox` becomes the union of both; parts are unioned by
ref and dropped if their entities did not survive; nets are unioned by their port pair (not their
id), follow renamed wires, and are renumbered `n1…`; `seq` goes past both sides.

`merge3` never drops geometry. A drawing with an extra line is quick to fix; a missing line is not.

## Freehand fitting

`fit.ts` → `fitStroke(points, options)` turns timestamped stroke samples (`StrokePoint`) into one
entity, or `undefined` for a twitch. Used by the Pi hand-drawing loop and both editors' freehand
tool.

1. Zero-lag smoothing: a one-pole filter run forwards then backwards, endpoints pinned to the raw
   samples.
2. Thin points closer than `tolerance/2`, then Ramer–Douglas–Peucker (`simplify`, iterative).
3. Classify. With `tool` other than `auto` the shape is forced. In `auto` mode: two points is a
   `line`; a closed stroke with radius spread under 12% is a `circle`; a closed stroke filling over
   82% of its bounding box is a `rect`; no corner sharper than 40° over 4+ points is a smooth
   `path` (Catmull-Rom to cubic béziers); otherwise a `polyline`.
4. Snap last: existing endpoints (`snapPoints` within `snapRadius`) win over the grid (`snapGrid`).

`DEFAULT_FIT` = `{ tolerance: 1.2, smoothing: 0.35, snapGrid: 0, snapRadius: 3 }`. The Pi loop
(`tui/src/pi/index.ts`) and the terminal editor spread their own tuning over it.

## Checks

`check.ts` → `checkDoc(doc, domain)` → `{ findings, unchecked, checked }`; `formatReport` turns it
into text. Pure, so the web check panel runs the same code.

Meaning comes from conventions, not the schema: an item's *kind* comes from its layer name, and
its *parameters* from a text entity in the form `REF | key=value, key=value` (`parseAnnotation`;
keys lower-cased, only plain decimals become numbers, so `0x76` stays a string).

| Domain | Layers matched (name contains) | Checks |
|---|---|---|
| always | any | Off-sheet, zero-length line or polyline, zero-size rect, zero-offset dimension, duplicate entities, empty layers, no dimensions at all. Connectivity: net with no wire, net naming a missing port, wire detached from its port, two wires along each other, unconnected ports (info), labels overlapping labels or other parts. |
| `electrical` | `cable`, `circuit`, `wiring`; `earth`, `supply` | Ampacity (IEC 60364-5-52 Table B.52.4, method C, PVC Cu), Ib ≤ In ≤ Iz, voltage drop (3% lighting, 5% other), RCD on sockets and wet areas, duplicate circuit refs, mixed earthing systems. Keys: `mm2`, `A`, `m`, `ph`, `V`, `mcb`, `rcd`, `use`, `system`. |
| `building` | `door`, `window`, `stair`, `ramp`, `room`, `corridor` | Door width (800 mm) and head height, stair rule and pitch and headroom, ramp gradient and rise, corridor width, room imposed load (info). Keys: `w`, `h`, `rise`, `going`, `headroom`, `gradient`, `area`, `cat`. |
| `iot` | `device`, `supply`, `bus`, `power` | Power budget against `supplyMA`, mixed bus voltages without `shift=yes`, duplicate bus addresses, pins used twice. Keys: `mA`, `supplyMA`, `V`, `bus`, `addr`, `pin`, `shift`. |

Anything on a matching layer that cannot be read goes in `unchecked` and is printed as NOT CHECKED,
never as a pass. Formulas come from `tui/src/engineering/formulas.ts` → `evaluate`.

## Selection

`pick.ts`, shared by the terminal editor:

- `hitTest(doc, point, tolerance, skip?)`: nearest entity within `tolerance`, measured against
  `flatten`, so what looks clickable is clickable. Ties go to the topmost (last) entity.
- `entitiesWithin(doc, from, to)`: ids whose bbox lies fully inside a marquee.
- `gridStep(unitsPerPixel)`: a 1/2/5 × 10ⁿ grid step for the zoom.

## Agent tools

Built in `tools.ts` and `symbol-tool.ts`, each a factory `(ctx: ToolContext, root: string)`.
`blueprintTools` returns all six, keyed by name. Every name goes through `store.ts` → `safeName`.

| Tool | Parameters | Behaviour |
|---|---|---|
| `blueprint` | `action`: `list` \| `create` \| `info` \| `history` \| `delete`; `name?`; `units?`, `viewBox?` (create only) | `list` shows entity and layer counts and the last commit. `create` fails if it exists. `info` lists layers and every entity id. `history` lists up to 20 commits. `delete` removes the file with a git commit. |
| `blueprint_edit` | `name`, `ops` (≥ 1 `Op`), `message?`, `view?` | `readOrCreate`, `applyOps`, permission prompt (detail is the full serialized result), `writeDoc`. Returns the sha, summary, added/removed ids, warnings first, then a 76×22 braille preview. Creates the blueprint if missing. |
| `blueprint_view` | `name`, `format`: `braille` (default) \| `svg` \| `json`; `view?`, `layers?`, `at?` (commit sha) | Read-only. `json` is the exact `serialize` output, including `parts` and `nets`. |
| `blueprint_symbol` | `action`: `list` \| `place`; `name?`, `domain?`, `query?`, `placements?` (array of `{ symbol, at, rotate?, scale?, layer?, label?, labelOffset? }`), the same fields flat at top level, `message?` | `list` prints qualified names, port counts, descriptions, standards. `place` turns each placement into a `place` op, applies, prompts, commits, and reports each part's ref and `REF.1..REF.n` port range. A single flat placement is accepted because some providers flatten the array. |
| `blueprint_check` | `name`, `domain`: `general` (default) \| `building` \| `electrical` \| `iot` | Read-only `checkDoc` + `formatReport`. |
| `blueprint_sync` | `action`: `push` \| `pull` \| `status`; `name` | See [sync-and-history](sync-and-history.md). `push`/`pull` prompt; `status` does not. |

The tool descriptions tell the model to place parts with labels and then `connect` ports by name,
and never to compute wire coordinates. Keep that wording if you change the tools: a model given
the choice draws wires by hand.
