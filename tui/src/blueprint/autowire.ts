import type { Op } from "./ops.ts"
import { dirsOf } from "./place.ts"
import { wireSegments } from "./route.ts"
import type { BlueprintDoc, Part, Pt } from "./schema.ts"
import { findSymbol, GRID, roleOf } from "./symbols/index.ts"

/**
 * Drawing the connections nobody asked for out loud.
 *
 * Every rule here is a rule, not a guess: a table of pin names, a distance threshold, a
 * nearest-neighbour with a documented tie-break. Nothing infers intent, because a system that
 * is usually right about intent is worse than one that is predictably literal — a wire you
 * did not expect is harder to notice than a wire that is missing.
 *
 * Two properties keep it safe to run after every single edit:
 *
 * A port that already has a net is never a candidate. So this can never argue with the user
 * about a connection they have already made or deliberately removed, and re-running it on a
 * settled drawing produces nothing.
 *
 * Nothing reaches further than `REACH`. A part dropped on the far side of the sheet is not
 * evidence that it belongs to anything.
 */

/** How close two things must be for rule 1 to treat them as already touching. */
const TOUCH = GRID / 2

type PortRef = { address: string; at: Pt; dir: Pt; pin?: string; part: Part }

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Symbols whose whole job is to be a supply: the only things rule 2 will wire *to*. */
const SOURCE = /(^|\/)(supply-|ground|earth|battery$|cell$|psu|power-supply)/

const isSource = (part: Part) => SOURCE.test(part.symbol)

/**
 * The volts a pin name commits to, if it names any.
 *
 * This is not decoration. `3V3` and `VIN 5V` are both "the positive end of something", and
 * wiring them to one rail shorts 3.3 V to 5 V — which damages hardware rather than merely
 * looking wrong on paper. A rule that reads pin names has to read all of what they say.
 */
export function voltsOf(pin: string | undefined): number | undefined {
  for (const token of (pin ?? "").toLowerCase().split(/[\s/,]+/)) {
    const match = /^([0-9]+)v([0-9]+)?$|^([0-9]+(?:\.[0-9]+)?)v$/.exec(token)
    if (!match) continue
    // `3v3` is 3.3 V written the way it is silkscreened; `3.3v` and `5v` are the plain forms.
    if (match[1]) return Number(match[2] ? `${match[1]}.${match[2]}` : match[1])
    if (match[3]) return Number(match[3])
  }
  return undefined
}

/**
 * Every port with no net on it yet.
 *
 * Junction dots are excluded: a dot is a mark saying wires meet here, not a component with
 * terminals of its own, and auto-wiring one would have it grow spurious legs.
 */
function freePorts(doc: BlueprintDoc): PortRef[] {
  const used = netted(doc)
  const out: PortRef[] = []
  for (const part of doc.parts ?? []) {
    if (part.symbol.endsWith("junction-dot")) continue
    const dirs = dirsOf(part)
    part.ports.forEach((at, i) => {
      const address = `${part.ref}.${i + 1}`
      // A rail marker is a net label, not a terminal: one ground symbol is what a dozen GND
      // pins return to, so it stays available however many wires already reach it. Everything
      // else is spoken for once it has one.
      if (used.has(address.toLowerCase()) && !isSource(part)) return
      out.push({ address, at, dir: dirs[i] ?? [0, 0], pin: part.pins?.[i], part })
    })
  }
  return out
}

/** Every port address that already has a net on it. */
function netted(doc: BlueprintDoc): Set<string> {
  const used = new Set<string>()
  for (const net of doc.nets ?? []) {
    used.add(net.from.toLowerCase())
    used.add(net.to.toLowerCase())
  }
  return used
}

/** Whether a point lies on one of these wire runs, ends included. */
function onWire(doc: BlueprintDoc, at: Pt): boolean {
  return wireSegments(doc).some(([a, b]) => {
    const span = dist(a, b)
    if (span === 0) return dist(a, at) <= TOUCH
    const t = ((at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1])) / (span * span)
    if (t < 0 || t > 1) return false
    const foot: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    return dist(foot, at) <= TOUCH
  })
}

/**
 * The connections the drawing implies but does not yet have.
 *
 * Rules run in order and each takes ports out of play for the ones after it, so the cheapest
 * and most certain evidence wins: touching beats matching names, and matching names beats
 * being the only other two-terminal part nearby.
 */
export function autowireOps(doc: BlueprintDoc): Op[] {
  const ops: Op[] = []
  const claimed = new Set<string>()
  const free = freePorts(doc)
  /** Ports that already have a conductor on them, rails included. */
  const already = netted(doc)
  const open = () => free.filter((port) => !claimed.has(port.address))
  const join = (a: PortRef, b: PortRef) => {
    if (a.address === b.address) return
    claimed.add(a.address)
    claimed.add(b.address)
    ops.push({ op: "connect", from: a.address, to: b.address })
  }

  // ── Rule 1: it is already touching ────────────────────────────────────────────────
  // Two ports on the same point, or a port dropped onto an existing wire. This is what
  // every schematic editor does when you drag a part onto a conductor, and it is the one
  // rule with no distance judgement in it at all: the user put them in the same place.
  for (const port of open()) {
    // The list was taken before any of this ran, so a port an earlier iteration already spoke
    // for is still in it. Without this check one rail ends up claimed twice over.
    if (claimed.has(port.address)) continue
    // Rails stay on the free list so many pins can return to one ground, which lets an already
    // wired rail reach this rule — and a rail is an endpoint of its own wires, so "this port is
    // sitting on a wire" would be true of every one of them and join it to itself. This rule is
    // about something newly placed landing on something already there.
    if (already.has(port.address.toLowerCase())) continue
    const partner = open().find(
      (other) =>
        other.address !== port.address &&
        other.part.ref !== port.part.ref &&
        // Near enough to be touching, but not *exactly* on top of each other: two ports at
        // the identical point have no wire between them to draw, and a zero-length polyline
        // is not a conductor. The checker reports both as unconnected, which is the honest
        // answer — nudge one part off the other and they wire themselves.
        dist(other.at, port.at) > 1e-6 &&
        dist(other.at, port.at) <= TOUCH,
    )
    if (partner) {
      join(port, partner)
      continue
    }
    // A port sitting on a wire joins the net that wire draws. Connecting to the near end of
    // it keeps the addressing honest — a net is between two ports, so there has to be one.
    if (!onWire(doc, port.at)) continue
    const net = (doc.nets ?? []).find((candidate) => {
      const wire = doc.entities.find((entity) => entity.id === candidate.wire)
      return wire?.type === "polyline" && wire.pts.some((point) => dist(point, port.at) <= TOUCH)
    })
    if (!net) continue
    const target = free.find((other) => other.address.toLowerCase() === net.to.toLowerCase())
    if (target && !claimed.has(target.address)) join(port, target)
  }

  // ── Rule 2: supply rails, by pin name ─────────────────────────────────────────────
  // A pin called 3V3 or GND says what it is, so wiring it to the nearest thing whose job is
  // to be that rail is a lookup, not a guess. Only sources are valid targets: without that,
  // two LEDs placed side by side would have their anodes joined for no better reason than
  // both being "the positive end of something".
  // What each rail has been committed to, so a second pin cannot bring a different voltage to
  // a rail that is already carrying one. Seeded from the nets already in the drawing, or adding
  // a 5 V sensor tomorrow would short it to yesterday's 3.3 V one.
  const railVolts = new Map<string, Set<number>>()
  for (const net of doc.nets ?? []) {
    for (const [rail, pin] of [
      [net.from, net.to],
      [net.to, net.from],
    ]) {
      const volts = voltsOf(pinNameAt(doc, pin!))
      if (volts === undefined) continue
      const key = rail!.toLowerCase()
      railVolts.set(key, (railVolts.get(key) ?? new Set()).add(volts))
    }
  }
  /** Whether this rail can carry this pin's voltage as well as whatever it already carries. */
  const compatible = (rail: string, volts: number | undefined) => {
    const seen = railVolts.get(rail.toLowerCase())
    if (volts === undefined || !seen || seen.size === 0) return true
    return seen.size === 1 && seen.has(volts)
  }

  for (const port of open()) {
    if (claimed.has(port.address)) continue
    const role = roleOf(port.pin)
    if (role === "signal") continue
    const partner = open()
      .filter(
        (other) =>
          other.part.ref !== port.part.ref &&
          roleOf(other.pin) === role &&
          // One end has to be an actual supply. Without this, two sensors' VCC pins would be
          // wired to each other rather than each to the rail, and two LEDs placed side by side
          // would have their anodes joined for no better reason than both being the positive
          // end of something.
          (isSource(other.part) || isSource(port.part)) &&
          compatible(other.address, voltsOf(port.pin)) &&
          compatible(port.address, voltsOf(other.pin)),
      )
      // Nearest wins, with no radius. A rail marker exists in order to be connected to, so
      // "the nearest ground" is the answer whether it is 20 mm away or 80; a threshold here
      // only produces the arbitrary near-miss where a GND pin two thirds of a sheet away wires
      // itself and one three quarters away silently does not. An exact tie goes to the lower
      // ref, so the drawing never depends on the order the parts sit in the file.
      .sort((a, b) => dist(a.at, port.at) - dist(b.at, port.at) || a.address.localeCompare(b.address))[0]
    if (!partner) continue
    // Only the pin end is spoken for. The rail can take the next pin too, so long as the next
    // pin agrees about the voltage.
    for (const [rail, pin] of [
      [partner, port],
      [port, partner],
    ] as [PortRef, PortRef][]) {
      const volts = voltsOf(pin.pin)
      if (volts === undefined || !isSource(rail.part)) continue
      railVolts.set(rail.address.toLowerCase(), (railVolts.get(rail.address.toLowerCase()) ?? new Set()).add(volts))
    }
    if (port.address === partner.address) continue
    claimed.add(isSource(port.part) && !isSource(partner.part) ? partner.address : port.address)
    ops.push({ op: "connect", from: port.address, to: partner.address })
  }

  // ── Rule 3: pair up two lone components ───────────────────────────────────────────
  // The eager one. Two components near each other with no connections at all is a strong
  // enough hint to draw the loop, and a wrong loop is one undo away — but it only ever fires
  // on parts that are *entirely* unconnected, so it cannot interfere with a circuit already
  // under construction, and once the loop exists neither part is a candidate again.
  const wholly = (part: Part) =>
    part.ports.length > 0 &&
    !part.symbol.endsWith("junction-dot") &&
    findSymbol(part.symbol)?.domain !== "building" &&
    // Against the nets in the drawing, not against the free list — a rail marker stays on the
    // free list on purpose, and pairing one that already has wires into a two-part loop is
    // exactly the surprise this rule must not spring.
    part.ports.every(
      (_, i) => !already.has(`${part.ref}.${i + 1}`.toLowerCase()) && !claimed.has(`${part.ref}.${i + 1}`),
    )

  // A source has two terminals to give; a load may have one port or two. A lamp is drawn as
  // a single point in the middle of its own symbol, so "both terminals to the load" means
  // two nets landing on one port — which is exactly the drawing that came out with the two
  // wires stacked on top of each other, and exactly what the router's escape rule now spreads
  // apart.
  const lonely = (doc.parts ?? []).filter(wholly)

  /**
   * Whether these two are each other's closest unconnected neighbour.
   *
   * This replaces a radius, and is a better rule than one. A radius has to be guessed, and
   * whatever is guessed is wrong at some scale: 20 mm misses a battery and a lamp sitting a
   * comfortable 58 mm apart, while 80 mm pairs two components on opposite sides of a dense
   * board. "Nothing unconnected is nearer to either of us than we are to each other" needs no
   * number and means the same thing on any sheet.
   */
  const mutualNearest = (a: Part, b: Part): boolean => {
    const nearest = (part: Part) =>
      lonely
        .filter((other) => other.ref !== part.ref)
        .sort((x, y) => dist(x.at, part.at) - dist(y.at, part.at) || x.ref.localeCompare(y.ref))[0]
    return nearest(a)?.ref === b.ref && nearest(b)?.ref === a.ref
  }

  for (const part of lonely.filter((candidate) => candidate.ports.length === 2)) {
    const mine = open().filter((port) => port.part.ref === part.ref)
    if (mine.length !== 2) continue
    const partner = lonely.find((other) => other.ref !== part.ref && wholly(other) && mutualNearest(part, other))
    if (!partner) continue
    const theirs = open().filter((port) => port.part.ref === partner.ref)

    if (theirs.length === 1) {
      // One port, two nets onto it. Claim it after the first join would block the second, so
      // both are emitted together and the port goes out of play for every later rule.
      const load = theirs[0]!
      claimed.add(load.address)
      for (const terminal of mine) {
        claimed.add(terminal.address)
        ops.push({ op: "connect", from: terminal.address, to: load.address })
      }
      continue
    }
    if (theirs.length !== 2) continue

    // Pair by polarity where both sides declare it — a battery's + belongs on an LED's anode,
    // not on whichever terminal happens to be closer. Otherwise take the two nearest ends
    // together, which is the loop that does not cross itself.
    const byRole =
      mine.every((port) => roleOf(port.pin) !== "signal") && theirs.every((port) => roleOf(port.pin) !== "signal")
    const spare = [...theirs]
    for (const terminal of mine) {
      const pick = byRole
        ? spare.find((other) => roleOf(other.pin) === roleOf(terminal.pin))
        : [...spare].sort((a, b) => dist(a.at, terminal.at) - dist(b.at, terminal.at))[0]
      if (!pick) continue
      spare.splice(spare.indexOf(pick), 1)
      join(terminal, pick)
    }
  }

  return ops
}

/** The pairs a batch of ops wired, for reporting what was drawn without being asked. */
export const wiredPairs = (ops: readonly Op[]): string[] =>
  ops.filter((op): op is Extract<Op, { op: "connect" }> => op.op === "connect").map((op) => `${op.from}→${op.to}`)


/** The pin name at a `"REF.PORT"` address, for reading a net's voltages back. */
function pinNameAt(doc: BlueprintDoc, address: string): string | undefined {
  const dot = address.lastIndexOf(".")
  const part = (doc.parts ?? []).find((candidate) => candidate.ref.toLowerCase() === address.slice(0, dot).toLowerCase())
  return part?.pins?.[Number(address.slice(dot + 1)) - 1]
}
