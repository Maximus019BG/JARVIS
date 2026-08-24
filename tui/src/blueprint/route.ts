import { bbox } from "./geom.ts"
import type { Op } from "./ops.ts"
import { dirsOf } from "./place.ts"
import { BlueprintError, type BlueprintDoc, type Entity, type Net, type Part, type Pt } from "./schema.ts"
import { GRID } from "./symbols/index.ts"

/**
 * Wire routing: given two ports, produce the path a person would have drawn.
 *
 * Schematic wires are orthogonal — horizontal and vertical runs only — and readable ones
 * have as few bends as possible and do not pass through the parts they are meant to be
 * connecting. That is the whole rule set, and it is enough that the caller never has to
 * name a coordinate: it names two ports and gets a route.
 */

/** How far a wire keeps away from a part it is not connecting to, in document units. */
const CLEARANCE = GRID / 2

type Box = [number, number, number, number]

const snap = (value: number) => Math.round(value / GRID) * GRID

/**
 * Resolves `"R1.2"` to a point. Case-insensitive on the ref and 1-based on the port,
 * matching how ports are numbered everywhere the caller sees them.
 *
 * An unknown ref lists the refs that do exist. A caller that has just guessed a name will
 * guess again if all it is told is "no".
 */
export function portAt(doc: BlueprintDoc, address: string): Pt {
  const dot = address.lastIndexOf(".")
  if (dot === -1) {
    throw new BlueprintError(`"${address}" is not a port — write it as REF.PORT, e.g. "R1.2"`)
  }
  const ref = address.slice(0, dot).trim().toLowerCase()
  const index = Number(address.slice(dot + 1))
  const parts = doc.parts ?? []
  const part = parts.find((candidate) => candidate.ref.toLowerCase() === ref)
  if (!part) {
    const known = parts.map((candidate) => candidate.ref).join(", ")
    throw new BlueprintError(
      `no part called "${address.slice(0, dot)}"${known ? ` — the drawing has ${known}` : " — nothing has been placed yet"}`,
    )
  }
  if (!Number.isInteger(index) || index < 1 || index > part.ports.length) {
    throw new BlueprintError(
      part.ports.length === 0
        ? `${part.ref} (${part.symbol}) has no connection points`
        : `${part.ref} has ports 1..${part.ports.length}, not ${address.slice(dot + 1)}`,
    )
  }
  return part.ports[index - 1]!
}

/** A part's footprint, inflated by the clearance, as an obstacle to route around. */
function obstacle(doc: BlueprintDoc, part: Part): Box | undefined {
  const owned = doc.entities.filter((entity) => entity.id?.startsWith(`${part.prefix}-`))
  const box = bbox(owned)
  if (!box) return undefined
  return [box[0] - CLEARANCE, box[1] - CLEARANCE, box[2] + CLEARANCE, box[3] + CLEARANCE]
}

/** Does the segment a-b intersect the box? Both are axis-aligned, so this stays cheap. */
function crosses(a: Pt, b: Pt, box: Box): boolean {
  const [x0, y0, x1, y1] = box
  const loX = Math.min(a[0], b[0])
  const hiX = Math.max(a[0], b[0])
  const loY = Math.min(a[1], b[1])
  const hiY = Math.max(a[1], b[1])
  // Touching the boundary is fine — a wire may run along a part's clearance edge, and
  // treating that as a crossing would reject the tidiest route there is.
  return loX < x1 && hiX > x0 && loY < y1 && hiY > y0
}

const bends = (path: Pt[]) => Math.max(0, path.length - 2)

const length = (path: Pt[]) =>
  path.slice(1).reduce((total, point, i) => total + Math.abs(point[0] - path[i]![0]) + Math.abs(point[1] - path[i]![1]), 0)

/** Drops waypoints that do not turn, so a straight run never ships as three points. */
function tidy(path: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const point of path) {
    const last = out.at(-1)
    if (last && last[0] === point[0] && last[1] === point[1]) continue
    out.push(point)
  }
  return out.filter((point, i) => {
    if (i === 0 || i === out.length - 1) return true
    const before = out[i - 1]!
    const after = out[i + 1]!
    const straightX = before[0] === point[0] && point[0] === after[0]
    const straightY = before[1] === point[1] && point[1] === after[1]
    return !(straightX || straightY)
  })
}

export type Route = { path: Pt[]; blocked: boolean }

/** A straight run of wire already on the sheet, as a pair of endpoints. */
export type Seg = [Pt, Pt]

/**
 * How much of a-b runs *along* c-d rather than merely across it.
 *
 * Two wires crossing at a right angle is ordinary and legal on a schematic — a reader takes
 * it as "no connection" unless there is a dot. Two wires sharing a stretch of the same line
 * is not legal and not readable: it draws one line where the circuit has two conductors, and
 * no dot can disambiguate it. So a crossing costs nothing here and a shared run costs a lot.
 */
function sharedRun(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const tol = GRID / 16
  const vertical = Math.abs(a[0] - b[0]) < tol && Math.abs(c[0] - d[0]) < tol
  const horizontal = Math.abs(a[1] - b[1]) < tol && Math.abs(c[1] - d[1]) < tol
  if (vertical && Math.abs(a[0] - c[0]) < tol) {
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
    return Math.max(0, hi - lo)
  }
  if (horizontal && Math.abs(a[1] - c[1]) < tol) {
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))
    return Math.max(0, hi - lo)
  }
  return 0
}

/** Total length this path spends lying on top of wires already drawn. */
function overlap(path: Pt[], wires: readonly Seg[]): number {
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    for (const [c, d] of wires) total += sharedRun(path[i - 1]!, path[i]!, c, d)
  }
  return total
}

/** The axis a segment runs along, as a unit vector, or [0,0] for a zero-length one. */
function heading(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return [0, 0]
  return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]
}

const facing = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

/** Whether the path's first run heads out along the pin it starts on. */
const leaves = (path: Pt[], dir: Pt): boolean =>
  (dir[0] === 0 && dir[1] === 0) || (path.length > 1 && facing(heading(path[0]!, path[1]!), dir))

/** Whether the path's last run comes *in* along the pin it ends on — the reverse of its dir. */
const arrives = (path: Pt[], dir: Pt): boolean =>
  (dir[0] === 0 && dir[1] === 0) ||
  (path.length > 1 && facing(heading(path.at(-2)!, path.at(-1)!), [-dir[0], -dir[1]]))

/** The four ways out of a port, for a port that has no preferred one. */
const AXES: Pt[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export type RouteRequest = {
  from: Pt
  to: Pt
  /**
   * The way each wire must leave its port — outward from the body, as `dirs` records it.
   * `[0, 0]` or omitted means the port has no preferred side (a lamp, a junction dot: a
   * single point at the middle of its own symbol), and every direction is tried.
   */
  fromDir?: Pt
  toDir?: Pt
  obstacles?: readonly Box[]
  /** Wires already on the sheet, which this route must not run along. */
  wires?: readonly Seg[]
}

/**
 * Wire routing: given two ports, the path a person would have drawn.
 *
 * Two rules beyond "orthogonal and few bends", both learned from drawings that came out
 * wrong:
 *
 * A wire leaves a pin *along* the pin, then turns. Anything else reads as a line that
 * happens to end near a part rather than a wire connected to it, and on a rotated part it
 * reads as a mistake.
 *
 * A wire does not share a line with another wire. Two conductors drawn on top of each other
 * are indistinguishable from one, which is how a battery and a lamp on the same axis
 * produced a circuit that looked like a single wire — the bug this rule exists for.
 *
 * ponytail: five orthogonal shapes per escape pair, no grid search. A board dense enough to
 * defeat all of them wants a human, not a wider search.
 */
export function routeWire(request: RouteRequest): Route {
  const { from, to, obstacles = [], wires = [] } = request
  const fromWays = request.fromDir && (request.fromDir[0] !== 0 || request.fromDir[1] !== 0) ? [request.fromDir] : AXES
  const toWays = request.toDir && (request.toDir[0] !== 0 || request.toDir[1] !== 0) ? [request.toDir] : AXES

  // Corridors the parts nominate: a grid line just clear of each edge. Deduplicated and
  // sorted so the candidate order — and so the chosen route, when two score equally — does
  // not depend on the order the parts happen to sit in the document.
  /**
   * Corridor coordinates, deduplicated and sorted so the candidate order — and so the chosen
   * route, when two score equally — does not depend on the order the parts sit in the file.
   *
   * Each nominated coordinate brings its immediate neighbours, which is what lets a second
   * wire run *beside* a first rather than on it. Without them the only clean lane past a part
   * is the one just off its edge, and once one wire has taken it the next has to choose
   * between lying on that wire and cutting through the part.
   */
  const lanes = (values: number[]) =>
    [...new Set(values.flatMap((value) => [snap(value) - GRID, snap(value), snap(value) + GRID]))].sort((x, y) => x - y)
  // Each part's edges, plus a grid step either side of both endpoints. The endpoint lanes are
  // what give a wire somewhere to go when there are no parts in the way at all: two ports
  // facing each other across empty space have no obstacle to nominate a corridor, so without
  // these the only candidate is the straight line — and a second wire between the same two
  // points would have no choice but to lie on top of the first.
  const aside = (value: number) => [value - GRID, value + GRID]
  const edgesX = lanes([
    ...obstacles.flatMap((box) => [box[0] - CLEARANCE, box[2] + CLEARANCE]),
    ...aside(from[0]),
    ...aside(to[0]),
  ])
  const edgesY = lanes([
    ...obstacles.flatMap((box) => [box[1] - CLEARANCE, box[3] + CLEARANCE]),
    ...aside(from[1]),
    ...aside(to[1]),
  ])

  let best: { path: Pt[]; hits: number; shared: number } | undefined
  for (const out of fromWays) {
    for (const back of toWays) {
      // The stubs are part of the route, not a nudge to the endpoints: the wire starts at
      // the port, runs a grid step along the pin, and only then is free to turn.
      const a: Pt = [from[0] + out[0] * GRID, from[1] + out[1] * GRID]
      const b: Pt = [to[0] + back[0] * GRID, to[1] + back[1] * GRID]
      const shapes: Pt[][] = [
        // Only when the stub ends already line up. A straight run between points sharing
        // neither axis is a diagonal, and it would win every score — no bends and the
        // shortest Manhattan length — which is how a schematic ends up with wires at 37°.
        ...(a[0] === b[0] || a[1] === b[1] ? [[a, b] as Pt[]] : []),
        [a, [b[0], a[1]], b],
        [a, [a[0], b[1]], b],
        // Z shapes through a chosen corridor. Splitting the difference is the obvious
        // corridor and often the wrong one: wiring both ends of a battery to one lamp needs a
        // run that clears the battery, and the midpoint between two ports on the battery's own
        // axis is inside the battery. So the parts nominate corridors too — just past each of
        // their edges — which is where a person would have drawn it.
        ...[snap((a[0] + b[0]) / 2), ...edgesX].map((x) => [a, [x, a[1]], [x, b[1]], b] as Pt[]),
        ...[snap((a[1] + b[1]) / 2), ...edgesY].map((y) => [a, [a[0], y], [b[0], y], b] as Pt[]),
      ]
      for (const shape of shapes) {
        const path = tidy([from, ...shape, to])
        // The escape has to survive `tidy`. When the stub runs back along the route — a port
        // on the left of a part wired to something on its right — every point is collinear
        // and the stub is folded away, leaving a straight line that starts by going the wrong
        // way and ploughs through the part it just left. Checking the direction of the
        // finished path, rather than trusting that a stub was prepended, is what makes "a
        // wire leaves along its pin" a rule instead of a suggestion.
        if (!leaves(path, out) || !arrives(path, back)) continue
        let hits = 0
        for (let i = 1; i < path.length; i += 1) {
          // The stubs themselves are exempt: they start on a port, which by construction sits
          // inside its own part's inflated footprint, so testing them would reject every
          // route there is. Everything after them is tested against every part — including
          // the two being wired, or a wire could leave a battery's left terminal and go back
          // through the battery.
          if (i === 1 || i === path.length - 1) continue
          for (const box of obstacles) {
            if (crosses(path[i - 1]!, path[i]!, box)) hits += 1
          }
        }
        const shared = overlap(path, wires)
        const better =
          !best ||
          shared < best.shared - 1e-9 ||
          (Math.abs(shared - best.shared) < 1e-9 &&
            (hits < best.hits ||
              (hits === best.hits &&
                (bends(path) < bends(best.path) ||
                  (bends(path) === bends(best.path) && length(path) < length(best.path))))))
        if (better) best = { path, hits, shared }
      }
    }
  }

  // Every candidate crosses something: still emit the best of them and say so. A wire the
  // user can see and drag is worth more than a refusal that leaves the schematic empty.
  // Nothing at all satisfied the escape rules — two ports facing directly away from each
  // other with no room to turn — so fall back to the plain L and flag it. `tidy` collapses
  // that to a single point when the two ports coincide, and a one-point polyline is not a
  // polyline, so the untidied pair is the floor.
  if (!best) {
    const fallback = tidy([from, [to[0], from[1]], to])
    return { path: fallback.length >= 2 ? fallback : [from, to], blocked: true }
  }
  return { path: best.path, blocked: best.hits > 0 }
}

/**
 * Every part's footprint, as something for a wire to keep out of.
 *
 * Including the two parts being wired, which used to be excluded. A wire has to keep out of
 * the part it leaves as much as any other — a battery whose left terminal is wired to
 * something on its right must go around itself — and the router exempts the escape stubs
 * instead, so the ports stay reachable without opening the bodies up.
 */
export function obstaclesFor(doc: BlueprintDoc): Box[] {
  return (doc.parts ?? [])
    .map((part) => obstacle(doc, part))
    .filter((box): box is Box => box !== undefined)
}

/** The ref half of a `"REF.PORT"` address. */
export const refOf = (address: string): string => address.slice(0, Math.max(0, address.lastIndexOf(".")))

/** Whether `p` sits on the segment a-b, within a fraction of a grid step. */
function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const tolerance = GRID / 8
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
  const span = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (span === 0 || Math.abs(cross) / span > tolerance) return false
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])
  return dot > tolerance && dot < span * span - tolerance
}


/** Every wire polyline currently on the sheet, as an id and its runs. */
export function wireSegments(doc: BlueprintDoc, exclude: readonly string[] = []): Seg[] {
  const skip = new Set(exclude)
  const out: Seg[] = []
  for (const entity of doc.entities) {
    if (entity.type !== "polyline" || !/^w\d+$/.test(entity.id ?? "") || skip.has(entity.id!)) continue
    for (let i = 1; i < entity.pts.length; i += 1) out.push([entity.pts[i - 1]!, entity.pts[i]!])
  }
  return out
}

/** The part a `"REF.PORT"` address names, or undefined. */
const partOf = (doc: BlueprintDoc, address: string): Part | undefined => {
  const ref = refOf(address).toLowerCase()
  return (doc.parts ?? []).find((part) => part.ref.toLowerCase() === ref)
}

/** The outward direction of the port a `"REF.PORT"` address names. */
export function dirAt(doc: BlueprintDoc, address: string): Pt {
  const part = partOf(doc, address)
  if (!part) return [0, 0]
  const index = Number(address.slice(address.lastIndexOf(".") + 1))
  return dirsOf(part)[index - 1] ?? [0, 0]
}

/** The pin name of the port a `"REF.PORT"` address names, if the symbol declares one. */
export function pinAt(doc: BlueprintDoc, address: string): string | undefined {
  const part = partOf(doc, address)
  if (!part?.pins) return undefined
  return part.pins[Number(address.slice(address.lastIndexOf(".") + 1)) - 1]
}

/** Whether a net has either end on any of these refs. */
export const netTouches = (net: Net, refs: ReadonlySet<string>): boolean =>
  refs.has(refOf(net.from).toLowerCase()) || refs.has(refOf(net.to).toLowerCase())

/**
 * The route for one net as the drawing stands, ignoring whatever polyline currently draws
 * it — so re-routing a net does not try to avoid its own old path.
 */
export function routeNet(doc: BlueprintDoc, net: Net, extraWires: readonly Seg[] = []): Route {
  return routeWire({
    from: portAt(doc, net.from),
    to: portAt(doc, net.to),
    fromDir: dirAt(doc, net.from),
    toDir: dirAt(doc, net.to),
    obstacles: obstaclesFor(doc),
    wires: [...wireSegments(doc, [net.wire]), ...extraWires],
  })
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/**
 * The nets whose drawn wire no longer meets the ports it claims to join.
 *
 * Deliberately narrow. Re-routing *every* net on every settle would also rewrite wires that
 * are fine, which costs the drawing any hand-nudged geometry and — worse — cannot settle:
 * each net's route avoids the others, so recomputing them all in sequence lets two nets
 * trade paths forever and the same document serialise differently twice running. A net whose
 * ends still land on its ports is already correct, so it is left exactly as it is.
 */
export function staleNets(doc: BlueprintDoc): Net[] {
  return (doc.nets ?? []).filter((net) => {
    const wire = doc.entities.find((entity) => entity.id === net.wire)
    if (!wire || wire.type !== "polyline") return true
    try {
      return !same(wire.pts[0]!, portAt(doc, net.from)) || !same(wire.pts.at(-1)!, portAt(doc, net.to))
    } catch {
      // The net names a port that no longer exists; `settle` cannot fix that, and the
      // checker reports it. Not stale, just broken.
      return false
    }
  })
}

/**
 * Ops that redraw every net that has come unstuck from its ports.
 *
 * The wire keeps its id and the net keeps its id: only `pts` change. That matters more than
 * it looks — `diff` and `merge3` key on entity id, so deleting the old polyline and adding a
 * new one would report a moved wire as an unrelated delete plus add, and a three-way merge
 * would have to guess.
 */
export function rerouteOps(doc: BlueprintDoc): Op[] {
  const ops: Op[] = []
  const decided: Seg[] = []
  for (const net of staleNets(doc)) {
    let route: Route
    try {
      route = routeNet(doc, net, decided)
    } catch {
      continue
    }
    for (let i = 1; i < route.path.length; i += 1) decided.push([route.path[i - 1]!, route.path[i]!])
    ops.push({ op: "update", id: net.wire, patch: { pts: route.path } })
    if (net.label && doc.entities.some((entity) => entity.id === `${net.wire}-label`)) {
      const mid = route.path[Math.floor(route.path.length / 2)] ?? route.path[0]!
      ops.push({ op: "update", id: `${net.wire}-label`, patch: { at: [mid[0], mid[1] - 1.5] } })
    }
  }
  return ops
}

const JUNCTION = "junction-dot"

/** Junction dots currently placed, as `[ref, point]`. */
const placedDots = (doc: BlueprintDoc): Part[] =>
  (doc.parts ?? []).filter((part) => part.symbol.endsWith(JUNCTION))

/**
 * Ops that make the junction dots match the wires.
 *
 * A T where three conductors meet and a crossing where two merely pass over each other are
 * the same two lines on paper; the dot is the only thing that says which. Placing one is
 * therefore not decoration — a reader without it cannot tell the circuit apart from a
 * different circuit. Removing a stale one matters just as much: a dot left behind after a
 * part moved away asserts a connection that is no longer drawn.
 */
export function junctionOps(doc: BlueprintDoc, layer?: string): Op[] {
  const wires = doc.entities.filter(
    (entity): entity is Extract<Entity, { type: "polyline" }> =>
      entity.type === "polyline" && /^w\d+$/.test(entity.id ?? ""),
  )
  // Every wire end that lands in the middle of a different wire.
  const wanted: Pt[] = []
  for (const wire of wires) {
    for (const end of [wire.pts[0]!, wire.pts.at(-1)!]) {
      const onOther = wires.some(
        (other) =>
          other.id !== wire.id && other.pts.slice(1).some((point, i) => onSegment(end, other.pts[i]!, point)),
      )
      if (onOther && !wanted.some((seen) => same(seen, end))) wanted.push(end)
    }
  }
  const dots = placedDots(doc)
  const ops: Op[] = []
  for (const dot of dots) {
    if (wanted.some((at) => same(at, dot.at))) continue
    const ids = doc.entities.filter((entity) => entity.id?.startsWith(`${dot.prefix}-`)).map((entity) => entity.id!)
    if (ids.length > 0) ops.push({ op: "delete", ids })
  }
  const domain = findDomain(doc)
  for (const at of wanted) {
    if (dots.some((dot) => same(dot.at, at))) continue
    ops.push({ op: "place", symbol: `${domain}/${JUNCTION}`, at, ...(layer ? { layer } : {}) })
  }
  return ops
}

/**
 * Which library's junction dot to use. Both the electrical and the iot library define one,
 * so a bare name would silently take whichever library is declared first.
 */
function findDomain(doc: BlueprintDoc): string {
  const part = (doc.parts ?? []).find((candidate) => !candidate.symbol.endsWith(JUNCTION))
  const slash = part?.symbol.indexOf("/") ?? -1
  return slash > 0 ? part!.symbol.slice(0, slash) : "electrical"
}
