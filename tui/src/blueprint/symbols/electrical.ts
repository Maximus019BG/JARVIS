import type { Entity, Pt } from "../schema.ts"
import type { BlueprintSymbol, SymbolLibrary } from "./index.ts"

/**
 * IEC 60617 schematic and installation symbols, drawn on the 2.54 mm grid so a schematic
 * lines up with real header pitch. Origin is the centre of the body; a two-terminal part
 * spans 8 grid units end to end, which is the pitch these were all sized against.
 *
 * Where a symbol has a settled IEC reference it is cited. Where IEC leaves it to the
 * drawing (motors, meters, most installation symbols) the shape is the conventional one
 * and `standard` names the part of 60617 it belongs to rather than a specific figure.
 */

const U = 2.54
/** Half the end-to-end length of a two-terminal part: leads out to ±4 grid units. */
const SPAN = 4 * U
/** Half the body length of a two-terminal part. */
const BODY = 2 * U

const line = (a: Pt, b: Pt): Entity => ({ type: "line", a, b })
const poly = (pts: Pt[], closed?: boolean): Entity => ({ type: "polyline", pts, ...(closed ? { closed } : {}) })
const box = (w: number, h: number, at: Pt = [-w / 2, -h / 2]): Entity => ({ type: "rect", at, w, h })
const dot = (c: Pt, r = 0.6): Entity => ({ type: "circle", c, r, width: 1.2 })
const ring = (c: Pt, r: number): Entity => ({ type: "circle", c, r })
const arc = (c: Pt, r: number, a0: number, a1: number): Entity => ({ type: "arc", c, r, a0, a1 })
const text = (value: string, at: Pt, size = 2.5): Entity => ({ type: "text", at, text: value, size })

/** Leads from the body out to the terminals, for a part drawn along the x-axis. */
const leads = (half = BODY, span = SPAN): Entity[] => [line([-span, 0], [-half, 0]), line([half, 0], [span, 0])]

/** An arrowhead at `tip`, pointing along `deg` (clockwise from +X, because Y is down). */
function head(tip: Pt, deg: number, size = 1.8): Entity {
  const rad = (deg * Math.PI) / 180
  const back = (spread: number): Pt => [
    tip[0] - size * Math.cos(rad - spread),
    tip[1] - size * Math.sin(rad - spread),
  ]
  return poly([back(0.4), tip, back(-0.4)])
}

/** A two-terminal part: body entities, leads, and the two ports the wires attach to. */
const twoPin = (describe: string, body: Entity[], options: { standard?: string; half?: number } = {}): BlueprintSymbol => ({
  describe,
  standard: options.standard,
  entities: [...body, ...leads(options.half ?? BODY)],
  ports: [
    [-SPAN, 0],
    [SPAN, 0],
  ],
})

/** The zig-zag alternative resistor body, kept for schematics drawn in the US style. */
function zigzag(half: number, amp: number, peaks: number): Entity {
  const pts: Pt[] = [[-half, 0]]
  const step = (2 * half) / (peaks + 1)
  for (let i = 0; i < peaks; i++) pts.push([-half + step * (i + 1), i % 2 === 0 ? -amp : amp])
  pts.push([half, 0])
  return poly(pts)
}

/**
 * `n` half-circle bumps, which is how IEC draws a winding. `up` puts them above the axis
 * (negative Y); a transformer needs one winding of each so the two face the core.
 */
function coil(n: number, r: number, y = 0, up = true): Entity[] {
  const bumps: Entity[] = []
  for (let i = 0; i < n; i++) bumps.push(arc([-(n - 1) * r + 2 * r * i, y], r, up ? 180 : 0, up ? 360 : 180))
  return bumps
}

/** A NO contact: two terminals and a blade lifted off the fixed one. */
const bladeOpen: Entity[] = [line([-BODY, 0], [-1, 0]), line([1, 0], [BODY, 0]), line([-1, 0], [BODY - 0.5, -3.6])]
const bladeClosed: Entity[] = [line([-BODY, 0], [BODY, 0])]

/** The rounded-corner enclosure IEC uses to say "this is one assembly". */
const enclosure = (w: number, h: number): Entity => ({ type: "rect", at: [-w / 2, -h / 2], w, h, dash: "dashed" })

// ─── passives ────────────────────────────────────────────────────────────────────────

const passives: SymbolLibrary = {
  resistor: twoPin("Resistor, IEC rectangular body", [box(2 * BODY, 3.81)], { standard: "IEC 60617-4 S00200" }),
  "resistor-zigzag": twoPin("Resistor, zig-zag body (ANSI style, for mixed-convention drawings)", [
    zigzag(BODY, 1.9, 6),
  ]),
  "resistor-variable": twoPin(
    "Variable resistor / rheostat: resistor with a diagonal adjustment arrow",
    [box(2 * BODY, 3.81), line([-BODY - 1.5, 3.5], [BODY + 1.5, -3.5]), head([BODY + 1.5, -3.5], -45)],
    { standard: "IEC 60617-4 S00204" },
  ),
  potentiometer: {
    describe: "Potentiometer: resistor with a wiper. Ports: 1 end, 2 wiper, 3 end",
    standard: "IEC 60617-4 S00206",
    entities: [box(2 * BODY, 3.81), ...leads(), line([0, -SPAN], [0, -1.9 - 1.5]), head([0, -1.9 - 1.5], 90)],
    ports: [
      [-SPAN, 0],
      [0, -SPAN],
      [SPAN, 0],
    ],
  },
  thermistor: twoPin(
    "Thermistor (NTC/PTC): resistor with a temperature-dependence stroke",
    [box(2 * BODY, 3.81), poly([[-BODY - 1.5, 3.5], [-BODY + 0.5, 3.5], [BODY + 1.5, -3.5]])],
    { standard: "IEC 60617-4 S00220" },
  ),
  varistor: twoPin("Varistor / MOV: voltage-dependent resistor", [
    box(2 * BODY, 3.81),
    poly([[-BODY - 1.5, 3.5], [-BODY + 0.5, 3.5], [BODY + 1.5, -3.5]]),
    text("U", [-BODY - 1.2, -2.2], 2),
  ]),
  ldr: twoPin("Light-dependent resistor", [
    box(2 * BODY, 3.81),
    line([-3, -8], [-1, -5.2]),
    head([-1, -5.2], 54),
    line([1, -8], [3, -5.2]),
    head([3, -5.2], 54),
  ]),
  capacitor: twoPin(
    "Capacitor, non-polarised: two parallel plates",
    [line([-0.9, -3.5], [-0.9, 3.5]), line([0.9, -3.5], [0.9, 3.5])],
    { standard: "IEC 60617-4 S00250", half: 0.9 },
  ),
  "capacitor-polarised": twoPin(
    "Electrolytic capacitor: straight plate positive, curved plate negative",
    [line([-0.9, -3.5], [-0.9, 3.5]), arc([-3.4, 0], 4.3, -55, 55), text("+", [-4.2, -4], 2.4)],
    { standard: "IEC 60617-4 S00253", half: 0.9 },
  ),
  "capacitor-variable": twoPin(
    "Variable capacitor / trimmer",
    [
      line([-0.9, -3.5], [-0.9, 3.5]),
      line([0.9, -3.5], [0.9, 3.5]),
      line([-4, 4], [4, -4]),
      head([4, -4], -45),
    ],
    { half: 0.9 },
  ),
  inductor: twoPin("Inductor / coil: four half-circle bumps", coil(4, 1.6), {
    standard: "IEC 60617-4 S00300",
    half: 4 * 1.6,
  }),
  "inductor-core": twoPin(
    "Inductor with ferromagnetic core",
    [...coil(4, 1.6), line([-6.4, 2.2], [6.4, 2.2])],
    { standard: "IEC 60617-4 S00303", half: 4 * 1.6 },
  ),
  "inductor-variable": twoPin(
    "Variable inductor",
    [...coil(4, 1.6), line([-7.5, 4], [7.5, -4]), head([7.5, -4], -28)],
    { half: 4 * 1.6 },
  ),
  crystal: twoPin(
    "Quartz crystal",
    [box(3.2, 6.4), line([-2.4, -3.6], [-2.4, 3.6]), line([2.4, -3.6], [2.4, 3.6])],
    { standard: "IEC 60617-4 S00332", half: 2.4 },
  ),
  ferrite: twoPin("Ferrite bead", [box(2 * BODY, 3.81), line([-BODY, -1.9], [BODY, -1.9])]),
}

// ─── semiconductors ──────────────────────────────────────────────────────────────────

/** The diode triangle plus its cathode bar, pointing +X. Anode is the -X port. */
const diodeBody: Entity[] = [poly([[-2.2, -2.6], [2.2, 0], [-2.2, 2.6]], true), line([2.2, -2.8], [2.2, 2.8])]

const semiconductors: SymbolLibrary = {
  diode: twoPin("Diode. Port 1 anode, port 2 cathode", diodeBody, { standard: "IEC 60617-5 S00550", half: 2.2 }),
  "diode-zener": twoPin(
    "Zener diode",
    [poly([[-2.2, -2.6], [2.2, 0], [-2.2, 2.6]], true), poly([[1.2, -2.8], [2.2, -2.8], [2.2, 2.8], [3.2, 2.8]])],
    { standard: "IEC 60617-5 S00552", half: 2.2 },
  ),
  "diode-schottky": twoPin(
    "Schottky diode",
    [
      poly([[-2.2, -2.6], [2.2, 0], [-2.2, 2.6]], true),
      poly([[1.2, -1.8], [1.2, -2.8], [2.2, -2.8], [2.2, 2.8], [3.2, 2.8], [3.2, 1.8]]),
    ],
    { half: 2.2 },
  ),
  "diode-tvs": twoPin(
    "Bidirectional TVS / transient suppressor",
    [poly([[-2.2, -2.6], [2.2, 0], [-2.2, 2.6]], true), poly([[2.2, 0], [6.6, -2.6], [6.6, 2.6]], true)],
    { half: 2.2 },
  ),
  led: twoPin(
    "Light-emitting diode",
    [...diodeBody, line([0, -4], [2.4, -6.8]), head([2.4, -6.8], -49), line([2.6, -3.4], [5, -6.2]), head([5, -6.2], -49)],
    { standard: "IEC 60617-5 S00554", half: 2.2 },
  ),
  photodiode: twoPin(
    "Photodiode",
    [...diodeBody, line([2.4, -6.8], [0, -4]), head([0, -4], 131), line([5, -6.2], [2.6, -3.4]), head([2.6, -3.4], 131)],
    { half: 2.2 },
  ),
  "bridge-rectifier": {
    describe: "Bridge rectifier. Ports: 1 AC, 2 AC, 3 +, 4 −",
    entities: [
      box(2 * SPAN, 2 * SPAN),
      poly([[-3, 0], [0, -3], [3, 0], [0, 3]], true),
      poly([[-1.4, -1.4], [1.4, 0], [-1.4, 1.4]], true),
      line([1.4, -1.6], [1.4, 1.6]),
      text("+", [SPAN - 3.6, -SPAN + 3.2], 2.2),
      text("~", [-SPAN + 1.2, -SPAN + 3.2], 2.2),
    ],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
      [0, -SPAN],
      [0, SPAN],
    ],
  },
  "bjt-npn": {
    describe: "NPN bipolar transistor. Ports: 1 base, 2 collector, 3 emitter",
    standard: "IEC 60617-5 S00600",
    entities: [
      ring([0, 0], 6.35),
      line([-2, -4], [-2, 4]),
      line([-SPAN - 2.35, 0], [-2, 0]),
      line([-2, -2], [3.2, -5.2]),
      line([-2, 2], [3.2, 5.2]),
      line([3.2, -5.2], [3.2, -SPAN - 2.35]),
      line([3.2, 5.2], [3.2, SPAN + 2.35]),
      head([3.2, 5.2], 32),
    ],
    ports: [
      [-SPAN - 2.35, 0],
      [3.2, -SPAN - 2.35],
      [3.2, SPAN + 2.35],
    ],
  },
  "bjt-pnp": {
    describe: "PNP bipolar transistor. Ports: 1 base, 2 collector, 3 emitter",
    standard: "IEC 60617-5 S00601",
    entities: [
      ring([0, 0], 6.35),
      line([-2, -4], [-2, 4]),
      line([-SPAN - 2.35, 0], [-2, 0]),
      line([-2, -2], [3.2, -5.2]),
      line([-2, 2], [3.2, 5.2]),
      line([3.2, -5.2], [3.2, -SPAN - 2.35]),
      line([3.2, 5.2], [3.2, SPAN + 2.35]),
      head([-2, 2], 212),
    ],
    ports: [
      [-SPAN - 2.35, 0],
      [3.2, -SPAN - 2.35],
      [3.2, SPAN + 2.35],
    ],
  },
  "mosfet-n": {
    describe: "N-channel enhancement MOSFET. Ports: 1 gate, 2 drain, 3 source",
    standard: "IEC 60617-5 S00620",
    entities: [
      ring([0, 0], 6.35),
      line([-3.2, -4], [-3.2, 4]),
      line([-SPAN - 2.35, 0], [-3.2, 0]),
      line([-1.4, -4.2], [-1.4, -1.6]),
      line([-1.4, -1.2], [-1.4, 1.2]),
      line([-1.4, 1.6], [-1.4, 4.2]),
      line([-1.4, -3], [3.2, -3]),
      line([-1.4, 3], [3.2, 3]),
      line([-1.4, 0], [3.2, 0]),
      line([3.2, -3], [3.2, -SPAN - 2.35]),
      line([3.2, 0], [3.2, 3]),
      line([3.2, 3], [3.2, SPAN + 2.35]),
      head([-1.4, 0], 180),
    ],
    ports: [
      [-SPAN - 2.35, 0],
      [3.2, -SPAN - 2.35],
      [3.2, SPAN + 2.35],
    ],
  },
  "mosfet-p": {
    describe: "P-channel enhancement MOSFET. Ports: 1 gate, 2 drain, 3 source",
    standard: "IEC 60617-5 S00621",
    entities: [
      ring([0, 0], 6.35),
      line([-3.2, -4], [-3.2, 4]),
      line([-SPAN - 2.35, 0], [-3.2, 0]),
      line([-1.4, -4.2], [-1.4, -1.6]),
      line([-1.4, -1.2], [-1.4, 1.2]),
      line([-1.4, 1.6], [-1.4, 4.2]),
      line([-1.4, -3], [3.2, -3]),
      line([-1.4, 3], [3.2, 3]),
      line([-1.4, 0], [3.2, 0]),
      line([3.2, -3], [3.2, -SPAN - 2.35]),
      line([3.2, 0], [3.2, 3]),
      line([3.2, 3], [3.2, SPAN + 2.35]),
      head([3.2, 0], 0),
    ],
    ports: [
      [-SPAN - 2.35, 0],
      [3.2, -SPAN - 2.35],
      [3.2, SPAN + 2.35],
    ],
  },
  "jfet-n": {
    describe: "N-channel JFET. Ports: 1 gate, 2 drain, 3 source",
    entities: [
      ring([0, 0], 6.35),
      line([-1.4, -4.2], [-1.4, 4.2]),
      line([-SPAN - 2.35, 0], [-1.4, 0]),
      head([-1.4, 0], 0),
      line([-1.4, -3], [3.2, -3]),
      line([-1.4, 3], [3.2, 3]),
      line([3.2, -3], [3.2, -SPAN - 2.35]),
      line([3.2, 3], [3.2, SPAN + 2.35]),
    ],
    ports: [
      [-SPAN - 2.35, 0],
      [3.2, -SPAN - 2.35],
      [3.2, SPAN + 2.35],
    ],
  },
  thyristor: {
    describe: "Thyristor / SCR. Ports: 1 anode, 2 cathode, 3 gate",
    standard: "IEC 60617-5 S00570",
    entities: [...diodeBody, ...leads(2.2), line([2.2, 1.4], [5.2, 4.4]), line([5.2, 4.4], [5.2, SPAN + 2])],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
      [5.2, SPAN + 2],
    ],
  },
  triac: {
    describe: "Triac. Ports: 1 MT1, 2 MT2, 3 gate",
    standard: "IEC 60617-5 S00575",
    entities: [
      poly([[-2.2, -2.6], [2.2, -2.6], [0, 0]], true),
      poly([[-2.2, 2.6], [2.2, 2.6], [0, 0]], true),
      line([-2.6, -2.6], [-2.6, 2.6]),
      line([2.6, -2.6], [2.6, 2.6]),
      line([0, -SPAN], [0, -2.6]),
      line([0, 2.6], [0, SPAN]),
      line([-2.6, 1.4], [-SPAN - 2, 1.4]),
    ],
    ports: [
      [0, SPAN],
      [0, -SPAN],
      [-SPAN - 2, 1.4],
    ],
  },
  optocoupler: {
    describe: "Optocoupler. Ports: 1 LED anode, 2 LED cathode, 3 collector, 4 emitter",
    standard: "IEC 60617-5 S00640",
    entities: [
      box(20.32, 15.24),
      poly([[-8, -4], [-4.4, -2], [-8, 0]], true),
      line([-4.4, -4.2], [-4.4, 0.2]),
      line([-SPAN - 6.16, -2], [-8, -2]),
      line([-4.4, -2], [-4.4, 2]),
      line([-4.4, 2], [-SPAN - 6.16, 2]),
      line([-1.5, -2], [1.5, -2]),
      head([1.5, -2], 0, 1.2),
      line([-1.5, 2], [1.5, 2]),
      head([1.5, 2], 0, 1.2),
      line([4.4, -4.5], [4.4, 4.5]),
      line([4.4, -2], [8, -4.5]),
      line([4.4, 2], [8, 4.5]),
      line([8, -4.5], [SPAN + 6.16, -4.5]),
      line([8, 4.5], [SPAN + 6.16, 4.5]),
    ],
    ports: [
      [-SPAN - 6.16, -2],
      [-SPAN - 6.16, 2],
      [SPAN + 6.16, -4.5],
      [SPAN + 6.16, 4.5],
    ],
  },
}

// ─── sources, earths and supply rails ────────────────────────────────────────────────

const sources: SymbolLibrary = {
  cell: twoPin(
    "Single cell. Long plate positive",
    [line([-1.2, -4], [-1.2, 4]), line([1.2, -2], [1.2, 2])],
    { standard: "IEC 60617-2 S00050", half: 1.2 },
  ),
  battery: twoPin(
    "Battery, multiple cells",
    [
      line([-4.4, -4], [-4.4, 4]),
      line([-2, -2], [-2, 2]),
      line([0.4, -4], [0.4, 4]),
      line([2.8, -2], [2.8, 2]),
      text("+", [-6.4, -4.6], 2.2),
    ],
    { standard: "IEC 60617-2 S00051", half: 4.4 },
  ),
  "source-dc": twoPin(
    "DC source",
    [ring([0, 0], 5.08), line([-2.6, -1.6], [2.6, -1.6]), line([-2.6, 1.6], [-1, 1.6]), line([-0.2, 1.6], [1, 1.6]), line([1.8, 1.6], [2.6, 1.6])],
    { half: 5.08 },
  ),
  "source-ac": twoPin(
    "AC source",
    [ring([0, 0], 5.08), arc([-1.3, 0], 1.3, 180, 360), arc([1.3, 0], 1.3, 0, 180)],
    { standard: "IEC 60617-2 S00021", half: 5.08 },
  ),
  "source-current": twoPin(
    "Ideal current source",
    [ring([0, 0], 5.08), line([0, 3.4], [0, -3.4]), head([0, -3.4], 90)],
    { half: 5.08 },
  ),
  ground: {
    describe: "Earth / ground, general",
    standard: "IEC 60617-2 S00200",
    entities: [line([0, 0], [0, 3]), line([-4, 3], [4, 3]), line([-2.5, 4.8], [2.5, 4.8]), line([-1, 6.6], [1, 6.6])],
    ports: [[0, 0]],
  },
  "earth-protective": {
    describe: "Protective earth (PE)",
    standard: "IEC 60617-2 S00201",
    entities: [line([0, 0], [0, 2.4]), ring([0, 5.2], 2.8), line([-2.8, 5.2], [2.8, 5.2]), line([-1.6, 3.4], [1.6, 3.4]), line([-1.6, 7], [1.6, 7])],
    ports: [[0, 0]],
  },
  "ground-chassis": {
    describe: "Chassis / frame ground",
    standard: "IEC 60617-2 S00202",
    entities: [line([0, 0], [0, 3]), line([-4, 3], [4, 3]), line([-4, 3], [-6, 6]), line([0, 3], [-2, 6]), line([4, 3], [2, 6])],
    ports: [[0, 0]],
  },
  "ground-clean": {
    describe: "Clean / functional earth, for instrumentation returns",
    entities: [line([0, 0], [0, 3]), ring([0, 3], 0.9), line([-4, 3], [4, 3]), line([-2.5, 4.8], [2.5, 4.8]), line([-1, 6.6], [1, 6.6])],
    ports: [[0, 0]],
  },
  "supply-plus": {
    describe: "Positive supply rail marker. Label it with the voltage",
    entities: [line([0, 0], [0, -4]), line([-3, -4], [3, -4]), text("+V", [-3, -5.4], 2.5)],
    ports: [[0, 0]],
  },
  "supply-minus": {
    describe: "Negative supply rail marker",
    entities: [line([0, 0], [0, 4]), line([-3, 4], [3, 4]), text("−V", [-3, 7.6], 2.5)],
    ports: [[0, 0]],
  },
  "supply-line": {
    describe: "Live / line conductor marker (L)",
    entities: [line([0, 0], [0, -4]), ring([0, -5.4], 1.4), text("L", [-0.8, -8.4], 2.5)],
    ports: [[0, 0]],
  },
  "supply-neutral": {
    describe: "Neutral conductor marker (N)",
    entities: [line([0, 0], [0, -4]), ring([0, -5.4], 1.4), text("N", [-0.9, -8.4], 2.5)],
    ports: [[0, 0]],
  },
}

// ─── switchgear and control ──────────────────────────────────────────────────────────

const switchgear: SymbolLibrary = {
  "switch-spst": twoPin("Single-pole single-throw switch (NO)", bladeOpen, {
    standard: "IEC 60617-7 S00801",
    half: BODY,
  }),
  "switch-spst-nc": twoPin("Single-pole switch, normally closed", [...bladeClosed, line([1, -3.2], [1, 1.4])], {
    half: BODY,
  }),
  "switch-spdt": {
    describe: "Single-pole changeover switch. Ports: 1 common, 2 NC, 3 NO",
    standard: "IEC 60617-7 S00806",
    entities: [line([-SPAN, 0], [-1, 0]), line([1, -3.6], [SPAN, -3.6]), line([1, 3.6], [SPAN, 3.6]), line([-1, 0], [SPAN - 1, -3.2])],
    ports: [
      [-SPAN, 0],
      [SPAN, 3.6],
      [SPAN, -3.6],
    ],
  },
  "switch-dpst": {
    describe: "Double-pole switch, ganged. Ports: 1/2 pole A, 3/4 pole B",
    entities: [
      line([-SPAN, -3.5], [-1, -3.5]),
      line([1, -3.5], [SPAN, -3.5]),
      line([-1, -3.5], [SPAN - 1, -7.1]),
      line([-SPAN, 3.5], [-1, 3.5]),
      line([1, 3.5], [SPAN, 3.5]),
      line([-1, 3.5], [SPAN - 1, -0.1]),
      // The ganging bar: dashed, because the poles move together but are not connected.
      { type: "line", a: [1.6, -5.3], b: [1.6, 1.7], dash: "dashed" },
    ],
    ports: [
      [-SPAN, -3.5],
      [SPAN, -3.5],
      [-SPAN, 3.5],
      [SPAN, 3.5],
    ],
  },
  "pushbutton-no": twoPin(
    "Push-button, normally open (momentary)",
    [...bladeClosed.slice(0, 0), line([-BODY, 0], [-1.4, 0]), line([1.4, 0], [BODY, 0]), line([-1.4, -2.4], [1.4, -2.4]), line([0, -2.4], [0, -5.6]), line([-2, -5.6], [2, -5.6])],
    { standard: "IEC 60617-7 S00860", half: BODY },
  ),
  "pushbutton-nc": twoPin(
    "Push-button, normally closed",
    [line([-BODY, 0], [BODY, 0]), line([0, 0], [0, -5.6]), line([-2, -5.6], [2, -5.6])],
    { half: BODY },
  ),
  "switch-emergency": twoPin(
    "Emergency stop, mushroom head, latching",
    [line([-BODY, 0], [BODY, 0]), line([0, 0], [0, -4.4]), arc([0, -4.4], 3, 180, 360)],
    { standard: "IEC 60617-7 S00868", half: BODY },
  ),
  "switch-limit": twoPin("Limit switch, NO", [...bladeOpen, box(2.4, 2.4, [-1.2, -6.4])], { half: BODY }),
  "switch-key": twoPin("Key-operated switch", [...bladeOpen, line([0, -4.2], [0, -6.4]), ring([0, -7.4], 1)], { half: BODY }),
  "switch-rotary": {
    describe: "Rotary / multi-position selector. Ports: 1 common, then each position",
    entities: [
      line([-SPAN, 0], [-1, 0]),
      line([-1, 0], [SPAN - 1, -4.6]),
      line([1, -5.08], [SPAN, -5.08]),
      line([1, 0], [SPAN, 0]),
      line([1, 5.08], [SPAN, 5.08]),
      arc([-1, 0], 6.2, -50, 50),
    ],
    ports: [
      [-SPAN, 0],
      [SPAN, -5.08],
      [SPAN, 0],
      [SPAN, 5.08],
    ],
  },
  isolator: twoPin(
    "Isolator / disconnector, load-break",
    [...bladeOpen, line([BODY - 2.4, -4.6], [BODY + 1.2, -2.6])],
    { standard: "IEC 60617-7 S00810", half: BODY },
  ),
  "relay-coil": {
    describe: "Relay or contactor coil. Ports: 1 A1, 2 A2",
    standard: "IEC 60617-7 S00900",
    entities: [box(10.16, 5.08), line([-SPAN - 2.54, 0], [-5.08, 0]), line([5.08, 0], [SPAN + 2.54, 0])],
    ports: [
      [-SPAN - 2.54, 0],
      [SPAN + 2.54, 0],
    ],
  },
  "relay-coil-delay-on": {
    describe: "Time-delay relay coil, on-delay",
    entities: [box(10.16, 5.08), poly([[-5.08, 2.54], [-2, 2.54], [-2, -2.54]]), line([-SPAN - 2.54, 0], [-5.08, 0]), line([5.08, 0], [SPAN + 2.54, 0])],
    ports: [
      [-SPAN - 2.54, 0],
      [SPAN + 2.54, 0],
    ],
  },
  "contact-no": twoPin("Contactor / relay contact, normally open", bladeOpen, {
    standard: "IEC 60617-7 S00802",
    half: BODY,
  }),
  "contact-nc": twoPin(
    "Contactor / relay contact, normally closed",
    [line([-BODY, 0], [-1, 0]), line([1, 0], [BODY, 0]), line([-1, 0], [BODY - 0.5, -3.6]), line([BODY - 1.6, -3.6], [BODY + 0.8, -3.6])],
    { standard: "IEC 60617-7 S00803", half: BODY },
  ),
  "contact-changeover": {
    describe: "Changeover contact. Ports: 1 common, 2 NC, 3 NO",
    entities: [line([-SPAN, 0], [-1, 0]), line([1, -3.6], [SPAN, -3.6]), line([1, 3.6], [SPAN, 3.6]), line([-1, 0], [SPAN - 1, -3.2])],
    ports: [
      [-SPAN, 0],
      [SPAN, 3.6],
      [SPAN, -3.6],
    ],
  },
  "contactor-3p": {
    describe: "Three-pole contactor, main contacts. Ports: 1/2/3 in, 4/5/6 out",
    entities: [0, 1, 2].flatMap((i) => {
      const y = (i - 1) * 5.08
      return [line([-SPAN, y], [-1, y]), line([1, y], [SPAN, y]), line([-1, y], [SPAN - 1, y - 3.6])]
    }),
    ports: [
      [-SPAN, -5.08],
      [-SPAN, 0],
      [-SPAN, 5.08],
      [SPAN, -5.08],
      [SPAN, 0],
      [SPAN, 5.08],
    ],
  },
  "overload-thermal": {
    describe: "Thermal overload relay, three-pole",
    standard: "IEC 60617-7 S00930",
    entities: [
      box(15.24, 17.78),
      ...[0, 1, 2].flatMap((i) => {
        const y = (i - 1) * 5.08
        return [line([-SPAN - 2.54, y], [-7.62, y]), line([7.62, y], [SPAN + 2.54, y]), line([-4, y - 1.8], [4, y - 1.8])]
      }),
    ],
    ports: [
      [-SPAN - 2.54, -5.08],
      [-SPAN - 2.54, 0],
      [-SPAN - 2.54, 5.08],
      [SPAN + 2.54, -5.08],
      [SPAN + 2.54, 0],
      [SPAN + 2.54, 5.08],
    ],
  },
}

// ─── protection ──────────────────────────────────────────────────────────────────────

/** A pole of a breaker: the blade plus the trip mark, drawn vertically for a panel view. */
const breakerPole = (x: number): Entity[] => [
  line([x, -SPAN - 2.54], [x, -2]),
  line([x, 2], [x, SPAN + 2.54]),
  line([x, -2], [x + 3.6, 2.4]),
  line([x + 1.2, 3.6], [x + 4.4, 1.6]),
  line([x + 4.4, 1.6], [x + 4.4, 3.2]),
]

const protection: SymbolLibrary = {
  fuse: twoPin("Fuse", [box(10.16, 4.06), line([-5.08, 0], [5.08, 0])], {
    standard: "IEC 60617-7 S00950",
    half: 5.08,
  }),
  "fuse-switch": twoPin(
    "Fuse-switch / switch-fuse",
    [box(10.16, 4.06), line([-5.08, 0], [5.08, 0]), line([-5.08, 0], [3.6, -4.6])],
    { half: 5.08 },
  ),
  "mcb-1p": {
    describe: "Miniature circuit breaker, single pole. Label with rating and curve, e.g. B16",
    standard: "IEC 60617-7 S00960",
    entities: breakerPole(0),
    ports: [
      [0, -SPAN - 2.54],
      [0, SPAN + 2.54],
    ],
  },
  "mcb-2p": {
    describe: "MCB, two pole",
    entities: [
      ...breakerPole(-5.08),
      ...breakerPole(5.08),
      { type: "line", a: [-5.08, 0], b: [5.08, 0], dash: "dashed" },
    ],
    ports: [
      [-5.08, -SPAN - 2.54],
      [5.08, -SPAN - 2.54],
      [-5.08, SPAN + 2.54],
      [5.08, SPAN + 2.54],
    ],
  },
  "mcb-3p": {
    describe: "MCB, three pole, for a three-phase circuit",
    entities: [
      ...breakerPole(-7.62),
      ...breakerPole(0),
      ...breakerPole(7.62),
      { type: "line", a: [-7.62, 0], b: [7.62, 0], dash: "dashed" },
    ],
    ports: [
      [-7.62, -SPAN - 2.54],
      [0, -SPAN - 2.54],
      [7.62, -SPAN - 2.54],
      [-7.62, SPAN + 2.54],
      [0, SPAN + 2.54],
      [7.62, SPAN + 2.54],
    ],
  },
  "rcd-2p": {
    describe: "Residual current device, two pole. Label with rating and sensitivity, e.g. 40A 30mA",
    standard: "IEC 60617-7 S00966",
    entities: [
      box(20.32, 15.24),
      ring([0, 0], 5.08),
      line([-5.08, -SPAN - 5], [-5.08, -7.62]),
      line([5.08, -SPAN - 5], [5.08, -7.62]),
      line([-5.08, 7.62], [-5.08, SPAN + 5]),
      line([5.08, 7.62], [5.08, SPAN + 5]),
      text("I∆n", [-3, 1], 2.2),
    ],
    ports: [
      [-5.08, -SPAN - 5],
      [5.08, -SPAN - 5],
      [-5.08, SPAN + 5],
      [5.08, SPAN + 5],
    ],
  },
  "rcd-4p": {
    describe: "Residual current device, four pole (three phase + neutral)",
    entities: [
      box(30.48, 15.24),
      ring([0, 0], 5.08),
      ...[-11.43, -3.81, 3.81, 11.43].flatMap((x) => [
        line([x, -SPAN - 5], [x, -7.62]),
        line([x, 7.62], [x, SPAN + 5]),
      ]),
      text("I∆n", [-3, 1], 2.2),
    ],
    ports: [
      [-11.43, -SPAN - 5],
      [-3.81, -SPAN - 5],
      [3.81, -SPAN - 5],
      [11.43, -SPAN - 5],
      [-11.43, SPAN + 5],
      [-3.81, SPAN + 5],
      [3.81, SPAN + 5],
      [11.43, SPAN + 5],
    ],
  },
  rcbo: {
    describe: "RCBO: combined RCD and MCB in one device",
    entities: [
      box(20.32, 20.32),
      ring([0, 3.4], 4.4),
      text("I∆n", [-3, 4.4], 2.2),
      line([-5.08, -SPAN - 7.6], [-5.08, -10.16]),
      line([5.08, -SPAN - 7.6], [5.08, -10.16]),
      line([-5.08, 10.16], [-5.08, SPAN + 7.6]),
      line([5.08, 10.16], [5.08, SPAN + 7.6]),
      line([-7.4, -6.4], [-2.8, -3.4]),
      line([-6.6, -2.6], [-2, -5.4]),
    ],
    ports: [
      [-5.08, -SPAN - 7.6],
      [5.08, -SPAN - 7.6],
      [-5.08, SPAN + 7.6],
      [5.08, SPAN + 7.6],
    ],
  },
  mccb: {
    describe: "Moulded-case circuit breaker, three pole",
    entities: [
      box(25.4, 20.32),
      ...[-7.62, 0, 7.62].flatMap((x) => [
        line([x, -SPAN - 7.6], [x, -10.16]),
        line([x, 10.16], [x, SPAN + 7.6]),
        line([x, -10.16], [x, 10.16]),
        line([x - 1.8, -3], [x + 3, 1.2]),
      ]),
    ],
    ports: [
      [-7.62, -SPAN - 7.6],
      [0, -SPAN - 7.6],
      [7.62, -SPAN - 7.6],
      [-7.62, SPAN + 7.6],
      [0, SPAN + 7.6],
      [7.62, SPAN + 7.6],
    ],
  },
  "surge-arrester": {
    describe: "Surge protective device (SPD)",
    standard: "IEC 60617-7 S00975",
    entities: [box(10.16, 15.24), poly([[-3.4, -4], [3.4, -4], [0, 1]], true), line([0, -SPAN - 5], [0, -7.62]), line([0, 7.62], [0, SPAN + 5])],
    ports: [
      [0, -SPAN - 5],
      [0, SPAN + 5],
    ],
  },
}

// ─── machines, transformers and loads ────────────────────────────────────────────────

/** The circled-letter body IEC uses for rotating machines and meters. */
function circled(letter: string, describe: string, standard?: string, r = 7.62): BlueprintSymbol {
  return {
    describe,
    standard,
    entities: [ring([0, 0], r), text(letter, [-letter.length * 1.1, 1.4], 3.6), line([-SPAN - r, 0], [-r, 0]), line([r, 0], [SPAN + r, 0])],
    ports: [
      [-SPAN - r, 0],
      [SPAN + r, 0],
    ],
  }
}

const machines: SymbolLibrary = {
  "motor-dc": circled("M", "DC motor", "IEC 60617-6 S00700"),
  "motor-ac-1ph": circled("M~", "Single-phase AC motor"),
  "motor-ac-3ph": {
    describe: "Three-phase induction motor. Ports: U, V, W",
    standard: "IEC 60617-6 S00701",
    entities: [ring([0, 0], 7.62), text("M", [-1.6, 0.6], 3.6), text("3~", [-2.2, 5], 2.4), line([-7.62, 0], [-SPAN - 7.62, 0]), line([-5.4, -5.4], [-SPAN - 7.62, -5.4]), line([-5.4, 5.4], [-SPAN - 7.62, 5.4])],
    ports: [
      [-SPAN - 7.62, -5.4],
      [-SPAN - 7.62, 0],
      [-SPAN - 7.62, 5.4],
    ],
  },
  generator: circled("G", "Generator", "IEC 60617-6 S00702"),
  "motor-servo": circled("M", "Servo motor; label with the feedback type"),
  "motor-stepper": circled("M", "Stepper motor; label with the step angle and phase count"),
  solenoid: twoPin("Solenoid / electromagnetic actuator", [box(10.16, 6.35), line([-5.08, -3.175], [-5.08, 3.175])], {
    half: 5.08,
  }),
  "valve-solenoid": {
    describe: "Solenoid valve",
    entities: [box(7.62, 5.08, [-11.43, -2.54]), line([-11.43, 0], [-SPAN - 11.43, 0]), poly([[-3.81, -3.81], [-3.81, 3.81], [3.81, 0]], true), poly([[3.81, -3.81], [3.81, 3.81], [-3.81, 0]], true), line([3.81, 0], [SPAN + 3.81, 0])],
    ports: [
      [-SPAN - 11.43, 0],
      [SPAN + 3.81, 0],
    ],
  },
  transformer: {
    describe: "Two-winding transformer, IEC dual-circle body. Ports: 1/2 primary, 3/4 secondary",
    standard: "IEC 60617-6 S00650",
    entities: [
      ring([-2.54, 0], 5.08),
      ring([2.54, 0], 5.08),
      line([-7.62, -3.81], [-SPAN - 7.62, -3.81]),
      line([-7.62, 3.81], [-SPAN - 7.62, 3.81]),
      line([7.62, -3.81], [SPAN + 7.62, -3.81]),
      line([7.62, 3.81], [SPAN + 7.62, 3.81]),
    ],
    ports: [
      [-SPAN - 7.62, -3.81],
      [-SPAN - 7.62, 3.81],
      [SPAN + 7.62, -3.81],
      [SPAN + 7.62, 3.81],
    ],
  },
  "transformer-coil": {
    describe: "Two-winding transformer drawn as facing coils with a core",
    entities: [
      ...coil(4, 1.6, -3.2, true),
      ...coil(4, 1.6, 3.2, false),
      line([-7, -0.6], [7, -0.6]),
      line([-7, 0.6], [7, 0.6]),
      line([-6.4, -3.2], [-SPAN - 6.4, -3.2]),
      line([6.4, -3.2], [SPAN + 6.4, -3.2]),
      line([-6.4, 3.2], [-SPAN - 6.4, 3.2]),
      line([6.4, 3.2], [SPAN + 6.4, 3.2]),
    ],
    ports: [
      [-SPAN - 6.4, -3.2],
      [SPAN + 6.4, -3.2],
      [-SPAN - 6.4, 3.2],
      [SPAN + 6.4, 3.2],
    ],
  },
  "transformer-3ph": {
    describe: "Three-phase transformer, Dyn11 style. Ports: 1-3 HV, 4-6 LV",
    entities: [
      ring([-5.08, 0], 5.08),
      ring([0, -4.4], 5.08),
      ring([5.08, 0], 5.08),
      text("Dyn", [-4, 12], 2.4),
      ...[-7.62, 0, 7.62].map((x) => line([x, -12.7], [x, -SPAN - 12.7])),
      ...[-7.62, 0, 7.62].map((x) => line([x, 7.62], [x, SPAN + 7.62])),
    ],
    ports: [
      [-7.62, -SPAN - 12.7],
      [0, -SPAN - 12.7],
      [7.62, -SPAN - 12.7],
      [-7.62, SPAN + 7.62],
      [0, SPAN + 7.62],
      [7.62, SPAN + 7.62],
    ],
  },
  "transformer-current": {
    describe: "Current transformer. The primary is the conductor passing through",
    entities: [ring([0, 0], 5.08), line([-SPAN - 5.08, 0], [SPAN + 5.08, 0]), line([0, 5.08], [0, SPAN + 5.08]), line([-3.4, 8], [3.4, 8])],
    ports: [
      [-SPAN - 5.08, 0],
      [SPAN + 5.08, 0],
      [0, SPAN + 5.08],
    ],
  },
  "autotransformer": {
    describe: "Autotransformer / variac",
    entities: [ring([0, 0], 6.35), line([-6.35, 0], [-SPAN - 6.35, 0]), line([6.35, 0], [SPAN + 6.35, 0]), line([-5, 5], [5, -5]), head([5, -5], -45)],
    ports: [
      [-SPAN - 6.35, 0],
      [SPAN + 6.35, 0],
    ],
  },
  bell: {
    describe: "Bell",
    entities: [arc([0, 1.6], 5.08, 180, 360), line([-5.08, 1.6], [5.08, 1.6]), line([-SPAN - 5.08, 1.6], [-5.08, 1.6]), line([5.08, 1.6], [SPAN + 5.08, 1.6])],
    ports: [
      [-SPAN - 5.08, 1.6],
      [SPAN + 5.08, 1.6],
    ],
  },
  buzzer: {
    describe: "Buzzer / sounder",
    entities: [arc([0, 0], 5.08, 90, 270), line([0, -5.08], [0, 5.08]), line([-SPAN - 5.08, -2.54], [0, -2.54]), line([-SPAN - 5.08, 2.54], [0, 2.54])],
    ports: [
      [-SPAN - 5.08, -2.54],
      [-SPAN - 5.08, 2.54],
    ],
  },
  speaker: {
    describe: "Loudspeaker",
    entities: [box(3.4, 7.62, [-5.08, -3.81]), poly([[-1.68, -3.81], [3.4, -7.62], [3.4, 7.62], [-1.68, 3.81]], true), line([-SPAN - 5.08, -2.54], [-5.08, -2.54]), line([-SPAN - 5.08, 2.54], [-5.08, 2.54])],
    ports: [
      [-SPAN - 5.08, -2.54],
      [-SPAN - 5.08, 2.54],
    ],
  },
  microphone: {
    describe: "Microphone",
    entities: [arc([0, 0], 5.08, 90, 270), line([0, -5.08], [0, 5.08]), line([0, -2.54], [SPAN + 5.08, -2.54]), line([0, 2.54], [SPAN + 5.08, 2.54])],
    ports: [
      [SPAN + 5.08, -2.54],
      [SPAN + 5.08, 2.54],
    ],
  },
  antenna: {
    describe: "Antenna, general",
    standard: "IEC 60617-4 S00380",
    entities: [line([0, 0], [0, -5.08]), line([-4.4, -8.8], [0, -5.08]), line([4.4, -8.8], [0, -5.08])],
    ports: [[0, 0]],
  },
  "heating-element": twoPin("Heating element / resistive load", [box(12.7, 6.35), line([-6.35, 0], [6.35, 0])], {
    half: 6.35,
  }),
}

// ─── measuring instruments ───────────────────────────────────────────────────────────

const instruments: SymbolLibrary = {
  ammeter: circled("A", "Ammeter", "IEC 60617-8 S01000", 5.08),
  voltmeter: circled("V", "Voltmeter", "IEC 60617-8 S01001", 5.08),
  wattmeter: circled("W", "Wattmeter", "IEC 60617-8 S01002", 5.08),
  ohmmeter: circled("Ω", "Ohmmeter", undefined, 5.08),
  "meter-kwh": {
    describe: "Energy meter (kWh)",
    standard: "IEC 60617-8 S01010",
    entities: [box(15.24, 10.16), text("kWh", [-5, 1.2], 3), line([-SPAN - 7.62, 0], [-7.62, 0]), line([7.62, 0], [SPAN + 7.62, 0])],
    ports: [
      [-SPAN - 7.62, 0],
      [SPAN + 7.62, 0],
    ],
  },
  "meter-frequency": circled("Hz", "Frequency meter", undefined, 5.08),
  "meter-powerfactor": circled("cos", "Power-factor meter", undefined, 5.08),
  thermometer: {
    describe: "Temperature sensor / thermometer point",
    entities: [ring([0, 0], 5.08), text("θ", [-1.2, 1.4], 3.6), line([0, 5.08], [0, SPAN + 5.08])],
    ports: [[0, SPAN + 5.08]],
  },
  "test-point": {
    describe: "Test point",
    entities: [ring([0, 0], 1.6), line([0, 1.6], [0, SPAN])],
    ports: [[0, SPAN]],
  },
}

// ─── installation plan symbols (IEC 60617-11) ────────────────────────────────────────

/** Installation symbols sit on a wall or ceiling; their single port is the feed point. */
const feed = (at: Pt): Pt[] => [at]

const installation: SymbolLibrary = {
  "socket-1g": {
    describe: "Socket outlet, single. Plan symbol",
    standard: "IEC 60617-11 S01300",
    entities: [arc([0, 0], 5, 180, 360), line([-5, 0], [5, 0]), line([0, 0], [0, -8]), line([-2.4, -5], [2.4, -5])],
    ports: feed([0, 0]),
  },
  "socket-2g": {
    describe: "Socket outlet, double",
    entities: [arc([0, 0], 5, 180, 360), line([-5, 0], [5, 0]), line([0, 0], [0, -8]), line([-2.4, -5], [2.4, -5]), line([-2.4, -6.6], [2.4, -6.6])],
    ports: feed([0, 0]),
  },
  "socket-switched": {
    describe: "Switched socket outlet",
    entities: [arc([0, 0], 5, 180, 360), line([-5, 0], [5, 0]), line([0, 0], [0, -8]), line([-2.4, -5], [2.4, -5]), line([5, 0], [9, -3.6])],
    ports: feed([0, 0]),
  },
  "socket-3ph": {
    describe: "Three-phase socket outlet",
    entities: [arc([0, 0], 5, 180, 360), line([-5, 0], [5, 0]), line([0, 0], [0, -8]), line([-3.4, -5], [3.4, -5]), line([-3.4, -6.4], [3.4, -6.4]), line([-3.4, -3.6], [3.4, -3.6])],
    ports: feed([0, 0]),
  },
  "socket-outdoor": {
    describe: "Socket outlet, weatherproof (IP-rated). Label with the IP code",
    entities: [arc([0, 0], 5, 180, 360), line([-5, 0], [5, 0]), line([0, 0], [0, -8]), line([-2.4, -5], [2.4, -5]), box(14, 12, [-7, -9])],
    ports: feed([0, 0]),
  },
  "switch-1way": {
    describe: "Wall switch, one-way. Plan symbol",
    standard: "IEC 60617-11 S01320",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6])],
    ports: feed([0, 0]),
  },
  "switch-2way": {
    describe: "Wall switch, two-way (changeover)",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6]), line([5, -6.6], [8.4, -4.2])],
    ports: feed([0, 0]),
  },
  "switch-intermediate": {
    describe: "Wall switch, intermediate (crossover)",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6]), line([4.4, -7], [8.8, -4]), line([4.4, -4], [8.8, -7])],
    ports: feed([0, 0]),
  },
  "switch-2gang": {
    describe: "Wall switch, two gang",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6]), line([6.8, -3], [8.4, -5.2])],
    ports: feed([0, 0]),
  },
  "switch-pull": {
    describe: "Pull-cord switch (bathrooms)",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6]), ring([7.6, -8.4], 1.2)],
    ports: feed([0, 0]),
  },
  dimmer: {
    describe: "Dimmer switch",
    entities: [dot([0, 0], 1.2), line([0, 0], [6, -4.4]), line([6, -4.4], [7.6, -6.6]), arc([0, 0], 8, -50, -10)],
    ports: feed([0, 0]),
  },
  lamp: {
    describe: "Luminaire / lamp point, general",
    standard: "IEC 60617-11 S01340",
    entities: [ring([0, 0], 4.4), line([-3.1, -3.1], [3.1, 3.1]), line([-3.1, 3.1], [3.1, -3.1])],
    ports: feed([0, 0]),
  },
  "lamp-wall": {
    describe: "Wall-mounted luminaire",
    entities: [ring([0, 0], 4.4), line([-3.1, -3.1], [3.1, 3.1]), line([-3.1, 3.1], [3.1, -3.1]), line([-6.4, -4.4], [-6.4, 4.4])],
    ports: feed([0, 0]),
  },
  "luminaire-linear": {
    describe: "Linear / fluorescent luminaire. Scale to the real fitting length",
    standard: "IEC 60617-11 S01345",
    entities: [box(60, 8), line([-30, 0], [30, 0])],
    ports: feed([0, 0]),
  },
  "luminaire-emergency": {
    describe: "Emergency luminaire with integral battery",
    entities: [box(60, 8), line([-30, 0], [30, 0]), ring([0, 0], 3), text("E", [-1, 1.2], 2.4)],
    ports: feed([0, 0]),
  },
  "luminaire-downlight": {
    describe: "Recessed downlight",
    entities: [ring([0, 0], 4.4), ring([0, 0], 2.2)],
    ports: feed([0, 0]),
  },
  "exit-sign": {
    describe: "Illuminated exit sign",
    entities: [box(14, 7), text("EXIT", [-5.4, 1.4], 3)],
    ports: feed([0, 0]),
  },
  "distribution-board": {
    describe: "Distribution board / consumer unit. Label with the board reference",
    standard: "IEC 60617-11 S01360",
    entities: [box(30, 12), line([-15, 0], [15, 0]), line([-9, -6], [-9, 6]), line([-3, -6], [-3, 6]), line([3, -6], [3, 6]), line([9, -6], [9, 6])],
    ports: [
      [-15, 0],
      [15, 0],
    ],
  },
  "junction-box": {
    describe: "Junction box",
    entities: [ring([0, 0], 4), line([-2.8, -2.8], [2.8, 2.8])],
    ports: feed([0, 0]),
  },
  "ceiling-rose": {
    describe: "Ceiling rose",
    entities: [ring([0, 0], 4), dot([0, 0], 1)],
    ports: feed([0, 0]),
  },
  "cable-rising": {
    describe: "Cable rising to the storey above",
    entities: [ring([0, 0], 3), line([0, 3], [0, -6]), head([0, -6], 90)],
    ports: feed([0, 3]),
  },
  "cable-falling": {
    describe: "Cable dropping to the storey below",
    entities: [ring([0, 0], 3), line([0, -3], [0, 6]), head([0, 6], -90)],
    ports: feed([0, -3]),
  },
  "smoke-detector": {
    describe: "Smoke detector",
    entities: [ring([0, 0], 5), text("S", [-1.2, 1.6], 3.4)],
    ports: feed([0, 0]),
  },
  "heat-detector": {
    describe: "Heat detector",
    entities: [ring([0, 0], 5), text("H", [-1.4, 1.6], 3.4)],
    ports: feed([0, 0]),
  },
  "call-point": {
    describe: "Manual fire call point",
    entities: [box(9, 9), poly([[-3, -3], [3, 3]]), poly([[-3, 3], [3, -3]])],
    ports: feed([0, 0]),
  },
  thermostat: {
    describe: "Room thermostat",
    entities: [ring([0, 0], 5), text("θ", [-1.4, 1.6], 3.4), line([0, 5], [0, 9])],
    ports: feed([0, 5]),
  },
  "motion-sensor": {
    describe: "PIR occupancy / motion sensor",
    entities: [ring([0, 0], 5), arc([0, 0], 8, -140, -40), text("PIR", [-3.6, 1.4], 2.4)],
    ports: feed([0, 0]),
  },
  "outlet-data": {
    describe: "Data outlet (RJ45). Label with the port count and category",
    entities: [box(9, 9), text("D", [-1.4, 1.6], 3.4)],
    ports: feed([0, 0]),
  },
  "outlet-tv": {
    describe: "TV / coaxial outlet",
    entities: [box(9, 9), text("TV", [-2.8, 1.6], 3)],
    ports: feed([0, 0]),
  },
  "outlet-telephone": {
    describe: "Telephone outlet",
    entities: [box(9, 9), text("T", [-1.2, 1.6], 3.4)],
    ports: feed([0, 0]),
  },
  "fan-point": {
    describe: "Extract fan point",
    entities: [ring([0, 0], 5), poly([[-3.4, 0], [0, -2], [3.4, 0], [0, 2]], true)],
    ports: feed([0, 0]),
  },
  "water-heater": {
    describe: "Water heater / immersion point",
    entities: [box(12, 12), arc([0, 2], 3, 180, 360), text("WH", [-4, -2], 2.6)],
    ports: feed([0, 0]),
  },
  "cooker-point": {
    describe: "Cooker connection point",
    entities: [box(12, 9), text("C", [-1.6, 1.8], 4)],
    ports: feed([0, 0]),
  },
  "isolator-local": {
    describe: "Local isolator / fused spur",
    entities: [box(9, 9), line([-3, 3], [3, -3])],
    ports: feed([0, 0]),
  },
}

// ─── logic and wiring furniture ──────────────────────────────────────────────────────

/** IEC 60617-12 rectangular logic body with a qualifying symbol inside. */
function gate(mark: string, describe: string, inputs = 2, invert = false): BlueprintSymbol {
  const h = Math.max(2, inputs) * 5.08
  const ins: Pt[] = Array.from({ length: inputs }, (_, i) => [-SPAN - 5.08, (i - (inputs - 1) / 2) * 5.08])
  return {
    describe,
    standard: "IEC 60617-12",
    entities: [
      box(10.16, h),
      text(mark, [-mark.length * 1.1, 1.4], 3),
      ...ins.map((port) => line(port, [-5.08, port[1]])),
      ...(invert ? [ring([6.4, 0], 1.3), line([7.7, 0], [SPAN + 5.08, 0])] : [line([5.08, 0], [SPAN + 5.08, 0])]),
    ],
    ports: [...ins, [SPAN + 5.08, 0]],
  }
}

const logic: SymbolLibrary = {
  "gate-and": gate("&", "AND gate, IEC rectangular"),
  "gate-or": gate("≥1", "OR gate"),
  "gate-not": gate("1", "Inverter", 1, true),
  "gate-nand": gate("&", "NAND gate", 2, true),
  "gate-nor": gate("≥1", "NOR gate", 2, true),
  "gate-xor": gate("=1", "XOR gate"),
  "gate-buffer": gate("1", "Buffer", 1),
  amplifier: {
    describe: "Amplifier. Ports: 1 in, 2 out",
    standard: "IEC 60617-6",
    entities: [poly([[-5.08, -5.08], [5.08, 0], [-5.08, 5.08]], true), line([-SPAN - 5.08, 0], [-5.08, 0]), line([5.08, 0], [SPAN + 5.08, 0])],
    ports: [
      [-SPAN - 5.08, 0],
      [SPAN + 5.08, 0],
    ],
  },
  opamp: {
    describe: "Operational amplifier. Ports: 1 non-inverting in, 2 inverting in, 3 out",
    entities: [
      poly([[-6.35, -7.62], [6.35, 0], [-6.35, 7.62]], true),
      line([-SPAN - 6.35, -3.81], [-6.35, -3.81]),
      line([-SPAN - 6.35, 3.81], [-6.35, 3.81]),
      line([6.35, 0], [SPAN + 6.35, 0]),
      text("+", [-5.2, -2.8], 2.4),
      text("−", [-5.2, 4.8], 2.4),
    ],
    ports: [
      [-SPAN - 6.35, -3.81],
      [-SPAN - 6.35, 3.81],
      [SPAN + 6.35, 0],
    ],
  },
  "junction-dot": {
    describe: "Wire junction: a connection where wires cross. Place one at every T and cross that connects",
    standard: "IEC 60617-3 S00100",
    entities: [dot([0, 0], 0.8)],
    ports: [[0, 0]],
  },
  "crossing-no-connect": {
    describe: "Wires crossing without connecting, drawn as a hop",
    entities: [line([-SPAN, 0], [-1.6, 0]), arc([0, 0], 1.6, 180, 360), line([1.6, 0], [SPAN, 0])],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
    ],
  },
  terminal: {
    describe: "Terminal / connection point",
    standard: "IEC 60617-3 S00110",
    entities: [ring([0, 0], 1.3)],
    ports: [[0, 0]],
  },
  "terminal-block": {
    describe: "Terminal block, four way. Label with the terminal numbers",
    entities: [box(20.32, 5.08), ...[-7.62, -2.54, 2.54, 7.62].flatMap((x) => [ring([x, 0], 1.1), line([x, -2.54], [x, -SPAN - 2.54])])],
    ports: [
      [-7.62, -SPAN - 2.54],
      [-2.54, -SPAN - 2.54],
      [2.54, -SPAN - 2.54],
      [7.62, -SPAN - 2.54],
    ],
  },
  "plug-socket": {
    describe: "Plug and socket connector pair",
    entities: [line([-SPAN, 0], [-1.4, 0]), poly([[-1.4, -2], [-1.4, 2]]), arc([1.4, 0], 2.2, 90, 270), line([1.4, 0], [SPAN, 0])],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
    ],
  },
  "link-removable": {
    describe: "Removable link / bridge",
    entities: [ring([-SPAN, 0], 1.3), ring([SPAN, 0], 1.3), arc([0, 0], SPAN - 1.3, 180, 360)],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
    ],
  },
  "cable-shielded": {
    describe: "Screened / shielded cable run",
    entities: [line([-SPAN, 0], [SPAN, 0]), { type: "arc", c: [0, 0], r: 3.4, a0: 180, a1: 360, dash: "dashed" }],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
    ],
  },
  "cable-multicore": {
    describe: "Multicore cable marker: a slash across the run with the core count",
    entities: [line([-SPAN, 0], [SPAN, 0]), line([-1.8, 2.6], [1.8, -2.6]), text("3", [-3.4, -3.2], 2.4)],
    ports: [
      [-SPAN, 0],
      [SPAN, 0],
    ],
  },
  enclosure: {
    describe: "Dashed enclosure boundary, for a panel or an assembly. Scale to fit what it contains",
    entities: [enclosure(50.8, 30.48)],
  },
}

export const ELECTRICAL: SymbolLibrary = {
  ...passives,
  ...semiconductors,
  ...sources,
  ...switchgear,
  ...protection,
  ...machines,
  ...instruments,
  ...installation,
  ...logic,
}
