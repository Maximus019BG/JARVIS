# Construction and the symbol index

Every name here is a real entry in the `building` library. `blueprint_symbol
action:"list" domain:"building"` with a query shows descriptions and port counts.

All of these are drawn at **real size in millimetres**, unlike the schematic libraries. A
`door-single-left` really is 900 mm wide. Scale a placement only when the real component
is a different size — not to fit the sheet.

## Walls

Draw the two faces, then place a junction symbol where walls meet.

`wall-end` `wall-junction-l` `wall-junction-t` `wall-junction-x`

These are drawn for a 100 mm partition. For a thicker wall, draw the faces yourself as
paired `polyline`s and use the junctions only as a reference for how the corner closes.

**Structure:** `column-square` `column-round` `column-steel-i` `beam-over` `slab-edge`
`expansion-joint` `damp-course`

`beam-over` is dashed because it is above the cut plane. Anything above the cut — beams,
wall units, rooflights, overhead hatches — is dashed. That convention is what tells a
reader whether they will hit their head on it.

## Openings

The origin is the **middle of the opening**, on the wall centreline, with the wall running
along X. Ports are the two ends of the opening.

**Doors:** `door-single-left` `door-single-right` `door-700` `door-800` `door-1000`
`door-double` `door-double-swing` `door-sliding` `door-sliding-pocket` `door-bifold`
`door-revolving` `door-fire` `door-garage` `opening-no-door` `hatch`

The swing arc is not decoration — it shows what the door hits. Check it against furniture
and against the other doors before moving on. A door that swings into a corridor is a
problem in most fire strategies.

`door-fire` carries an `FD` mark; label it with the rating (`EI30`, `EI60`).

**Windows:** `window-600` `window-900` `window-1200` `window-1500` `window-1800`
`window-2400` `window-fixed` `window-casement` `window-bay` `window-corner` `rooflight`

The numbered ones are structural opening widths and carry the right number of mullions.
`window-casement` shows the opening sash swing, which matters for escape windows and for
anything opening over a footpath.

## Vertical circulation

`stair-straight` `stair-straight-short` `stair-quarter` `stair-half` `stair-spiral`
`ramp` `ramp-accessible` `lift` `lift-goods` `escalator` `ladder`

`stair-straight` is 13 treads at 250 mm going, 1000 mm wide, with the UP arrow from the
bottom riser. Work the real riser count out with `engineering_calc stair-run` from the
floor-to-floor height first, then scale or redraw — a stair with the wrong number of
risers is the fastest way to a drawing that cannot be built.

`lift` is 1100 × 1400 mm, the EN 81-70 type 1 accessible car.

The UP arrow always points up the flight, and every plan shows the flight cut at the storey
it belongs to.

## Sanitary

`wc` `wc-accessible` `bidet` `urinal` `basin` `basin-double` `basin-corner` `bath`
`bath-corner` `shower` `shower-tray` `shower-walk-in` `sink-single` `sink-double`
`floor-drain` `water-heater` `boiler` `radiator` `washing-machine` `dishwasher`

`wc-accessible` includes the 1500 × 1500 mm transfer space as a dashed rectangle. That
space is the point of the symbol — draw it and check nothing else is in it.

Remember IEC 60364-7-701 zones when the electrical layout goes on the same building:
nothing but a pull-cord switch and IP-rated fittings inside a bathroom's zones.

## Kitchen

`base-unit-600` `base-unit-1000` `wall-unit` `corner-unit` `tall-unit` `hob` `hob-5`
`oven` `cooker` `range-cooker` `fridge` `fridge-freezer` `extractor-hood` `worktop`

Units are 600 mm deep, worktop 900 mm high. `wall-unit` and `extractor-hood` are dashed —
they are above the cut. Keep 900–1200 mm of clear floor in front of a run, and do not put
a hob directly against a return wall or under a window.

## Furniture

`bed-single` `bed-double` `bed-king` `bed-bunk` `sofa-2` `sofa-3` `sofa-corner` `armchair`
`table-dining-4` `table-dining-6` `table-round` `table-coffee` `desk` `desk-corner` `chair`
`wardrobe` `wardrobe-sliding` `bookshelf` `tv-unit` `storage-unit`

Furniture is not decoration on a plan — it is how you prove a room works. A bedroom that
cannot take a bed plus a wardrobe plus a door swing is a bedroom on paper only.
`table-dining-4` and `table-dining-6` include the chairs pulled out, which is the footprint
that actually matters.

## Annotation

`north-arrow` `section-marker` `elevation-marker` `level-marker` `grid-bubble`
`detail-callout` `room-tag` `scale-bar` `break-line` `revision-cloud`

- `north-arrow` — rotate it to the real site orientation. One per plan.
- `section-marker` — one at each end of the cut line, both labelled the same letter.
- `level-marker` — spot levels as `+0.000`, `+2.700`. Edit the text.
- `grid-bubble` — structural grid, letters one way and numbers the other.
- `room-tag` — the name and the area. Keep the area consistent with what you annotate on
  the `rooms` layer for `blueprint_check`.

## Site

`tree` `tree-conifer` `shrub` `hedge` `parking-space` `parking-accessible` `car` `kerb`
`contour` `boundary-line` `manhole`

`parking-space` is 2500 × 5000 mm; `parking-accessible` is 3600 mm overall including the
transfer zone, which is the part people forget.

## Dimensioning a plan

The rules from `blueprint-drafting` apply, plus these:

- Three chains on each elevation of the plan: overall, then structural bay or wall centres,
  then openings.
- Dimension **to structure**, not to finishes, and say which.
- Openings are dimensioned to their centreline, walls to their face or centreline —
  pick one and say which in a note.
- Go anticlockwise round the building so every positive offset lands outside it.
- Stagger the chains 8–15 mm apart on the sheet at the printed scale, which at 1:50 is
  400–750 mm in model space.

## No fill

The schema has no hatching or fill. Poché walls, hatched sections and filled junction dots
are not available. Where a drawing needs to distinguish materials, use layer colours and a
key, and say in a note that the section is unhatched.
