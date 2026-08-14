import type { Entity, Pt } from "../schema.ts"
import type { BlueprintSymbol, SymbolLibrary } from "./index.ts"

/**
 * Architectural plan symbols at real size, in millimetres — unlike the schematic
 * libraries there is no grid here, because a floor plan is drawn 1:1 and printed at a
 * scale. Nominal sizes follow the EN/ISO ranges common in European construction; where a
 * symbol has a size worth arguing about, `describe` says which one it was drawn at so it
 * can be scaled or replaced rather than trusted blindly.
 *
 * Origin conventions, so a placement lands predictably:
 *  - openings (doors, windows): origin at the middle of the opening, on the wall centreline,
 *    with the wall running along X. Rotate to suit the wall.
 *  - fittings and furniture: origin at the centre of the footprint.
 *  - annotation: origin at the point being annotated.
 */

const line = (a: Pt, b: Pt): Entity => ({ type: "line", a, b })
const poly = (pts: Pt[], closed?: boolean): Entity => ({ type: "polyline", pts, ...(closed ? { closed } : {}) })
const box = (w: number, h: number, at: Pt = [-w / 2, -h / 2], rx?: number): Entity => ({
  type: "rect",
  at,
  w,
  h,
  ...(rx ? { rx } : {}),
})
const ring = (c: Pt, r: number): Entity => ({ type: "circle", c, r })
const arc = (c: Pt, r: number, a0: number, a1: number): Entity => ({ type: "arc", c, r, a0, a1 })
const text = (value: string, at: Pt, size = 100): Entity => ({ type: "text", at, text: value, size })
const dashed = (a: Pt, b: Pt): Entity => ({ type: "line", a, b, dash: "dashed" })

/** Default wall thickness these symbols were drawn against: a 100 mm partition. */
const WALL = 100

/**
 * The two faces of a wall opening: the wall is cut, so the opening shows the reveals.
 * `w` is the structural opening, `t` the wall thickness.
 */
const reveals = (w: number, t: number): Entity[] => [
  line([-w / 2, -t / 2], [-w / 2, t / 2]),
  line([w / 2, -t / 2], [w / 2, t / 2]),
]

// ─── walls, structure and openings ───────────────────────────────────────────────────

const structure: SymbolLibrary = {
  "wall-end": {
    describe: "Wall end / stub, 100 mm. Two faces and a closing return",
    entities: [poly([[-500, -WALL / 2], [0, -WALL / 2], [0, WALL / 2], [-500, WALL / 2]])],
    ports: [[-500, 0]],
  },
  "wall-junction-l": {
    describe: "Corner junction of two 100 mm walls",
    entities: [
      poly([[-500, -WALL / 2], [WALL / 2, -WALL / 2], [WALL / 2, 500]]),
      poly([[-500, WALL / 2], [-WALL / 2, WALL / 2], [-WALL / 2, 500]]),
    ],
    ports: [
      [-500, 0],
      [0, 500],
    ],
  },
  "wall-junction-t": {
    describe: "T junction of 100 mm walls",
    entities: [
      line([-500, -WALL / 2], [500, -WALL / 2]),
      poly([[-500, WALL / 2], [-WALL / 2, WALL / 2], [-WALL / 2, 500]]),
      poly([[500, WALL / 2], [WALL / 2, WALL / 2], [WALL / 2, 500]]),
    ],
    ports: [
      [-500, 0],
      [500, 0],
      [0, 500],
    ],
  },
  "wall-junction-x": {
    describe: "Crossing junction of 100 mm walls",
    entities: [
      poly([[-500, -WALL / 2], [-WALL / 2, -WALL / 2], [-WALL / 2, -500]]),
      poly([[500, -WALL / 2], [WALL / 2, -WALL / 2], [WALL / 2, -500]]),
      poly([[-500, WALL / 2], [-WALL / 2, WALL / 2], [-WALL / 2, 500]]),
      poly([[500, WALL / 2], [WALL / 2, WALL / 2], [WALL / 2, 500]]),
    ],
    ports: [
      [-500, 0],
      [500, 0],
      [0, -500],
      [0, 500],
    ],
  },
  "column-square": {
    describe: "Square column, 300 × 300 mm. Scale to the real section",
    entities: [box(300, 300)],
  },
  "column-round": {
    describe: "Circular column, 300 mm diameter",
    entities: [ring([0, 0], 150)],
  },
  "column-steel-i": {
    describe: "Steel I-section column, 200 mm nominal. Scale to the real serial size",
    entities: [poly([[-100, -100], [100, -100], [100, -80], [15, -80], [15, 80], [100, 80], [100, 100], [-100, 100], [-100, 80], [-15, 80], [-15, -80], [-100, -80]], true)],
  },
  "beam-over": {
    describe: "Beam or lintel above the cut plane, drawn dashed. Scale to the real span",
    entities: [dashed([-1500, -125], [1500, -125]), dashed([-1500, 125], [1500, 125])],
    ports: [
      [-1500, 0],
      [1500, 0],
    ],
  },
  "slab-edge": {
    describe: "Slab edge / change of level",
    entities: [line([-2000, 0], [2000, 0]), dashed([-2000, 60], [2000, 60])],
  },
  "expansion-joint": {
    describe: "Movement / expansion joint",
    entities: [line([0, -1000], [0, 1000]), dashed([-40, -1000], [-40, 1000]), dashed([40, -1000], [40, 1000])],
  },
  "damp-course": {
    describe: "Damp-proof course marker on a section",
    entities: [{ type: "line", a: [-800, 0], b: [800, 0], width: 1.6 }, text("DPC", [-140, -60], 90)],
  },
}

// ─── doors ───────────────────────────────────────────────────────────────────────────

/**
 * A hinged door: the leaf plus its swing arc. `hand` is which side the hinge is on
 * looking along +X; the leaf opens into +Y, so rotate the placement to change which room
 * it swings into.
 */
function hinged(w: number, describe: string, hand: "left" | "right", t = WALL): BlueprintSymbol {
  const hinge = hand === "left" ? -w / 2 : w / 2
  return {
    describe,
    entities: [
      ...reveals(w, t),
      // The leaf, drawn open at 90°, heavier than the swing arc so it reads as the door.
      { type: "line", a: [hinge, 0], b: [hinge, w], width: 1.2 },
      arc([hinge, 0], w, hand === "left" ? 0 : 90, hand === "left" ? 90 : 180),
      // The threshold across the opening.
      line([-w / 2, 0], [w / 2, 0]),
    ],
    ports: [
      [-w / 2, 0],
      [w / 2, 0],
    ],
  }
}

const doors: SymbolLibrary = {
  "door-single-left": hinged(900, "Single door 900 mm, hinged left. EN clear width 900 nominal", "left"),
  "door-single-right": hinged(900, "Single door 900 mm, hinged right", "right"),
  "door-800": hinged(800, "Single door 800 mm — the usual accessible minimum clear opening", "left"),
  "door-700": hinged(700, "Single door 700 mm, for a store or WC. Below accessible minimum", "left"),
  "door-1000": hinged(1000, "Single door 1000 mm, accessible / main entrance", "left"),
  "door-double": {
    describe: "Double door, 1800 mm overall (2 × 900). Both leaves swing the same way",
    entities: [
      ...reveals(1800, WALL),
      { type: "line", a: [-900, 0], b: [-900, 900], width: 1.2 },
      arc([-900, 0], 900, 0, 90),
      { type: "line", a: [900, 0], b: [900, 900], width: 1.2 },
      arc([900, 0], 900, 90, 180),
    ],
    ports: [
      [-900, 0],
      [900, 0],
    ],
  },
  "door-double-swing": {
    describe: "Double-swing door: leaf shown both ways",
    entities: [
      ...reveals(900, WALL),
      { type: "line", a: [-450, 0], b: [-450, 900], width: 1.2 },
      arc([-450, 0], 900, 0, 90),
      arc([-450, 0], 900, 270, 360),
    ],
    ports: [
      [-450, 0],
      [450, 0],
    ],
  },
  "door-sliding": {
    describe: "Sliding door, 900 mm leaf, surface-mounted",
    entities: [
      ...reveals(900, WALL),
      { type: "rect", at: [-450, -WALL / 2 - 60], w: 900, h: 50 },
      dashed([-1350, -WALL / 2 - 35], [450, -WALL / 2 - 35]),
    ],
    ports: [
      [-450, 0],
      [450, 0],
    ],
  },
  "door-sliding-pocket": {
    describe: "Pocket sliding door: the leaf disappears into the wall",
    entities: [
      ...reveals(900, WALL),
      { type: "rect", at: [-450, -25], w: 900, h: 50 },
      dashed([-1350, -WALL / 2], [-450, -WALL / 2]),
      dashed([-1350, WALL / 2], [-450, WALL / 2]),
      dashed([-1350, -WALL / 2], [-1350, WALL / 2]),
    ],
    ports: [
      [-450, 0],
      [450, 0],
    ],
  },
  "door-bifold": {
    describe: "Bi-fold door, 900 mm opening, two leaves",
    entities: [
      ...reveals(900, WALL),
      poly([[-450, 0], [-225, 450], [0, 0]]),
      { type: "line", a: [-450, 0], b: [-225, 450], width: 1.2 },
    ],
    ports: [
      [-450, 0],
      [450, 0],
    ],
  },
  "door-revolving": {
    describe: "Revolving door, 2000 mm diameter",
    entities: [ring([0, 0], 1000), line([-1000, 0], [1000, 0]), line([0, -1000], [0, 1000]), arc([0, 0], 1150, -60, 60), arc([0, 0], 1150, 120, 240)],
    ports: [
      [-1150, 0],
      [1150, 0],
    ],
  },
  "door-fire": {
    describe: "Fire door, 900 mm, self-closing. Label with the rating, e.g. EI30 or EI60",
    entities: [...hinged(900, "", "left").entities, text("FD", [-560, -140], 120)],
    ports: [
      [-450, 0],
      [450, 0],
    ],
  },
  "door-garage": {
    describe: "Up-and-over / sectional garage door, 2400 mm",
    entities: [...reveals(2400, 200), { type: "rect", at: [-1200, -100], w: 2400, h: 60 }, dashed([-1200, -100], [-1200, -900]), dashed([1200, -100], [1200, -900]), dashed([-1200, -900], [1200, -900])],
    ports: [
      [-1200, 0],
      [1200, 0],
    ],
  },
  "opening-no-door": {
    describe: "Structural opening with no door",
    entities: reveals(1000, WALL),
    ports: [
      [-500, 0],
      [500, 0],
    ],
  },
  hatch: {
    describe: "Access hatch, 600 × 600 mm, dashed because it is overhead",
    entities: [{ type: "rect", at: [-300, -300], w: 600, h: 600, dash: "dashed" }, dashed([-300, -300], [300, 300])],
  },
}

// ─── windows ─────────────────────────────────────────────────────────────────────────

/** A window in a cut wall: the reveals plus the glazing line(s) across the opening. */
function window(w: number, describe: string, panes = 1, t = WALL): BlueprintSymbol {
  const glass: Entity[] = [line([-w / 2, -t / 6], [w / 2, -t / 6]), line([-w / 2, t / 6], [w / 2, t / 6])]
  const mullions: Entity[] = []
  for (let i = 1; i < panes; i++) {
    const x = -w / 2 + (w / panes) * i
    mullions.push(line([x, -t / 2], [x, t / 2]))
  }
  return {
    describe,
    entities: [...reveals(w, t), ...glass, ...mullions],
    ports: [
      [-w / 2, 0],
      [w / 2, 0],
    ],
  }
}

const windows: SymbolLibrary = {
  "window-600": window(600, "Window, 600 mm — a small or WC window", 1),
  "window-900": window(900, "Window, 900 mm", 1),
  "window-1200": window(1200, "Window, 1200 mm, single light", 1),
  "window-1500": window(1500, "Window, 1500 mm, two lights", 2),
  "window-1800": window(1800, "Window, 1800 mm, three lights", 3),
  "window-2400": window(2400, "Window / glazed screen, 2400 mm, four lights", 4),
  "window-fixed": {
    describe: "Fixed light, 1200 mm — no opening sash",
    entities: [...reveals(1200, WALL), line([-600, 0], [600, 0])],
    ports: [
      [-600, 0],
      [600, 0],
    ],
  },
  "window-casement": {
    describe: "Casement window 1200 mm, showing the opening sash swing",
    entities: [...window(1200, "", 1).entities, arc([-600, 0], 600, 270, 360), line([-600, 0], [-600, -600])],
    ports: [
      [-600, 0],
      [600, 0],
    ],
  },
  "window-bay": {
    describe: "Bay window, 2400 mm across the face, 600 mm projection",
    entities: [poly([[-1800, 0], [-1200, -600], [1200, -600], [1800, 0]]), poly([[-1800, WALL / 2], [-1150, -520], [1150, -520], [1800, WALL / 2]])],
    ports: [
      [-1800, 0],
      [1800, 0],
    ],
  },
  "window-corner": {
    describe: "Corner window returning around a junction",
    entities: [...reveals(1200, WALL), line([-600, 0], [600, 0]), line([600, 0], [600, 1200]), line([600 - WALL / 2, WALL / 2], [600 - WALL / 2, 1200])],
    ports: [
      [-600, 0],
      [600, 1200],
    ],
  },
  rooflight: {
    describe: "Rooflight above, dashed because it is over the cut plane",
    entities: [{ type: "rect", at: [-600, -450], w: 1200, h: 900, dash: "dashed" }, dashed([-600, -450], [600, 450]), dashed([-600, 450], [600, -450])],
  },
}

// ─── stairs, ramps and vertical circulation ──────────────────────────────────────────

/** A straight flight: `n` treads of `going` mm, `w` wide, running along +X. */
function flight(n: number, going: number, w: number, describe: string): BlueprintSymbol {
  const length = n * going
  const treads: Entity[] = []
  for (let i = 1; i < n; i++) treads.push(line([i * going, -w / 2], [i * going, w / 2]))
  return {
    describe,
    entities: [
      box(length, w, [0, -w / 2]),
      ...treads,
      // Direction of travel: the arrow points up the flight, from the bottom riser.
      line([going / 2, 0], [length - going / 2, 0]),
      poly([[length - going / 2 - 120, -70], [length - going / 2, 0], [length - going / 2 - 120, 70]]),
      text("UP", [going / 2, -w / 2 - 60], 120),
    ],
    ports: [
      [0, 0],
      [length, 0],
    ],
  }
}

const stairs: SymbolLibrary = {
  "stair-straight": flight(13, 250, 1000, "Straight flight, 13 treads at 250 mm going, 1000 mm wide"),
  "stair-straight-short": flight(6, 250, 1000, "Short straight flight, 6 treads — a half-storey run"),
  "stair-quarter": {
    describe: "Quarter-turn stair with a 1000 mm landing, 1000 mm flights",
    entities: [
      box(1750, 1000, [0, -500]),
      ...[1, 2, 3, 4, 5, 6].map((i) => line([i * 250, -500], [i * 250, 500])),
      box(1000, 1750, [750, -500]),
      ...[1, 2, 3].map((i) => line([750, 500 + i * 250], [1750, 500 + i * 250])),
      line([125, 0], [1250, 0]),
      line([1250, 0], [1250, 1125]),
      poly([[1180, 1005], [1250, 1125], [1320, 1005]]),
      text("UP", [125, -560], 120),
    ],
    ports: [
      [0, 0],
      [1250, 1250],
    ],
  },
  "stair-half": {
    describe: "Half-turn (dog-leg) stair, two 1000 mm flights around a 1000 mm landing",
    entities: [
      box(2500, 1000, [0, -1000]),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => line([i * 250, -1000], [i * 250, 0])),
      box(2500, 1000, [0, 0]),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => line([i * 250, 0], [i * 250, 1000])),
      box(500, 2000, [2500, -1000]),
      line([125, -500], [2750, -500]),
      line([2750, -500], [2750, 500]),
      line([2750, 500], [125, 500]),
      poly([[245, 430], [125, 500], [245, 570]]),
      text("UP", [125, -1060], 120),
    ],
    ports: [
      [0, -500],
      [0, 500],
    ],
  },
  "stair-spiral": {
    describe: "Spiral stair, 1600 mm diameter, 12 treads",
    entities: [
      ring([0, 0], 800),
      ring([0, 0], 100),
      ...Array.from({ length: 12 }, (_, i) => {
        const a = ((i * 360) / 12) * (Math.PI / 180)
        return line([100 * Math.cos(a), 100 * Math.sin(a)], [800 * Math.cos(a), 800 * Math.sin(a)])
      }),
      text("UP", [-120, -900], 120),
    ],
  },
  ramp: {
    describe: "Ramp, 1200 mm wide. Draw the length for the gradient you need — 1:20 needs 20 × the rise",
    entities: [
      box(3000, 1200, [0, -600]),
      line([150, 0], [2850, 0]),
      poly([[2730, -70], [2850, 0], [2730, 70]]),
      text("RAMP UP 1:20", [150, -660], 120),
    ],
    ports: [
      [0, 0],
      [3000, 0],
    ],
  },
  "ramp-accessible": {
    describe: "Accessible ramp with landings, 1500 mm wide, 1:12 maximum",
    entities: [
      box(1500, 1500, [-750, -750]),
      box(6000, 1500, [750, -750]),
      box(1500, 1500, [6750, -750]),
      line([0, 0], [7500, 0]),
      poly([[7380, -70], [7500, 0], [7380, 70]]),
      text("1:12", [3000, -810], 120),
    ],
    ports: [
      [-750, 0],
      [8250, 0],
    ],
  },
  lift: {
    describe: "Passenger lift car, 1100 × 1400 mm (EN 81-70 type 1 accessible)",
    entities: [box(1100, 1400), line([-550, -700], [550, 700]), line([-550, 700], [550, -700]), line([-550, 700], [550, 700]), text("LIFT", [-260, 40], 140)],
  },
  "lift-goods": {
    describe: "Goods lift, 1600 × 2100 mm",
    entities: [box(1600, 2100), line([-800, -1050], [800, 1050]), line([-800, 1050], [800, -1050])],
  },
  escalator: {
    describe: "Escalator, 1000 mm wide",
    entities: [box(6000, 1000, [0, -500]), ...Array.from({ length: 11 }, (_, i) => line([(i + 1) * 500, -500], [(i + 1) * 500, 500])), line([250, 0], [5750, 0]), poly([[5630, -70], [5750, 0], [5630, 70]])],
    ports: [
      [0, 0],
      [6000, 0],
    ],
  },
  ladder: {
    describe: "Fixed ladder, 450 mm wide",
    entities: [line([-225, 0], [-225, 1200]), line([225, 0], [225, 1200]), ...Array.from({ length: 5 }, (_, i) => line([-225, (i + 1) * 200], [225, (i + 1) * 200]))],
  },
}

// ─── sanitary fittings ───────────────────────────────────────────────────────────────

const sanitary: SymbolLibrary = {
  wc: {
    describe: "WC pan and cistern, 700 mm projection. Origin at the centre of the pan",
    entities: [box(360, 180, [-180, -350]), { type: "rect", at: [-190, -170], w: 380, h: 520, rx: 170 }, ring([0, 90], 110)],
  },
  "wc-accessible": {
    describe: "Accessible WC with 1500 mm transfer clear space to one side",
    entities: [box(360, 180, [-180, -350]), { type: "rect", at: [-190, -170], w: 380, h: 520, rx: 170 }, { type: "rect", at: [190, -350], w: 1500, h: 1500, dash: "dashed" }],
  },
  bidet: {
    describe: "Bidet, 360 × 550 mm",
    entities: [{ type: "rect", at: [-180, -275], w: 360, h: 550, rx: 160 }, ring([0, 60], 90)],
  },
  urinal: {
    describe: "Wall-hung urinal bowl, 400 mm wide",
    entities: [{ type: "rect", at: [-200, -175], w: 400, h: 350, rx: 120 }, arc([0, 0], 120, 0, 180)],
  },
  basin: {
    describe: "Wash basin, 550 × 450 mm",
    entities: [{ type: "rect", at: [-275, -225], w: 550, h: 450, rx: 60 }, { type: "circle", c: [0, 30], r: 150 }, ring([0, -170], 30)],
  },
  "basin-double": {
    describe: "Double wash basin on a 1400 mm vanity",
    entities: [box(1400, 500, [-700, -250]), { type: "circle", c: [-350, 20], r: 150 }, { type: "circle", c: [350, 20], r: 150 }],
  },
  "basin-corner": {
    describe: "Corner basin, 400 mm",
    entities: [poly([[-200, -200], [200, -200], [200, 200]], true), arc([0, -60], 150, 0, 180)],
  },
  bath: {
    describe: "Bath, 1700 × 700 mm (the common EN size)",
    entities: [{ type: "rect", at: [-850, -350], w: 1700, h: 700, rx: 60 }, { type: "rect", at: [-790, -290], w: 1580, h: 580, rx: 120 }, ring([-720, 0], 35)],
  },
  "bath-corner": {
    describe: "Corner bath, 1500 × 1500 mm",
    entities: [box(1500, 1500, [-750, -750]), arc([-750, -750], 1400, 0, 90), arc([-750, -750], 1340, 0, 90)],
  },
  shower: {
    describe: "Shower enclosure, 900 × 900 mm",
    entities: [box(900, 900), box(820, 820), ring([0, 0], 40), line([-410, -410], [410, 410])],
  },
  "shower-tray": {
    describe: "Shower tray, 1200 × 800 mm rectangular",
    entities: [box(1200, 800), box(1120, 720), ring([-460, 0], 40)],
  },
  "shower-walk-in": {
    describe: "Walk-in shower, 1400 × 900 mm with a single screen",
    entities: [box(1400, 900), { type: "line", a: [-700, -450], b: [-700, 450], width: 1.6 }, ring([600, 0], 40)],
  },
  "sink-single": {
    describe: "Kitchen sink, single bowl and drainer, 1000 × 500 mm",
    entities: [box(1000, 500, [-500, -250]), box(400, 380, [-460, -190]), ...[0, 1, 2].map((i) => line([50 + i * 120, -160], [50 + i * 120, 160]))],
  },
  "sink-double": {
    describe: "Kitchen sink, double bowl, 1200 × 500 mm",
    entities: [box(1200, 500, [-600, -250]), box(400, 380, [-560, -190]), box(400, 380, [-120, -190]), ...[0, 1, 2].map((i) => line([350 + i * 80, -160], [350 + i * 80, 160]))],
  },
  "floor-drain": {
    describe: "Floor gully / drain",
    entities: [ring([0, 0], 75), line([-53, -53], [53, 53]), line([-53, 53], [53, -53])],
  },
  "water-heater": {
    describe: "Unvented cylinder / water heater, 550 mm diameter",
    entities: [ring([0, 0], 275), text("HW", [-140, 40], 120)],
  },
  boiler: {
    describe: "Wall-hung boiler, 450 × 350 mm",
    entities: [box(450, 350), text("B", [-50, 50], 160)],
  },
  radiator: {
    describe: "Panel radiator, 1000 × 100 mm. Scale to the output you need",
    entities: [box(1000, 100, [-500, -50]), ...Array.from({ length: 9 }, (_, i) => line([-400 + i * 100, -50], [-400 + i * 100, 50]))],
  },
  "washing-machine": {
    describe: "Washing machine, 600 × 600 mm",
    entities: [box(600, 600), ring([0, 0], 200), text("W", [-60, 50], 140)],
  },
  dishwasher: {
    describe: "Dishwasher, 600 × 600 mm",
    entities: [box(600, 600), text("DW", [-140, 50], 140)],
  },
}

// ─── kitchen and appliances ──────────────────────────────────────────────────────────

const kitchen: SymbolLibrary = {
  "base-unit-600": {
    describe: "Kitchen base unit, 600 mm wide × 600 deep",
    entities: [box(600, 600, [-300, -300]), line([-300, 300], [300, 300])],
  },
  "base-unit-1000": {
    describe: "Kitchen base unit, 1000 mm wide",
    entities: [box(1000, 600, [-500, -300]), line([-500, 300], [500, 300]), line([0, -300], [0, 300])],
  },
  "wall-unit": {
    describe: "Kitchen wall unit above worktop, 600 × 300 mm, dashed because it is overhead",
    entities: [{ type: "rect", at: [-300, -150], w: 600, h: 300, dash: "dashed" }],
  },
  "corner-unit": {
    describe: "L-shaped corner base unit, 900 × 900 mm",
    entities: [poly([[-450, -450], [450, -450], [450, 150], [150, 150], [150, 450], [-450, 450]], true)],
  },
  "tall-unit": {
    describe: "Tall / larder unit, 600 × 600 mm",
    entities: [box(600, 600), line([-300, -300], [300, 300]), line([-300, 300], [300, -300])],
  },
  hob: {
    describe: "Four-ring hob, 600 × 520 mm",
    entities: [box(600, 520), ring([-140, -120], 90), ring([140, -120], 110), ring([-140, 120], 110), ring([140, 120], 90)],
  },
  "hob-5": {
    describe: "Five-ring hob, 900 × 520 mm",
    entities: [box(900, 520), ring([-280, -120], 90), ring([280, -120], 90), ring([-280, 120], 90), ring([280, 120], 90), ring([0, 0], 130)],
  },
  oven: {
    describe: "Built-in oven, 600 × 600 mm",
    entities: [box(600, 600), box(480, 480), line([-240, -180], [240, -180])],
  },
  cooker: {
    describe: "Freestanding cooker, 600 × 600 mm",
    entities: [box(600, 600), ring([-140, -140], 90), ring([140, -140], 90), ring([-140, 140], 90), ring([140, 140], 90), line([-300, 250], [300, 250])],
  },
  "range-cooker": {
    describe: "Range cooker, 900 × 600 mm",
    entities: [box(900, 600), ...[-300, -100, 100, 300].map((x) => ring([x, -120], 80)), line([-450, 180], [450, 180])],
  },
  fridge: {
    describe: "Under-counter fridge, 600 × 600 mm",
    entities: [box(600, 600), text("F", [-60, 60], 180)],
  },
  "fridge-freezer": {
    describe: "Fridge-freezer, 700 × 700 mm",
    entities: [box(700, 700), line([-350, 0], [350, 0]), text("F", [-70, -60], 160), text("FZ", [-110, 220], 160)],
  },
  "extractor-hood": {
    describe: "Extractor hood above the hob, 600 mm, dashed because it is overhead",
    entities: [{ type: "rect", at: [-300, -260], w: 600, h: 520, dash: "dashed" }, { type: "circle", c: [0, 0], r: 90, dash: "dashed" }],
  },
  worktop: {
    describe: "Worktop run, 2000 × 600 mm. Scale to the real run",
    entities: [box(2000, 600, [-1000, -300])],
  },
}

// ─── furniture ───────────────────────────────────────────────────────────────────────

const furniture: SymbolLibrary = {
  "bed-single": {
    describe: "Single bed, 900 × 2000 mm",
    entities: [box(900, 2000, [-450, -1000], 40), box(900, 300, [-450, -1000]), line([-450, -400], [450, -400])],
  },
  "bed-double": {
    describe: "Double bed, 1400 × 2000 mm",
    entities: [box(1400, 2000, [-700, -1000], 40), box(1400, 300, [-700, -1000]), line([-700, -400], [700, -400]), line([0, -1000], [0, -700])],
  },
  "bed-king": {
    describe: "King bed, 1800 × 2000 mm",
    entities: [box(1800, 2000, [-900, -1000], 40), box(1800, 300, [-900, -1000]), line([-900, -400], [900, -400]), line([0, -1000], [0, -700])],
  },
  "bed-bunk": {
    describe: "Bunk bed, 900 × 2000 mm footprint",
    entities: [box(900, 2000, [-450, -1000], 40), { type: "rect", at: [-410, -960], w: 820, h: 1920, rx: 40, dash: "dashed" }],
  },
  "sofa-2": {
    describe: "Two-seat sofa, 1600 × 900 mm",
    entities: [box(1600, 900, [-800, -450], 60), box(1600, 250, [-800, -450]), line([0, -200], [0, 450]), box(200, 650, [-800, -200]), box(200, 650, [600, -200])],
  },
  "sofa-3": {
    describe: "Three-seat sofa, 2100 × 900 mm",
    entities: [box(2100, 900, [-1050, -450], 60), box(2100, 250, [-1050, -450]), line([-350, -200], [-350, 450]), line([350, -200], [350, 450])],
  },
  "sofa-corner": {
    describe: "Corner sofa, 2400 × 2000 mm",
    entities: [poly([[-1200, -1000], [1200, -1000], [1200, -100], [0, -100], [0, 1000], [-1200, 1000]], true)],
  },
  armchair: {
    describe: "Armchair, 800 × 850 mm",
    entities: [box(800, 850, [-400, -425], 60), box(800, 220, [-400, -425]), box(160, 630, [-400, -205]), box(160, 630, [240, -205])],
  },
  "table-dining-4": {
    describe: "Dining table for four, 1200 × 800 mm, with chairs",
    entities: [box(1200, 800), box(450, 450, [-600 - 500, -225], 40), box(450, 450, [650, -225], 40), box(450, 450, [-225, -400 - 500], 40), box(450, 450, [-225, 450], 40)],
  },
  "table-dining-6": {
    describe: "Dining table for six, 1800 × 900 mm",
    entities: [box(1800, 900), ...[-550, 0, 550].flatMap((x) => [box(450, 450, [x - 225, -950], 40), box(450, 450, [x - 225, 500], 40)])],
  },
  "table-round": {
    describe: "Round dining table, 1200 mm diameter",
    entities: [ring([0, 0], 600), ...Array.from({ length: 4 }, (_, i) => {
      const a = ((i * 90 + 45) * Math.PI) / 180
      return box(450, 450, [850 * Math.cos(a) - 225, 850 * Math.sin(a) - 225], 40)
    })],
  },
  "table-coffee": {
    describe: "Coffee table, 1100 × 600 mm",
    entities: [box(1100, 600, [-550, -300], 40)],
  },
  desk: {
    describe: "Desk, 1400 × 700 mm, with a chair",
    entities: [box(1400, 700, [-700, -350]), ring([0, 550], 250)],
  },
  "desk-corner": {
    describe: "L-shaped corner desk, 1600 × 1600 mm",
    entities: [poly([[-800, -800], [800, -800], [800, -100], [-100, -100], [-100, 800], [-800, 800]], true)],
  },
  chair: {
    describe: "Chair, 450 × 450 mm",
    entities: [box(450, 450, [-225, -225], 40), line([-225, 175], [225, 175])],
  },
  wardrobe: {
    describe: "Wardrobe, 1200 × 600 mm",
    entities: [box(1200, 600, [-600, -300]), line([-600, -300], [-600, -900]), arc([-600, -300], 600, 270, 360), line([0, -300], [0, 300])],
  },
  "wardrobe-sliding": {
    describe: "Sliding-door wardrobe, 1800 × 600 mm",
    entities: [box(1800, 600, [-900, -300]), line([-900, -220], [0, -220]), line([0, -160], [900, -160])],
  },
  bookshelf: {
    describe: "Bookshelf, 900 × 300 mm",
    entities: [box(900, 300, [-450, -150]), ...[-150, 150].map((x) => line([x, -150], [x, 150]))],
  },
  "tv-unit": {
    describe: "TV unit, 1400 × 400 mm",
    entities: [box(1400, 400, [-700, -200]), { type: "rect", at: [-550, -160], w: 1100, h: 60 }],
  },
  "storage-unit": {
    describe: "Generic storage / shelving unit, 1000 × 400 mm",
    entities: [box(1000, 400, [-500, -200]), line([-500, -200], [500, 200])],
  },
}

// ─── annotation and site ─────────────────────────────────────────────────────────────

const annotation: SymbolLibrary = {
  "north-arrow": {
    describe: "North arrow. Rotate to match the site orientation",
    entities: [ring([0, 0], 400), poly([[0, -350], [140, 200], [0, 60], [-140, 200]], true), text("N", [-80, -450], 180)],
  },
  "section-marker": {
    describe: "Section cut marker. Place one at each end of the cut line and label them the same",
    entities: [ring([0, 0], 250), line([-250, 0], [250, 0]), text("A", [-90, -60], 200), line([0, 250], [0, 700]), poly([[-100, 500], [0, 250], [100, 500]], true)],
  },
  "elevation-marker": {
    describe: "Elevation reference marker",
    entities: [ring([0, 0], 250), poly([[-250, 0], [0, 320], [250, 0]], true), text("1", [-60, -60], 200)],
  },
  "level-marker": {
    describe: "Spot level / datum marker. Label with the level, e.g. +2.700",
    entities: [poly([[0, 0], [-180, -260], [180, -260]], true), line([-400, -260], [400, -260]), text("+0.000", [-380, -330], 140)],
  },
  "grid-bubble": {
    describe: "Structural grid reference bubble",
    entities: [ring([0, 0], 300), text("A", [-90, 70], 220), { type: "line", a: [0, 300], b: [0, 1500], dash: "dashed" }],
    ports: [[0, 1500]],
  },
  "detail-callout": {
    describe: "Detail callout: a circle around what is detailed elsewhere, with a leader",
    entities: [{ type: "circle", c: [0, 0], r: 500, dash: "dashed" }, line([354, -354], [900, -900]), ring([1150, -1150], 250), text("D1", [1000, -1090], 180)],
  },
  "room-tag": {
    describe: "Room name and area tag. Edit both text entities to suit",
    entities: [text("KITCHEN", [-400, -60], 180), text("12.4 m²", [-300, 180], 140), line([-450, 40], [450, 40])],
  },
  "scale-bar": {
    describe: "Graphic scale bar, 5 m in 1 m divisions. Only correct if placed at 1:1 model size",
    entities: [
      box(5000, 120, [0, -60]),
      ...[1, 2, 3, 4].map((i) => line([i * 1000, -60], [i * 1000, 60])),
      { type: "rect", at: [1000, -60], w: 1000, h: 120 },
      { type: "rect", at: [3000, -60], w: 1000, h: 120 },
      text("0", [-40, 260], 140),
      text("5 m", [4800, 260], 140),
    ],
  },
  "break-line": {
    describe: "Break line, for a run drawn shorter than it is",
    entities: [poly([[0, -600], [0, -100], [200, 0], [-200, 100], [0, 200], [0, 600]])],
  },
  "revision-cloud": {
    describe: "Revision cloud around changed work",
    entities: [
      ...Array.from({ length: 16 }, (_, i) => {
        const a = (i * 360) / 16
        const rad = (a * Math.PI) / 180
        return arc([700 * Math.cos(rad), 500 * Math.sin(rad)], 160, a - 150, a + 30)
      }),
    ],
  },
}

const site: SymbolLibrary = {
  tree: {
    describe: "Tree, broadleaf, 4 m canopy",
    entities: [
      ...Array.from({ length: 12 }, (_, i) => {
        const a = ((i * 360) / 12) * (Math.PI / 180)
        return arc([1700 * Math.cos(a), 1700 * Math.sin(a)], 400, (i * 360) / 12 - 150, (i * 360) / 12 + 30)
      }),
      ring([0, 0], 150),
    ],
  },
  "tree-conifer": {
    describe: "Conifer, 3 m canopy",
    entities: [ring([0, 0], 1500), ...Array.from({ length: 16 }, (_, i) => {
      const a = ((i * 360) / 16) * (Math.PI / 180)
      return line([400 * Math.cos(a), 400 * Math.sin(a)], [1500 * Math.cos(a), 1500 * Math.sin(a)])
    })],
  },
  shrub: {
    describe: "Shrub / planting, 1 m",
    entities: Array.from({ length: 8 }, (_, i) => {
      const a = ((i * 360) / 8) * (Math.PI / 180)
      return arc([350 * Math.cos(a), 350 * Math.sin(a)], 200, (i * 360) / 8 - 150, (i * 360) / 8 + 30)
    }),
  },
  hedge: {
    describe: "Hedge run, 600 mm wide × 3 m. Scale to the real length",
    entities: Array.from({ length: 10 }, (_, i) => ring([-1350 + i * 300, 0], 300)),
  },
  "parking-space": {
    describe: "Parking bay, 2500 × 5000 mm (EN standard car)",
    entities: [box(2500, 5000, [-1250, -2500])],
  },
  "parking-accessible": {
    describe: "Accessible parking bay, 3600 × 5000 mm including the transfer zone",
    entities: [box(2500, 5000, [-1800, -2500]), { type: "rect", at: [700, -2500], w: 1100, h: 5000, dash: "dashed" }, ring([-550, 0], 500)],
  },
  car: {
    describe: "Car, 1800 × 4400 mm",
    entities: [box(1800, 4400, [-900, -2200], 300), box(1400, 1100, [-700, -900], 150), line([-900, 900], [900, 900])],
  },
  kerb: {
    describe: "Kerb line, 125 mm upstand",
    entities: [line([-3000, 0], [3000, 0]), line([-3000, 125], [3000, 125])],
  },
  contour: {
    describe: "Site contour line. Label with the level",
    entities: [{ type: "path", d: [["M", -3000, 0], ["C", -1500, -600, 1500, 600, 3000, 0]], dash: "dashed" }],
  },
  "boundary-line": {
    describe: "Site boundary, chain-dashed",
    entities: [{ type: "line", a: [-3000, 0], b: [3000, 0], dash: "dashed", width: 1.6 }],
  },
  manhole: {
    describe: "Manhole / inspection chamber, 600 × 600 mm",
    entities: [box(600, 600), line([-300, -300], [300, 300]), line([-300, 300], [300, -300]), text("MH", [-160, 60], 140)],
  },
}

export const BUILDING: SymbolLibrary = {
  ...structure,
  ...doors,
  ...windows,
  ...stairs,
  ...sanitary,
  ...kitchen,
  ...furniture,
  ...annotation,
  ...site,
}
