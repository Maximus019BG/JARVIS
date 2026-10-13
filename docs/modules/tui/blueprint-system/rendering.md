# Blueprint rendering

Part of [Blueprint system](README.md). Code: `tui/src/blueprint/{geom,render-braille,render-svg,draw,diff}.ts` · Verified: 2026-10-13 @ c292f2f

Every renderer works from the same geometry: `geom.ts` → `flatten` reduces any entity to
polylines. The braille renderer, the checker, hit-testing and the web canvas all measure against
it, so what is drawn, what is checked and what is clickable agree.

## Geometry (`geom.ts`)

| Export | What it does |
|---|---|
| `Mat`, `IDENTITY` | 2D affine matrix in SVG order `[a, b, c, d, e, f]`. |
| `translate`, `rotate(deg, about?)`, `scale(sx, sy, about?)` | Matrix builders. `rotate` is clockwise on screen because Y points down. |
| `apply(m, pt)`, `compose(a, b)` | `compose(a, b)` applies `b` first, then `a`. |
| `flatten(entity, tol = 0.2)` | Entity to `Pt[][]`. Closed shapes repeat their first point. Arcs and circles use enough segments to keep the sagitta under `tol` (6 to 512). Béziers use 4 to 128 segments; quadratics become cubics. A `dimension` becomes extension lines, the dimension line and two arrow barbs. `text` returns nothing. |
| `textCorners`, `textBox` | A text entity's box: width `0.6 × size` per character, from `0.75 × size` above the baseline to `0.25 × size` below, rotated by `angle` about `at`. |
| `bbox(entities, tol?)` | `[minX, minY, maxX, maxY]` or `undefined`. Text counts with its glyph box, not as a point, so labels can collide with things. |
| `transform(entity, m)` | Moves an entity through a matrix. A `rect` under rotation or skew becomes a closed `polyline` (keeping it a rect would square it back to the axes). Radii scale by the mean of the two axis scales. Arcs and text pick up the rotation angle. |

## Braille (`render-braille.ts`)

Unicode braille packs a 2×4 dot grid into one character, so an 80×24 terminal is a 160×96
bitmap. It needs no graphics protocol and works over ssh to a Pi.

- `renderCells(doc, options)` → `Rendered` `{ cells, toCell, toDoc, overflow, view }`. Each `Cell`
  is `{ ch, layer? }`, so a front end can colour by layer (last writer wins). `toCell` and `toDoc`
  convert between document points and cells, for a cursor.
- `renderBraille(doc, options)` is the same, flattened to strings with trailing blank cells
  trimmed and overflowed labels listed below the picture.
- `autoView(doc, layers?)` fits the visible content with a 4% margin, falling back to the sheet, so
  a small sketch is not a speck on an A4 page.

`BrailleOptions`: `cols`, `rows`, `view?`, `layers?` (default: every visible layer), `frame?`
(sheet border), `grid?` (dot every N units; the step doubles until dots are at least 8 cells apart),
`scaleBar?` (a `├── 50 mm ──┤` row), `labels?` (default on).

Drawing order: grid, frame, entities (Bresenham lines over `flatten`), then text written as real
characters centred on its anchor. A label that would not fit or would touch another label (one
cell of padding) goes to `overflow` rather than being drawn unreadably.

The `blueprint_edit` tool returns a 76×22 braille preview after every edit so the model can check
its own work. The terminal editor uses `renderCells` directly.

## SVG (`render-svg.ts`)

`toSvg(doc, { width?, showGrid?, layers? })` returns an SVG string. The format shares SVG's
coordinate system, so export is a direct transcription with no flips:

- Each entity becomes its own element with `id` set to the entity id. Closed polylines become
  `<polygon>`. Rects with negative size are normalised (SVG forbids them).
- Arcs are real `A` path commands; a sweep of 360° or more becomes a `<circle>`. Paths keep their
  béziers, so the file stays editable in a vector tool. Only `dimension` is pre-flattened, plus a
  `<text>` label (its `label` or the measured length).
- Stroke: entity `stroke`, else layer `color`, else `currentColor`. Widths are scaled by
  `max(width, height) / 300` so hairlines stay visible on large sheets. Default width 0.4.
- `showGrid` adds a 10-unit pattern.

Used by `blueprint_view format:"svg"` and by the web symbol palette thumbnails.

## Diff (`diff.ts`)

`diffDocs(before, after)` → `DocDiff` `{ entities, layers, viewBox?, name?, counts }`.

- Keyed by entity id, so reordering is not a change and an edit is `modified`, not remove plus add.
- "Modified" means `canonicalEntity` differs, the same test `merge3` uses. They must agree, or a
  merge could drop work that the diff called unchanged.
- Output follows `before`'s order with additions appended.
- `summarise(diff)` gives `3 added, 1 modified` or `no geometry changes`.
- `byId(entities)` is the `Map<id, Entity>` helper `merge3` also uses.

Used by `blueprint_edit` (the change line in its reply), the web diff route and the MCP edit tool.

## Tool model (`draw.ts`)

The interactive drawing tools, so the terminal editor and the web toolbar agree on what each tool
means and which key picks it.

- `TOOLS`: `select` (v), `freehand` (f), `line` (l), `polyline` (p), `rect` (r), `circle` (c),
  `arc` (a), `text` (t), `dimension` (d), `symbol` (s). `pointer: true` marks tools that need a real
  pointing device; the terminal shows them disabled.
- `shapeFrom(tool, from, to, layer)`: the entity a drag describes for `line`, `rect`, `circle` and
  `dimension` (a dimension starts offset by 15% of its length, at least 2, so the checker does not
  flag it). Other tools return `null`.

Icons stay in the web toolbar because they come from `lucide`. Note that the web editor currently
keeps its own copy of `TOOLS` and `shapeFrom`; see [web/blueprints](../../web/blueprints/README.md#gotchas).

## Gotchas

- Text width is an estimate (`ponytail:` fixed 0.6 em). Label collision checks are approximately
  right, not exact.
- Braille centres text on its anchor; SVG, the web canvas and `textBox` treat the anchor as
  baseline-left. Label positions in the braille preview are therefore approximate.
- `transform` with non-uniform scale turns circles into circles with the mean radius (`ponytail:`;
  there is no ellipse entity).
