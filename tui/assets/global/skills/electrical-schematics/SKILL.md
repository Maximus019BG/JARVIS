---
name: electrical-schematics
description: Drawing electrical schematics, single-line diagrams, panel layouts and installation plans to IEC standards — IEC 60617 symbols, cable sizing and voltage drop to IEC 60364, protection and RCD selection, earthing systems, and the annotation grammar that lets blueprint_check verify the design. Use whenever drawing a circuit, a wiring diagram, a consumer unit, a distribution board, a lighting or socket layout, or sizing a cable or a breaker.
---

# Electrical schematics

Metric and IEC throughout: 230 V line-to-neutral, 400 V line-to-line, conductors in mm²,
protective devices to IEC 60898/60947. **This is a drawing aid, not a design. Anything
that gets installed needs a competent person's sign-off.**

## Conventions (the same in every blueprint skill)

- **Y points down.** `[0, 10]` is below `[0, 0]`, like SVG.
- **Angles are degrees clockwise from +X.** 0° right, 90° down, 180° left, 270° up.
- Millimetres unless the drawing says otherwise. Never mix units in one sheet.
- Batch one whole feature per `blueprint_edit` or `blueprint_symbol` call, not one op per call.
- Explicit entity ids must **not** start with `e` followed by a digit — that is the
  automatic id space and reusing it corrupts the counter.
- Read the `blueprint-drafting` skill for coordinates, entity choice and dimensioning.

## The schematic grid

Schematic symbols are drawn on a **2.54 mm grid** — 0.1 inch, the pitch of every header
and DIP package. Put every symbol origin and every wire on a multiple of 2.54 and the
terminals meet. Off-grid work is the main reason a schematic ends up with wires that
nearly touch.

A two-terminal part (resistor, capacitor, diode, fuse) spans **20.32 mm** end to end, so
its ports sit at ±10.16 from its origin.

## The loop

1. `blueprint` `action: "create"` — A4 landscape `[0, 0, 297, 210]` suits most schematics.
2. `blueprint_symbol` `action: "list"` with a query to find the symbols you need.
3. `blueprint_symbol` `action: "place"` — every symbol of one circuit in a single call.
   It returns each symbol's **ports already transformed**; wire to those coordinates.
4. `blueprint_edit` to draw the wires between the ports it reported.
5. `engineering_calc` for every number. Do not work cable sizes out in your head.
6. Annotate (below), then `blueprint_check` `domain: "electrical"`.

## Placing and wiring

```json
{"action": "place", "name": "lighting", "placements": [
  {"symbol": "electrical/mcb-1p", "at": [40, 40], "label": "Q1"},
  {"symbol": "electrical/lamp",   "at": [100, 40], "label": "L1"},
  {"symbol": "electrical/ground", "at": [40, 120]}
]}
```

The reply lists `ports: 1:[40, 22.42]  2:[40, 57.58]` for each. Draw wires between those
exact numbers with `blueprint_edit`, and put a `junction-dot` wherever three or more wires
meet — a crossing with no dot means *not connected*, and that distinction is the whole
readability of a schematic.

Rotating a symbol rotates its ports with it, and the reply gives you the rotated
coordinates, so never re-derive them.

## Layers

One concern per layer, and **the names matter** — `blueprint_check` reads them:

| Layer name | Holds |
|---|---|
| `cables` or `circuits` | circuit annotations (see below) |
| `power` | supply, protection, distribution |
| `lighting` | luminaires and switching |
| `earth` or `supply` | earthing arrangement and its `system=` annotation |
| `labels` | references and values |
| `dimensions` | dimensions only, so a manufacturing view can hide them |

## Annotation grammar

`blueprint_check` has no way to know a line is a cable — the schema stores geometry, not
meaning. So the *kind* comes from the layer name and the *parameters* from a `text` entity
on that layer with this exact shape:

```
REF | key=value, key=value
```

A circuit on the `cables` layer:

```
W1 | mm2=2.5, A=16, m=30, mcb=16, use=sockets, rcd=30mA, ph=1, v=230
```

| Key | Means |
|---|---|
| `mm2` | conductor cross-section |
| `A` | design current Ib |
| `m` | one-way route length |
| `mcb` | rating of the protective device |
| `ph` | 1 or 3 phase (default 1) |
| `v` | nominal voltage (default 230, or 400 for `ph=3`) |
| `use` | what it serves — `lighting` is held to 3 % drop, anything else to 5 % |
| `rcd` | the RCD protecting it; required for sockets and wet locations |

Values that are not plain decimals stay text, so `rcd=30mA` and `addr=0x76` survive as
written. **Anything the checker cannot read is reported as NOT CHECKED, never as a pass** —
so an unannotated cable is not a clean bill of health.

## Sizing a cable

Never from memory. Three steps, all through `engineering_calc`:

1. **Design current** — `current-1ph` or `current-3ph` from the load.
2. **Cross-section for the volt drop** — `cable-csa-1ph` / `cable-csa-3ph`, with the
   permitted drop in volts (3 % of 230 V is 6.9 V for lighting, 5 % is 11.5 V otherwise).
   It rounds up to a real IEC 60228 size.
3. **Ampacity and coordination** — `protection-coordination` for `Ib ≤ In ≤ Iz`.
   `blueprint_check` compares against IEC 60364-5-52 Table B.52.4 reference method C
   (clipped direct, PVC, copper, 30 °C). **Any other installation method, grouping or
   ambient needs its own table and correction factors** — say so on the drawing.

Then `adiabatic-csa` for the protective conductor, and `max-loop-impedance` for the
disconnection time.

## Earthing

Declare the system once, on the `earth` layer: `TN-S | system=TN-S`, `TN-C-S`, or `TT`.
Two different systems on one installation is an error and the checker will say so.
`TT` normally needs RCD protection on everything, because the earth electrode impedance
will not operate an overcurrent device.

## What to read next

- `references/symbols.md` — the full IEC 60617 symbol index by name, and what each one's ports are.
- `references/calculations.md` — worked metric examples with the numbers ground out.
- `references/standards.md` — which IEC part covers what, and the clauses worth quoting.
