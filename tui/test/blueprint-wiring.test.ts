import { describe, expect, test } from "bun:test"
import { autowireOps } from "../src/blueprint/autowire.ts"
import { checkDoc } from "../src/blueprint/check.ts"
import { merge3 } from "../src/blueprint/merge.ts"
import { bbox, textBox } from "../src/blueprint/geom.ts"
import { applyOps } from "../src/blueprint/ops.ts"
import { dirsOf } from "../src/blueprint/place.ts"
import { routeWire, staleNets } from "../src/blueprint/route.ts"
import { emptyDoc, serialize, type BlueprintDoc, type Entity, type Pt } from "../src/blueprint/schema.ts"
import { roleOf } from "../src/blueprint/symbols/index.ts"

/**
 * The drawing that prompted all of this: a battery and a lamp on the same horizontal axis,
 * both battery terminals wired to the lamp. Routed by hand it came out as two wires stacked
 * on top of each other — one line where the circuit has two conductors — and the proposed fix
 * was for the caller to compute a polyline itself.
 */
const sheet = () => emptyDoc("wiring", [0, 0, 200, 200])

const wires = (doc: BlueprintDoc) =>
  doc.entities.filter(
    (entity): entity is Extract<Entity, { type: "polyline" }> =>
      entity.type === "polyline" && /^w\d+$/.test(entity.id ?? ""),
  )

/** How much of a-b lies along c-d, which is the thing a schematic must never contain. */
function shared(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const tol = 1e-6
  const axis =
    Math.abs(a[0] - b[0]) < tol && Math.abs(c[0] - d[0]) < tol && Math.abs(a[0] - c[0]) < tol
      ? 1
      : Math.abs(a[1] - b[1]) < tol && Math.abs(c[1] - d[1]) < tol && Math.abs(a[1] - c[1]) < tol
        ? 0
        : -1
  if (axis === -1) return 0
  const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
  const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
  return Math.max(0, hi - lo)
}

/** Total length any two different wires spend lying on top of each other. */
function overlapIn(doc: BlueprintDoc): number {
  const runs = wires(doc).flatMap((wire) =>
    wire.pts.slice(1).map((point, i) => ({ id: wire.id!, a: wire.pts[i]!, b: point })),
  )
  let total = 0
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[i]!.id === runs[j]!.id) continue
      total += shared(runs[i]!.a, runs[i]!.b, runs[j]!.a, runs[j]!.b)
    }
  }
  return total
}

const circuit = (rotate = 0) =>
  applyOps(sheet(), [
    { op: "place", symbol: "electrical/battery", at: [40.64, 99.06], label: "BT1", ...(rotate ? { rotate } : {}) },
    { op: "place", symbol: "electrical/lamp", at: [99.06, 99.06], label: "L1" },
  ])

describe("the drawing that started this", () => {
  test("both battery terminals reach the lamp without the two wires sharing a line", () => {
    const built = circuit()
    expect(built.doc.nets).toHaveLength(2)
    expect(wires(built.doc)).toHaveLength(2)
    // The regression this whole change exists for.
    expect(overlapIn(built.doc)).toBe(0)
    expect(built.warnings).toEqual([])
  })

  test("neither wire is drawn through the battery it leaves", () => {
    const built = circuit().doc
    const bt1 = built.parts.find((part) => part.ref === "BT1")!
    const body = bbox(built.entities.filter((entity) => entity.id?.startsWith(`${bt1.prefix}-`) && entity.type !== "text"))!
    for (const wire of wires(built)) {
      // Interior points only: an endpoint is a port, and a port is on the body by definition.
      for (const [x, y] of wire.pts.slice(1, -1)) {
        expect(x > body[0] && x < body[2] && y > body[1] && y < body[3]).toBe(false)
      }
    }
  })

  test("a wire leaves each terminal along the terminal, not back across the part", () => {
    const built = circuit().doc
    const bt1 = built.parts.find((part) => part.ref === "BT1")!
    const dirs = dirsOf(bt1)
    for (const net of built.nets!) {
      const wire = built.entities.find((entity) => entity.id === net.wire)
      if (wire?.type !== "polyline") throw new Error("no wire")
      const port = Number(net.from.slice(net.from.indexOf(".") + 1)) - 1
      const [dx, dy] = dirs[port]!
      const step: Pt = [wire.pts[1]![0] - wire.pts[0]![0], wire.pts[1]![1] - wire.pts[0]![1]]
      // The first run heads out along the pin: same sign on the pin's axis.
      expect(Math.sign(step[0]) === dx || (dx === 0 && step[0] === 0)).toBe(true)
      expect(Math.sign(step[1]) === dy || (dy === 0 && step[1] === 0)).toBe(true)
    }
  })

  test("the checker now catches the stacked wires it used to pass", () => {
    const built = circuit().doc
    // Put the original failure back: redraw the wire that routes around the battery as a
    // straight run along the axis the other wire already occupies — the drawing the transcript
    // produced by hand, which the checker used to pass in silence.
    const straight = wires(built).find((wire) => wire.pts.length > 2)!
    const sabotaged: BlueprintDoc = {
      ...built,
      entities: built.entities.map((entity) =>
        entity.id === straight.id && entity.type === "polyline"
          ? { ...entity, pts: [entity.pts[0]!, [99.06, entity.pts[0]![1]]] as Pt[] }
          : entity,
      ),
    }
    const messages = checkDoc(sabotaged, "electrical").findings.map((finding) => finding.message)
    expect(messages.some((message) => /run along each other/.test(message))).toBe(true)
  })

  test("a detached wire is reported rather than passed", () => {
    const built = circuit().doc
    const net = built.nets![0]!
    const adrift: BlueprintDoc = {
      ...built,
      entities: built.entities.map((entity) =>
        entity.id === net.wire && entity.type === "polyline"
          ? { ...entity, pts: entity.pts.map(([x, y]) => [x + 10, y] as Pt) }
          : entity,
      ),
    }
    const messages = checkDoc(adrift, "electrical").findings.map((finding) => finding.message)
    expect(messages.some((message) => /is detached from/.test(message))).toBe(true)
  })
})

describe("polarity", () => {
  test("a battery knows which terminal is positive, and it survives rotation", () => {
    for (const spin of [0, 90, 180, 270]) {
      const built = applyOps(sheet(), [
        { op: "place", symbol: "electrical/battery", at: [50, 50], label: "BT1", ...(spin ? { rotate: spin } : {}) },
      ]).doc
      const bt1 = built.parts.find((part) => part.ref === "BT1")!
      expect(bt1.pins).toEqual(["+", "-"])
      expect(roleOf(bt1.pins![0])).toBe("+")
      expect(roleOf(bt1.pins![1])).toBe("-")
    }
  })

  test("rotating a part turns its pin directions with it", () => {
    const upright = applyOps(sheet(), [{ op: "place", symbol: "electrical/battery", at: [50, 50], label: "BT1" }]).doc
    const turned = applyOps(sheet(), [
      { op: "place", symbol: "electrical/battery", at: [50, 50], label: "BT1", rotate: 90 },
    ]).doc
    expect(dirsOf(upright.parts[0]!)).toEqual([
      [-1, 0],
      [1, 0],
    ])
    // A quarter turn clockwise in a Y-down space sends -X to -Y.
    expect(dirsOf(turned.parts[0]!)).toEqual([
      [0, -1],
      [0, 1],
    ])
  })

  test("a rotated battery still wires to the lamp without an overlap", () => {
    // The fix that was being done by hand in the first place, now falling out of the rules.
    const built = circuit(90)
    expect(built.doc.nets).toHaveLength(2)
    expect(overlapIn(built.doc)).toBe(0)
  })

  test("a supply pin joins a rail, and a GPIO is left alone", () => {
    const built = applyOps(sheet(), [
      { op: "place", symbol: "iot/esp32-devkit", at: [60, 100], label: "U1" },
      { op: "place", symbol: "electrical/supply-plus", at: [30, 60], label: "PWR" },
      { op: "place", symbol: "electrical/ground", at: [30, 140], label: "GND1" },
    ]).doc
    const joined = (built.nets ?? []).flatMap((net) => [net.from, net.to])
    const u1 = built.parts.find((part) => part.ref === "U1")!
    const named = (name: string) => `U1.${u1.pins!.indexOf(name) + 1}`
    expect(joined).toContain(named("3V3"))
    expect(joined).toContain(named("GND"))
    // A signal pin says nothing about what it should attach to, so nothing attaches to it.
    expect(joined).not.toContain(named("GPIO21 SDA"))
  })

  test("a source's + goes to the load's anode, and its − to the cathode", () => {
    // The request in one test: the lines are drawn to the + and the −, by name, not by
    // whichever terminal happens to be nearer.
    const built = applyOps(sheet(), [
      { op: "place", symbol: "electrical/battery", at: [40, 60], label: "BT1" },
      { op: "place", symbol: "electrical/led", at: [90, 60], label: "D1" },
    ]).doc
    const pairs = (built.nets ?? []).map((net) => `${net.from}→${net.to}`).sort()
    expect(pairs).toEqual(["BT1.1→D1.1", "BT1.2→D1.2"])
    const bt1 = built.parts.find((part) => part.ref === "BT1")!
    const d1 = built.parts.find((part) => part.ref === "D1")!
    expect([bt1.pins![0], d1.pins![0]]).toEqual(["+", "anode"])
    expect([bt1.pins![1], d1.pins![1]]).toEqual(["-", "cathode"])
  })

  test("a 3.3 V pin and a 5 V pin are never brought to the same rail", () => {
    // Both are "the positive end of something", and joining them shorts 3.3 V to 5 V — which
    // damages hardware rather than merely reading badly. One +V marker is one rail, and it
    // commits to the first voltage that names itself.
    const built = applyOps(sheet(), [
      { op: "place", symbol: "iot/esp32-devkit", at: [100, 100], label: "U1" },
      { op: "place", symbol: "electrical/supply-plus", at: [50, 50], label: "PWR" },
    ]).doc
    const u1 = built.parts.find((part) => part.ref === "U1")!
    const onRail = (built.nets ?? [])
      .flatMap((net) => [net.from, net.to])
      .filter((address) => address.startsWith("U1."))
      .map((address) => u1.pins![Number(address.slice(3)) - 1])
    expect(onRail).toContain("3V3")
    expect(onRail).not.toContain("VIN 5V")
  })

  test("one ground symbol takes every GND pin that returns to it", () => {
    // The other half of the same rule: a rail is a net label, not a terminal, so it stays
    // available however many conductors already reach it — including on a later edit.
    const first = applyOps(sheet(), [
      { op: "place", symbol: "iot/esp32-devkit", at: [100, 100], label: "U1" },
      { op: "place", symbol: "electrical/ground", at: [50, 150], label: "GND1" },
    ]).doc
    const toGround = (doc: BlueprintDoc) => (doc.nets ?? []).filter((net) => net.from === "GND1.1" || net.to === "GND1.1")
    expect(toGround(first).length).toBe(2)
    const later = applyOps(first, [{ op: "place", symbol: "iot/bme280", at: [170, 120], label: "S1" }]).doc
    expect(toGround(later).length).toBe(3)
    // And no port is ever wired to itself, which a rail on the free list makes possible.
    for (const net of later.nets ?? []) expect(net.from).not.toBe(net.to)
  })

  test("the rail rule needs a source, so two lone LEDs keep their anodes apart", () => {
    // `anode` reads as a positive end, but neither LED is a supply, and "both of these are
    // the positive end of something" is not a reason to run a rail between them. Rule 3 still
    // pairs the two, positive side to positive side, which is a parallel pair — what must not
    // happen is rule 2 treating one LED as the other's power supply.
    const built = applyOps(sheet(), [
      { op: "place", symbol: "electrical/led", at: [40, 40], label: "D1" },
      { op: "place", symbol: "electrical/led", at: [40, 80], label: "D2" },
    ]).doc
    expect((built.nets ?? []).map((net) => `${net.from}→${net.to}`).sort()).toEqual(["D1.1→D2.1", "D1.2→D2.2"])
  })
})

describe("wires follow the parts", () => {
  test("moving a part re-routes its nets back onto its ports", () => {
    const built = circuit().doc
    const l1 = built.parts.find((part) => part.ref === "L1")!
    const ids = built.entities.filter((entity) => entity.id?.startsWith(`${l1.prefix}-`)).map((entity) => entity.id!)
    const moved = applyOps(built, [{ op: "move", ids, by: [0, -40.64] }]).doc

    expect(moved.nets).toHaveLength(built.nets!.length)
    expect(staleNets(moved)).toEqual([])
    const port = moved.parts.find((part) => part.ref === "L1")!.ports[0]!
    for (const net of moved.nets!) {
      const wire = moved.entities.find((entity) => entity.id === net.wire)
      if (wire?.type !== "polyline") throw new Error("no wire")
      expect(wire.pts.at(-1)).toEqual(port)
    }
    expect(overlapIn(moved)).toBe(0)
    // And the wire ids did not change: a re-route is the same conductor redrawn, so `diff`
    // must not see it as one wire deleted and another added.
    expect(wires(moved).map((wire) => wire.id)).toEqual(wires(built).map((wire) => wire.id))
  })

  test("arranging a drawing takes the wires with it", () => {
    const built = circuit().doc
    const tidied = applyOps(built, [{ op: "arrange" }]).doc
    expect(staleNets(tidied)).toEqual([])
  })

  test("deleting a part's geometry drops the nets that named it", () => {
    const built = circuit().doc
    const l1 = built.parts.find((part) => part.ref === "L1")!
    const ids = built.entities.filter((entity) => entity.id?.startsWith(`${l1.prefix}-`)).map((entity) => entity.id!)
    const after = applyOps(built, [{ op: "delete", ids }]).doc
    expect(after.nets).toEqual([])
    expect(after.parts.some((part) => part.ref === "L1")).toBe(false)
  })
})

describe("labels", () => {
  test("two parts a grid step apart do not stack their labels", () => {
    const built = applyOps(sheet(), [
      { op: "place", symbol: "electrical/resistor", at: [60, 60], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [60, 65.08], label: "R2" },
    ]).doc
    const labels = built.entities.filter(
      (entity): entity is Extract<Entity, { type: "text" }> => entity.type === "text" && /-label$/.test(entity.id ?? ""),
    )
    expect(labels).toHaveLength(2)
    const [a, b] = labels.map(textBox)
    expect(a![0] < b![2] && a![2] > b![0] && a![1] < b![3] && a![3] > b![1]).toBe(false)
  })

  test("a label already in a clear spot is left where it is", () => {
    const built = applyOps(sheet(), [{ op: "place", symbol: "electrical/resistor", at: [60, 60], label: "R1" }]).doc
    const label = built.entities.find((entity) => entity.id?.endsWith("-label"))!
    // The part snaps to the 2.54 grid, so it sits at 60.96 rather than the 60 asked for, and
    // the label keeps its default six units above it — unmoved, because settling must not
    // fidget with a label that is already readable.
    expect(built.parts[0]!.at).toEqual([60.96, 60.96])
    expect(label.type === "text" && label.at).toEqual([60.96, 54.96])
  })
})

describe("the derived passes settle", () => {
  test("applying nothing twice produces the same file, byte for byte", () => {
    // The web editor journals ops on the client and the server re-applies the same list to the
    // stored document. A pass that changed its mind on a second run would save a drawing that
    // differs from the one the user approved.
    const once = applyOps(circuit().doc, []).doc
    const twice = applyOps(once, []).doc
    expect(serialize(twice)).toEqual(serialize(once))
  })

  test("auto-wiring never proposes a connection twice", () => {
    const built = circuit().doc
    expect(autowireOps(built)).toEqual([])
  })

  test("auto-wiring says what it did rather than doing it quietly", () => {
    expect(circuit().summary).toMatch(/auto-wired BT1\.1→L1\.1, BT1\.2→L1\.1/)
  })

  test("a port already wired by hand is not re-wired", () => {
    const wired = applyOps(sheet(), [
      { op: "place", symbol: "electrical/resistor", at: [40, 40], label: "R1" },
      { op: "place", symbol: "electrical/resistor", at: [90, 40], label: "R2" },
      { op: "connect", from: "R1.2", to: "R2.1" },
    ]).doc
    // Rule 3 fires on placement, so the explicit connect is a third net on already-used
    // ports — but nothing is ever wired twice by the rules themselves.
    const pairs = (wired.nets ?? []).map((net) => `${net.from}-${net.to}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(autowireOps(wired)).toEqual([])
  })
})

describe("routing rules", () => {
  test("a degenerate request still yields a drawable polyline", () => {
    // Connecting a point to itself is meaningless, but it is reachable — two parts snapped
    // together put two ports on one spot. What must not happen is a one-point "polyline",
    // which is not a polyline and would be rejected deep inside `applyOps` instead of here.
    const route = routeWire({ from: [0, 0], to: [0, 0], fromDir: [1, 0], toDir: [1, 0] })
    expect(route.path.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < route.path.length; i += 1) {
      const a = route.path[i - 1]!
      const b = route.path[i]!
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true)
    }
  })

  test("a route is orthogonal whatever the escape directions", () => {
    for (const toDir of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Pt[]) {
      const route = routeWire({ from: [0, 0], to: [40, 30], fromDir: [1, 0], toDir })
      for (let i = 1; i < route.path.length; i += 1) {
        const a = route.path[i - 1]!
        const b = route.path[i]!
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true)
      }
    }
  })

  test("a second wire between the same pair of points steps aside from the first", () => {
    const first = routeWire({ from: [0, 0], to: [40, 0], fromDir: [1, 0], toDir: [-1, 0] })
    const runs = first.path.slice(1).map((point, i) => [first.path[i]!, point] as [Pt, Pt])
    const second = routeWire({ from: [0, 0], to: [40, 0], fromDir: [1, 0], toDir: [-1, 0], wires: runs })
    let total = 0
    for (let i = 1; i < second.path.length; i += 1) {
      for (const [c, d] of runs) total += shared(second.path[i - 1]!, second.path[i]!, c, d)
    }
    // Not zero, and it cannot be: both ports face along the same axis, so each wire's escape
    // stub has to lie on that axis for its grid step. What matters is that the long run in
    // between moved off it — the two conductors are distinguishable everywhere except at the
    // ports they share.
    expect(second.path.length).toBeGreaterThan(first.path.length)
    expect(total).toBeLessThanOrEqual(2 * 2.54 + 1e-9)
  })
})

describe("nets survive a sync", () => {
  const base = () =>
    applyOps(sheet(), [
      { op: "place", symbol: "electrical/resistor", at: [40, 40], label: "R1" },
      { op: "place", symbol: "electrical/lamp", at: [100, 40], label: "L1" },
      { op: "place", symbol: "electrical/resistor", at: [40, 120], label: "R2" },
      { op: "place", symbol: "electrical/lamp", at: [100, 120], label: "L2" },
    ]).doc

  test("a wire drawn on one device is not lost when the other merges", () => {
    // `merge3` builds its result by spreading ours, so a field it does not name explicitly
    // arrives from our side alone — which for nets means silently dropping every connection
    // the other device made.
    const start = base()
    const ours = applyOps(start, [{ op: "connect", from: "R1.1", to: "R2.1" }]).doc
    const theirs = applyOps(start, [{ op: "connect", from: "L1.1", to: "L2.1" }]).doc
    const { doc } = merge3(start, ours, theirs)
    const pairs = (doc.nets ?? []).map((net) => `${net.from}→${net.to}`)
    expect(pairs).toContain("R1.1→R2.1")
    expect(pairs).toContain("L1.1→L2.1")
  })

  test("the same connection made on both devices stays one net", () => {
    const start = base()
    const ours = applyOps(start, [{ op: "connect", from: "R1.1", to: "R2.1" }]).doc
    const theirs = applyOps(start, [{ op: "connect", from: "R2.1", to: "R1.1" }]).doc
    const { doc } = merge3(start, ours, theirs)
    // Keyed on the ports, in either order — the same two people wiring the same two pins have
    // made one connection, whatever ids their counters handed out.
    const between = (doc.nets ?? []).filter((net) =>
      [net.from, net.to].sort().join("|") === ["R1.1", "R2.1"].sort().join("|"),
    )
    expect(between).toHaveLength(1)
  })

  test("every merged net still points at a wire and two real ports", () => {
    const start = base()
    const ours = applyOps(start, [{ op: "connect", from: "R1.1", to: "R2.1" }]).doc
    const theirs = applyOps(start, [{ op: "connect", from: "L1.1", to: "L2.1" }]).doc
    const { doc } = merge3(start, ours, theirs)
    const findings = checkDoc(doc, "electrical").findings
    expect(findings.filter((finding) => /has no wire drawn|is not a port/.test(finding.message))).toEqual([])
    expect(new Set((doc.nets ?? []).map((net) => net.id)).size).toBe((doc.nets ?? []).length)
  })
})
