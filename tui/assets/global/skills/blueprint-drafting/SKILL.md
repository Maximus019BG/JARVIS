---
name: blueprint-drafting
description: How to build precise 2D technical drawings with the blueprint tools — coordinate conventions, choosing entities, batching edits, dimensioning, and the maths for bolt circles, slots, fillets and chamfers. Use whenever creating or editing a blueprint, drawing a part, laying out holes, or adding dimensions.
---

# Blueprint drafting

A blueprint is an ordered list of entities on a sheet, stored as JSON and committed to git
on every edit. Three tools:

| Tool | For |
|---|---|
| `blueprint` | list · create · info · history · delete |
| `blueprint_edit` | draw — takes a list of ops, commits, returns a picture |
| `blueprint_view` | look — `braille` to see, `svg` to export, `json` for exact data |

`references/entities.md` has the full entity and op reference. Read it when you need a
field name; the rest of this file is how to use them well.

## Coordinates

- **Y points down.** `[0, 10]` is below `[0, 0]`. This matches SVG and every 2D canvas.
- **Angles are degrees, clockwise from +X**, because Y points down. `0°` is right, `90°`
  is down, `180°` is left, `270°` is up.
- Default sheet is A4 landscape, `[0, 0, 297, 210]`, in millimetres.
- An arc sweeps from `a0` to `a1` in increasing-angle order. To go the long way round, use
  an `a1` more than 180° from `a0` — `a0: 0, a1: 270` is three quarters clockwise.

## The loop

1. `blueprint` `action: "create"` once, with the sheet size you actually need.
2. `blueprint_edit` with a batch of ops per feature.
3. Read the braille picture that comes back. It is small, but it will show you a line
   going the wrong way or a circle in the wrong place.
4. `blueprint_view` with a tighter `view` to inspect a detail.
5. Dimension it.

Entity ids (`e1`, `e2`, …) are assigned on `add`, in order. The reply lists what changed;
`blueprint` `action: "info"` lists every id with its type and layer.

## Choosing an entity

Reach for the most specific one that fits:

- Four straight sides, axis-aligned → `rect`, not four `line`s.
- A full round hole → `circle`, not a closed `path`.
- Part of a circle → `arc`. Fillets and rounded corners are arcs.
- A chain of straight segments → one `polyline`, not many `line`s.
- Anything with a real curve → `path` with `C` (cubic) or `Q` (quadratic).

Specific entities survive edits — scaling a `circle` keeps it round, scaling a tessellated
path does not — and they produce a one-line diff instead of a hundred.

**A rotated `rect` becomes a `polyline`.** A rect is axis-aligned by definition, so
rotating one converts it. If you need a tilted rectangle that stays editable as a
rectangle, draw it axis-aligned and rotate the view instead.

## Layers

Create them up front, one per concern:

```json
{"op": "addLayer", "layer": {"name": "holes", "color": "#b91c1c"}}
```

Ids are assigned in order — `l0` is the layer you got for free, then `l1`, `l2`. Put
dimensions on their own layer so a manufacturing view can hide them.

## Dimensioning

A `dimension` spans `a` to `b` with a perpendicular `offset`. Omit `label` and it shows the
measured length.

**A positive `offset` puts the dimension line on the right-hand side of the direction of
travel `a` → `b`.** With Y pointing down that means:

| `a` → `b` | positive offset goes |
|---|---|
| left to right | **below** |
| right to left | above |
| top to bottom | **left** |
| bottom to top | right |

So go anticlockwise around the part and every positive offset lands outside it. Get this
backwards and the dimension is drawn through the middle of the part — which is why you
look at the picture that comes back.

```json
{"op": "add", "entity": {"type": "dimension", "layer": "l2", "a": [0, 60], "b": [100, 60], "offset": 12}}
```

Rules that make a drawing readable:

- Dimension from datum edges, not chained between features — errors accumulate in a chain.
- Keep dimension lines outside the part. Offsets of 8–15 mm clear most outlines.
- Stagger parallel dimensions by 8 mm or so, largest furthest out, so they do not collide.
- Dimension every size someone needs to make the part, and no size twice.

## Constructions

**Bolt circle** — `n` holes of radius `r` on a circle of radius `R` about `[cx, cy]`,
first hole at `start` degrees:

```
hole i:  cx + R·cos((start + i·360/n)°),  cy + R·sin((start + i·360/n)°)
```

**Slot** — a rounded slot from `[x1, y1]` to `[x2, y2]` of width `w` is two lines and two
arcs, or, more simply, a `rect` with `rx = w/2` when it is axis-aligned.

**Fillet** of radius `r` between two lines meeting at a corner: the arc centre sits `r`
away from both lines, on the inside. For a square corner at `[cx, cy]` opening right and
down, the centre is `[cx + r, cy + r]` and the arc runs `180°` to `270°`.

**Chamfer** of size `c` on a square corner: replace the corner point with two points, each
`c` back along its own edge.

## Worked example

A 100 × 60 mm plate, 6 mm holes 10 mm in from each corner, a 20 mm slot down the centre:

```json
[
  {"op": "addLayer", "layer": {"name": "holes", "color": "#b91c1c"}},
  {"op": "addLayer", "layer": {"name": "dims", "color": "#64748b"}},
  {"op": "add", "entity": {"type": "rect", "layer": "l0", "at": [0, 0], "w": 100, "h": 60, "rx": 4}},
  {"op": "add", "entity": {"type": "circle", "layer": "l1", "c": [10, 10], "r": 3}},
  {"op": "add", "entity": {"type": "circle", "layer": "l1", "c": [90, 10], "r": 3}},
  {"op": "add", "entity": {"type": "circle", "layer": "l1", "c": [90, 50], "r": 3}},
  {"op": "add", "entity": {"type": "circle", "layer": "l1", "c": [10, 50], "r": 3}},
  {"op": "add", "entity": {"type": "rect", "layer": "l1", "at": [40, 20], "w": 20, "h": 20, "rx": 10}},
  {"op": "add", "entity": {"type": "dimension", "layer": "l2", "a": [0, 60], "b": [100, 60], "offset": 12}},
  {"op": "add", "entity": {"type": "dimension", "layer": "l2", "a": [100, 60], "b": [100, 0], "offset": 12}}
]
```

Both dimensions travel anticlockwise around the plate — left-to-right along the bottom,
then bottom-to-top up the right side — so both positive offsets land outside the part.

Note the hole radius is 3, not 6 — a "6 mm hole" is a diameter. Getting that wrong is the
single most common drafting mistake; when a size could be either, say which you assumed.
