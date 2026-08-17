---
name: building-blueprints
description: Drawing architectural floor plans, sections, elevations and site plans to EN/Eurocode conventions — walls, doors, windows, stairs and ramps at real metric sizes, structural spans and loads, U-values and heat loss, accessibility limits, and the annotation grammar that lets blueprint_check verify them. Use whenever drawing a floor plan, a room layout, a house or flat, a section or elevation, or checking a span, a stair, a door width or a U-value.
---

# Building blueprints

Real size in millimetres, EN and Eurocode conventions throughout. **This is a drawing aid,
not a design. Anything that gets built needs a competent person's sign-off, and every
national annex changes the numbers.**

## Conventions (the same in every blueprint skill)

- **Y points down.** `[0, 10]` is below `[0, 0]`, like SVG.
- **Angles are degrees clockwise from +X.** 0° right, 90° down, 180° left, 270° up.
- Millimetres unless the drawing says otherwise. Never mix units in one sheet.
- Batch one whole feature per `blueprint_edit` or `blueprint_symbol` call.
- Explicit entity ids must **not** start with `e` followed by a digit.
- Read the `blueprint-drafting` skill for coordinates, entity choice and dimensioning.

## Scale and sheet

Draw **1:1 in millimetres** and let the sheet size carry the scale. A 10 × 8 m flat is
`viewBox: [0, 0, 12000, 10000]` — it prints at 1:100 on A3, and the braille preview fits it
automatically.

| Scale | Use |
|---|---|
| 1:200 / 1:100 | Site and general arrangement plans |
| 1:50 | Floor plans, the usual working scale |
| 1:20 | Room layouts, kitchens, bathrooms |
| 1:5 / 1:1 | Construction details |

Never place a `scale-bar` on a drawing that is not at model size — it lies.

## Walls, and the one thing to get right

**A wall is drawn as two lines, not one.** The plan is a horizontal cut about 1.2 m above
the floor, so what you see is the two faces of the wall with the opening reveals between
them. One line for a wall is a diagram, not a plan.

Common thicknesses: 100 mm stud partition, 140 mm loadbearing block, 215 mm solid masonry,
300 mm cavity wall. Draw them with `polyline` pairs, and use `wall-junction-l`,
`wall-junction-t`, `wall-junction-x` and `wall-end` for the corners.

Openings sit on the wall centreline with their origin at the middle of the opening and the
wall running along X. Rotate the placement to suit the wall; the swing rotates with it.

## The loop

1. `blueprint` `action: "create"` with a `viewBox` big enough for the building plus margin.
2. Set up layers before drawing anything (below).
3. Walls first, with `blueprint_edit`. Then openings with `blueprint_symbol`.
4. Fittings and furniture, so the rooms can be checked for whether they actually work.
5. `engineering_calc` for every span, load, U-value and stair.
6. Dimension from datum edges. Annotate. Then `blueprint_check` `domain: "building"`.

## Layers

The names matter — `blueprint_check` reads them:

| Layer name | Holds |
|---|---|
| `walls` | wall faces and structure |
| `doors` | door symbols and their annotations |
| `windows` | window symbols and their annotations |
| `stairs` | stairs and ramps, with `rise=` / `going=` / `gradient=` |
| `rooms` | room tags with `area=` and `cat=` |
| `corridor` | circulation, with `w=` |
| `fittings` | sanitary, kitchen, furniture |
| `dimensions` | dimensions only |
| `annotation` | north arrow, section markers, levels, grid |

Add a storey suffix when a drawing carries more than one — `walls-gf`, `walls-ff`.

## Annotation grammar

The schema stores geometry, not meaning, so kind comes from the layer name and parameters
from a `text` entity on that layer shaped exactly like this:

```
REF | key=value, key=value
```

```
D3 | w=900, h=2100, swing=left        on layer "doors"
S1 | rise=175, going=275, headroom=2000   on layer "stairs"
R1 | gradient=20, rise=450            on layer "stairs" or "ramps"
KITCHEN | area=12.4, cat=1            on layer "rooms"
C1 | w=1200                           on layer "corridor"
```

`w` is the **clear** opening width, not the leaf or the structural opening. `cat` is the
EN 1991-1-1 use category: 1 domestic, 2 office, 3 assembly, 4 retail, 5 storage.

**Anything the checker cannot read is reported as NOT CHECKED, never as a pass.** An
unannotated door has not been approved; it has been skipped.

## Numbers worth knowing before you draw

| Thing | Usual metric value |
|---|---|
| Door clear width | 800 mm accessible minimum, 900 mm typical leaf |
| Door height | 2040 mm leaf, 2100 mm structural opening |
| Corridor | 1200 mm accessible, 900 mm absolute floor |
| Storey height | 2700–3000 mm floor to floor, 2400 mm minimum clear |
| Stair | rise ≤ 190, going ≥ 250, 2R+G in 600–650, pitch ≤ 42°, headroom ≥ 2000 |
| Ramp | 1:20 preferred, 1:12 maximum, landing every 500 mm of rise |
| Window head | 2100 mm, cill 900 mm (600 mm where an escape window is needed) |
| Worktop | 900 mm high, 600 mm deep |
| WC | 800 × 1400 mm minimum cubicle; 1500 mm transfer space if accessible |

Every one of these is modified by the national annex. Use them to draw something sensible,
then say what you assumed.

## Structure

Use `engineering_calc`, never memory:

- `imposed-floor-load` for the EN 1991-1-1 category
- `load-combination-uls` for 1.35 Gk + 1.5 Qk
- `load-udl-from-area` to turn an area load into a line load on a beam
- `second-moment-rect` and `section-modulus-rect` for the section
- `moment-udl-simple` and `deflection-udl-simple` for the span
- `deflection-limit` for what is permitted

Deflection, not strength, usually governs a timber floor. The deflection formula returns
the span ratio in its note — compare it against span/250 as a minimum and span/300 to
span/350 under imposed load.

## What to read next

- `references/construction.md` — walls, openings, stairs, roofs, and the symbol index.
- `references/standards.md` — EN and Eurocode clauses, and the standard dimensions.
- `references/physics.md` — U-values, heat loss, condensation, ventilation, daylight.
