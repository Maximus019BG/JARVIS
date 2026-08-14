# Entity and operation reference

Every entity accepts these, on top of its own fields:

| Field | Meaning |
|---|---|
| `id` | Assigned on `add`. Pass one only to pin a specific id. |
| `layer` | Layer id. Defaults to the first layer. |
| `stroke` | CSS colour. Defaults to the layer's colour. |
| `width` | Stroke width in drawing units. Defaults to `0.4`. |
| `dash` | `solid` · `dashed` · `dotted`. |

## Entities

| `type` | Fields | Notes |
|---|---|---|
| `line` | `a: [x,y]`, `b: [x,y]` | |
| `polyline` | `pts: [[x,y], …]`, `closed?: boolean` | At least two points. |
| `rect` | `at: [x,y]`, `w`, `h`, `rx?` | `at` is the top-left corner (Y is down). `rx` rounds the corners. Negative `w`/`h` are legal. |
| `circle` | `c: [x,y]`, `r` | `r` is a **radius**. |
| `arc` | `c: [x,y]`, `r`, `a0`, `a1` | Degrees, clockwise from +X. Sweeps `a0` → `a1` in increasing order. |
| `path` | `d: [command, …]` | See below. |
| `text` | `at: [x,y]`, `text`, `size?`, `angle?` | `size` defaults to 4. `angle` in degrees. |
| `dimension` | `a: [x,y]`, `b: [x,y]`, `offset`, `label?` | A positive `offset` sits on the right-hand side of the `a` → `b` direction — below when travelling right, left when travelling down. `label` defaults to the measured length. |

### Path commands

| Command | Meaning |
|---|---|
| `["M", x, y]` | Move to. Starts a new subpath. |
| `["L", x, y]` | Line to. |
| `["Q", cx, cy, x, y]` | Quadratic bézier through one control point. |
| `["C", x1, y1, x2, y2, x, y]` | Cubic bézier through two control points. |
| `["Z"]` | Close back to the last `M`. |

## Operations

Passed to `blueprint_edit` as `ops`, applied in order. If any op fails, none of them are
written — the file and its history stay as they were.

| `op` | Fields | Effect |
|---|---|---|
| `add` | `entity` | Appends. Assigns `id` and `layer` if absent. |
| `update` | `id`, `patch` | Merges `patch` into the entity and revalidates. Cannot change `type`. |
| `delete` | `ids: [...]` | Removes. Errors if any id is unknown. |
| `move` | `ids`, `by: [dx, dy]` | Translates. |
| `rotate` | `ids`, `deg`, `about?` | Degrees clockwise. `about` defaults to the selection's centre. |
| `scale` | `ids`, `by`, `about?` | Uniform. `about` defaults to the selection's centre. |
| `restyle` | `ids`, `stroke?`, `width?`, `dash?`, `layer?` | Changes appearance or moves entities between layers. |
| `addLayer` | `layer: {name, color?, visible?, id?}` | Id defaults to `l<n>`. |
| `setLayer` | `id`, `patch: {name?, color?, visible?}` | |
| `setView` | `viewBox: [minX, minY, w, h]` | Resizes the sheet. |

### Notes that will save you a re-draw

- `update` cannot change an entity's `type`. Delete it and add the new one.
- `rotate` and `scale` with no `about` pivot on the **selection's** bounding-box centre,
  not the sheet's. Rotating one hole in place and rotating a whole pattern are the same op
  with different `ids`.
- `scale` is uniform. A `circle` under a non-uniform scale would be an ellipse, which this
  format has no entity for.
- Rotating a `rect` converts it to a closed `polyline`, because a rect is axis-aligned by
  definition.
- Unknown entity and layer ids are errors, never silent no-ops.
- `add` accepts an explicit `id`, which is how a group of entities can be placed and then
  moved or rotated as a unit **within one batch** — `move`, `rotate` and `scale` resolve
  against what the same call has already added.
- **A repeated id is an error.** `diff` and `merge3` key on id, so a duplicate would not
  collide loudly, it would quietly lose one of the two in a three-way merge.
- **An explicit id must not start with `e` followed by a digit.** That is the automatic id
  space; `seqOf` parses `^e(\d+)` to find the next free number, so `e9x` poisons the
  counter and the next `add` collides. Prefix by reference: `r1-a`, `d3-b`.

## Symbols

`blueprint_symbol` places entries from a library of over 400 IEC 60617 electrical,
architectural and IoT symbols instead of drawing them by hand.

| Action | Input | Does |
|---|---|---|
| `list` | `domain?`, `query?` | Names, descriptions, standard references, port counts. Every word of the query must match. |
| `place` | `name`, `placements: [...]`, `message?` | Transforms each symbol and commits, like `blueprint_edit`. |

A placement is `{symbol, at, rotate?, scale?, layer?, label?, labelOffset?}`. Ids are
derived from `label` (or the symbol name) plus the placement index, so a symbol's parts
share a prefix and can be selected together afterwards.

The reply reports each symbol's **ports** — its connection points — already transformed by
the placement. Wire to those exact coordinates rather than re-deriving them.

## Checking

`blueprint_check` takes `name` and `domain` (`general`, `building`, `electrical`, `iot`).

`general` needs nothing but geometry: entities off the sheet, zero-length entities,
coincident duplicates, zero-offset dimensions, empty layers, and a drawing with no
dimensions at all.

The domain rule sets read **layer names** for what an entity is and a `REF | key=value`
annotation in a `text` entity for its parameters — the document schema stores geometry, not
meaning. The domain skills define the layer names and keys.

Anything it cannot read is reported as **NOT CHECKED**, never as a pass.

## Viewing

`blueprint_view` takes `format`:

- `braille` — a picture in the terminal. Pass `view: [minX, minY, w, h]` to zoom into a
  detail, and `layers: ["l0"]` to isolate one.
- `svg` — the export format. Curves stay curves.
- `json` — the exact stored data, including every id.

Pass `at: "<sha>"` with a commit from `blueprint` `action: "history"` to see an older
version instead of the working copy.
