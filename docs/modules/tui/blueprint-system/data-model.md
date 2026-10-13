# Blueprint data model

Part of [Blueprint system](README.md). Code: `tui/src/blueprint/schema.ts`,
`tui/src/blueprint/symbols/index.ts` · Verified: 2026-10-13 @ c292f2f

## The document

`schema.ts` → `BlueprintDocSchema`. One JSON file per blueprint, `<name>.blueprint.json`.

| Field | Type | Notes |
|---|---|---|
| `schema` | literal `1` | Format version. |
| `id` | string | `bp_` + random. The stable identity: sync keys on it, so a rename never forks history. |
| `name` | string | Matches the file name (see `store.ts` → `safeName`). |
| `units` | `"mm" \| "cm" \| "in" \| "px"` | `UNITS`. Default `mm`. |
| `seq` | int, optional | Highest entity number ever handed out. See [Ids](#ids). |
| `viewBox` | `[minX, minY, width, height]` | The sheet, same meaning as SVG. Default `DEFAULT_VIEW_BOX` = `[0, 0, 297, 210]` (A4 landscape, mm). |
| `layers` | `Layer[]`, at least 1 | `{ id, name, color?, visible? }`. `emptyDoc` creates `l0` "outline". |
| `entities` | `Entity[]` | Drawn in order; last is on top. |
| `parts` | `Part[]` | Placed symbols. Defaults to `[]`, so older files still load. |
| `nets` | `Net[]` | Connections between ports. Defaults to `[]`. |

**Coordinates:** Y grows downwards, like SVG and canvas. Angles are degrees, clockwise from +X.

## Entities

`EntitySchema` is a discriminated union on `type`. Every entity also has optional `id`, `layer`,
`stroke`, `width` (> 0) and `dash` (`solid`, `dashed`, `dotted`). Style falls back to the layer.

| `type` | Fields | Notes |
|---|---|---|
| `line` | `a`, `b` | |
| `polyline` | `pts` (≥ 2), `closed?` | Wires are polylines with ids `w<n>`. |
| `rect` | `at`, `w`, `h`, `rx?` | Axis-aligned. Negative `w`/`h` are legal. Rotating one turns it into a closed polyline (`geom.ts` → `transform`). |
| `circle` | `c`, `r` (> 0) | |
| `arc` | `c`, `r`, `a0`, `a1` | Always sweeps from `a0` towards increasing angle, so `a1 < a0` means the long way round. |
| `path` | `d` (≥ 1 command) | Commands `M`, `L`, `Q`, `C`, `Z` as tuples (`PathCommand`). |
| `text` | `at`, `text`, `size?`, `angle?` | `at` is the baseline-left anchor. Default size 4. |
| `dimension` | `a`, `b`, `offset`, `label?` | `offset` is the perpendicular distance to the dimension line; negative flips the side. |

`id` and `layer` are optional on input. `parseDoc` and `applyOps` fill them in before anything is
stored.

## Ids

| Series | Form | Allocated by |
|---|---|---|
| Plain entities | `e1`, `e2`, … | `runOps` `add`, from `seqOf(doc)` |
| Merge renames | `e7-b` | `merge.ts` (`rename`) when both sides used the same id |
| Wires | `w1`, `w2`, … | `connect`, its own counter |
| Wire labels | `w3-label` | `connect` with a `label` |
| Part entities | `<prefix>-0`, `<prefix>-1`, …, `<prefix>-label` | `place.ts` → `placeSymbol` |
| Nets | `n1`, `n2`, … | `connect`; re-issued in order by `merge3` |

Rules, and why:

- **An id means the same entity forever.** `diffDocs` and `merge3` key on id. Reusing one would
  turn a delete plus an add into a "modification" and merge two unrelated entities.
- `seq` is stored and only grows. `seqOf` returns the larger of `seq` and the highest `e<n>` in the
  file, so a hand-added `e40` cannot collide. Deleting the highest entity does not free its number.
- An `add` with an explicit `id` that already exists is an error. A silent duplicate would lose one
  entity in a three-way merge.
- Part prefixes come from `place.ts` → `prefixFor(label, symbol, index)`: the label (or the symbol
  name) slugified, plus a counter. A leading `e<digit>` becomes `x`, because `seqOf` parses
  `^e(\d+)` and a prefix like `e5-…` would poison the counter.

## Parts

`PartSchema`. A part is the record of one placed symbol. Its geometry is ordinary entities whose
ids start with `<prefix>-`.

| Field | Meaning |
|---|---|
| `ref` | Reference designator (`R1`, `U3`). Unique per document, case-insensitive. Taken from the label before any `\|` (`place.ts` → `refIn`). Falls back to the prefix. |
| `symbol` | Library name as given (`resistor` or `electrical/resistor`). |
| `at`, `rotate?`, `scale?` | Placement. Schematic symbols are snapped to the grid (`snapAt`). |
| `prefix` | Id prefix of the part's entities. |
| `ports` | Connection points in document coordinates, in library order. |
| `pins?` | Pin names matched to `ports` by position; `""` for an unnamed pin. |
| `dirs?` | Outward unit direction per port, snapped to an axis (`applyDir`). |

`ports` and `dirs` are stored already transformed, not recomputed from the library. Routing then
needs no symbol lookup, and changing a symbol in the library cannot move wires in a finished
drawing. For files saved before `dirs` existed, `place.ts` → `dirsOf` recomputes them from the
library and the part's transform.

A part disappears when all its entities are deleted (`runOps` `delete`) or did not survive a merge
(`merge.ts` → `mergeParts`).

## Nets

`NetSchema`: `{ id, from, to, wire, label? }`. `from` and `to` are port addresses `"REF.PORT"`,
1-based (`R1.2`). `wire` is the id of the polyline that draws it.

The net is the fact; the polyline is only how it is drawn right now. When a part moves, the
reroute pass (`route.ts` → `rerouteOps`) redraws the polyline under the same wire id. A net is
dropped when its wire or either part is deleted.

## Symbols

`symbols/index.ts` → `BlueprintSymbol`: `{ describe, standard?, entities, ports?, pins? }`.
Entities are in local coordinates with the origin at the insertion point, and carry no `id` or
`layer`.

| Library | Export | Count | Grid | Notes |
|---|---|---|---|---|
| electrical | `ELECTRICAL` | 151 | 2.54 mm | IEC 60617. Two-terminal parts span ±4 grid units. 14 declare pins (polarity, supply). |
| building | `BUILDING` | 123 | none | Real size in mm. Openings sit on the wall centreline. |
| iot | `IOT` | 128 | 2.54 mm | Boards at real footprint; every board pin is a port and is named. |

- `GRID` = 2.54 mm (0.1 inch, header pitch).
- `findSymbol(name)` takes `domain/name` or a bare name. A bare name takes the first library in
  `DOMAINS` order that has it (`electrical`, `building`, `iot`). `junction-dot` exists in both
  `electrical` and `iot`, which is why `junctionOps` always qualifies it.
- `searchSymbols({ domain?, query? })` needs every whitespace-separated term to match.
- `portDirs(symbol)` derives each port's outward direction from which edge of the symbol's
  bounding box it sits on. A port in the middle (a lamp, a junction dot) gets `[0, 0]`, meaning
  "no preference".
- `roleOf(pin)` maps a pin name to `"+"`, `"-"` or `"signal"` from a fixed table (`VCC`, `3V3`,
  `GND`, `anode`, …). Anything unknown is `signal`, which is never wired automatically.

## Validation and parsing

- `parseDoc(json)` throws `BlueprintError` with one line per Zod issue. It fills missing entity ids
  and layers and sets `seq`.
- `ops.ts` re-validates every entity it creates or patches with `EntitySchema.safeParse`.
- `BlueprintError` is the one error type for user-facing failures. Tools and web routes turn it
  into a readable message (the web returns 422).

## Serialization

`serialize(doc)` is the only writer:

- Fixed key order for every record (`KEY_ORDER`, and separate orders for layers, parts and nets),
  so two writers produce the same bytes. Unknown keys are still written, at the end.
- Every number rounded to 4 decimals; `-0` becomes `0`. Float noise never makes a git diff.
- One entity, part or net per line. `parts` and `nets` are always written, even when empty, so the
  first placement does not show up as a structural change.

`canonicalEntity(entity)` is the exact line `serialize` writes for one entity. `diffDocs` and
`merge3` compare these, so "changed" always means "a different line in the file".
