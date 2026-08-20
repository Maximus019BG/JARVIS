import { bbox } from "./geom.ts"
import { BlueprintError, type BlueprintDoc, type Part, type Pt } from "./schema.ts"
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

/**
 * The five orthogonal shapes worth trying between two points: straight, the two L's, and
 * the two Z's that split the difference. One of them is right in almost every schematic,
 * and the scoring picks it.
 *
 * ponytail: five fixed candidates, no grid search. If a real drawing defeats all five the
 * upgrade is A* over the grid graph — but a dense enough board to need it wants a human.
 */
export function routeWire(from: Pt, to: Pt, obstacles: readonly Box[]): Route {
  const midX = snap((from[0] + to[0]) / 2)
  const midY = snap((from[1] + to[1]) / 2)
  const candidates: Pt[][] = [
    // Only when the two already line up. A straight run between points that share neither
    // axis is a diagonal, and it would win every score — no bends and the shortest
    // Manhattan length — which is how a schematic ends up with wires at 37°.
    ...(from[0] === to[0] || from[1] === to[1] ? [[from, to] as Pt[]] : []),
    [from, [to[0], from[1]], to],
    [from, [from[0], to[1]], to],
    [from, [midX, from[1]], [midX, to[1]], to],
    [from, [from[0], midY], [to[0], midY], to],
  ]

  let best: { path: Pt[]; hits: number } | undefined
  for (const raw of candidates) {
    const path = tidy(raw)
    let hits = 0
    for (let i = 1; i < path.length; i += 1) {
      for (const box of obstacles) {
        if (crosses(path[i - 1]!, path[i]!, box)) hits += 1
      }
    }
    const better =
      !best ||
      hits < best.hits ||
      (hits === best.hits &&
        (bends(path) < bends(best.path) || (bends(path) === bends(best.path) && length(path) < length(best.path))))
    if (better) best = { path, hits }
  }

  // Every candidate crosses something: still emit the best of them and say so. A wire the
  // user can see and drag is worth more than a refusal that leaves the schematic empty.
  return { path: best!.path, blocked: best!.hits > 0 }
}

/** Every part's footprint except the two being wired — those are the endpoints. */
export function obstaclesFor(doc: BlueprintDoc, exclude: readonly string[]): Box[] {
  const skip = new Set(exclude.map((ref) => ref.toLowerCase()))
  return (doc.parts ?? [])
    .filter((part) => !skip.has(part.ref.toLowerCase()))
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

/**
 * Which of `ends` land in the middle of a wire that is already drawn.
 *
 * A T where three conductors meet and a crossing where two merely pass over each other
 * are the same two lines on paper; the dot is the only thing that says which. Placing one
 * is therefore not decoration — a reader without it cannot tell the circuit apart from a
 * different circuit.
 *
 * Only interiors count: two wires meeting end to end at a port are already unambiguous.
 */
export function junctionsAt(doc: BlueprintDoc, ends: readonly Pt[]): Pt[] {
  const wires = doc.entities.filter((entity) => entity.type === "polyline" && /^w\d+$/.test(entity.id ?? ""))
  const found: Pt[] = []
  for (const end of ends) {
    const hit = wires.some(
      (wire) =>
        wire.type === "polyline" &&
        wire.pts.slice(1).some((point, index) => onSegment(end, wire.pts[index]!, point)),
    )
    if (hit && !found.some((seen) => seen[0] === end[0] && seen[1] === end[1])) found.push(end)
  }
  return found
}
