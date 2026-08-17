import { evaluate, RHO } from "../engineering/formulas.ts"
import { bbox, flatten } from "./geom.ts"
import type { BlueprintDoc, Entity, Pt } from "./schema.ts"

/**
 * Reviews a drawing against domain rules. The document schema carries no semantics — a
 * circle is a circle, not a hole or a sensor — so an entity's *kind* comes from its layer
 * name and its *parameters* from an annotation grammar in `text` entities. Both are
 * mandated by the domain skills, and both are conventions rather than schema, which is
 * what lets this exist without a schema version bump.
 *
 * The rule this file exists to keep: anything that cannot be read is reported as **not
 * checked**, never as a pass. A checker that quietly skips half a drawing is worse than
 * no checker, because it is believed.
 *
 * Pure — no filesystem, so the web app can run the same checks the terminal does.
 */

export type Severity = "error" | "warning" | "info"

export type Finding = {
  severity: Severity
  /** Entity id this is about, when it is about one. */
  id?: string
  message: string
  /** The clause or limit behind it. Absent for pure geometry checks. */
  standard?: string
}

export type CheckDomain = "general" | "building" | "electrical" | "iot"

export type CheckReport = {
  findings: Finding[]
  /** Entities the domain rules could not read, so nobody mistakes silence for approval. */
  unchecked: { id: string; why: string }[]
  checked: number
}

// ─── the annotation grammar ──────────────────────────────────────────────────────────

/**
 * `REF | key=value, key=value` — the whole convention. `W1 | mm2=2.5, A=16, m=30` on a
 * layer called `cables` is a 2.5 mm² cable carrying 16 A over 30 m. The reference before
 * the bar is free text; keys are lower-cased; values are numbers where they parse as
 * numbers and strings otherwise.
 */
export type Annotation = { ref: string; values: Record<string, string | number> }

/**
 * Only a plain decimal becomes a number. `Number()` would happily turn `0x76` into 118,
 * `0b101` into 5 and `Infinity` into infinity — and an I²C address written the way every
 * datasheet writes it would come back reported in decimal, or silently equal to a
 * different address. Anything that is not plain decimal stays the string it was written as.
 */
const DECIMAL = /^-?\d+(\.\d+)?$/

export function parseAnnotation(text: string): Annotation | undefined {
  const bar = text.indexOf("|")
  if (bar === -1) return undefined
  const ref = text.slice(0, bar).trim()
  const values: Record<string, string | number> = {}
  for (const pair of text.slice(bar + 1).split(",")) {
    const eq = pair.indexOf("=")
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim().toLowerCase()
    const raw = pair.slice(eq + 1).trim()
    if (!key) continue
    values[key] = DECIMAL.test(raw) ? Number(raw) : raw
  }
  return Object.keys(values).length > 0 ? { ref, values } : undefined
}

const num = (annotation: Annotation, key: string): number | undefined => {
  const value = annotation.values[key]
  return typeof value === "number" ? value : undefined
}

const str = (annotation: Annotation, key: string): string | undefined => {
  const value = annotation.values[key]
  return value === undefined ? undefined : String(value)
}

/** Layer id -> its lower-cased name, so rules can match on what a layer is called. */
const layerNames = (doc: BlueprintDoc): Map<string, string> =>
  new Map(doc.layers.map((layer) => [layer.id, layer.name.toLowerCase()]))

/** Every annotated text entity on a layer whose name contains one of `keywords`. */
function annotated(doc: BlueprintDoc, keywords: string[]): { entity: Entity; annotation: Annotation }[] {
  const names = layerNames(doc)
  const found: { entity: Entity; annotation: Annotation }[] = []
  for (const entity of doc.entities) {
    if (entity.type !== "text") continue
    const layer = names.get(entity.layer!) ?? ""
    if (!keywords.some((keyword) => layer.includes(keyword))) continue
    const annotation = parseAnnotation(entity.text)
    if (annotation) found.push({ entity, annotation })
  }
  return found
}

/** Text on a matching layer that has no readable annotation — the "not checked" list. */
function unannotated(doc: BlueprintDoc, keywords: string[]): { id: string; why: string }[] {
  const names = layerNames(doc)
  const out: { id: string; why: string }[] = []
  for (const entity of doc.entities) {
    if (entity.type !== "text") continue
    const layer = names.get(entity.layer!) ?? ""
    if (!keywords.some((keyword) => layer.includes(keyword))) continue
    if (!parseAnnotation(entity.text)) {
      out.push({ id: entity.id!, why: `"${entity.text}" has no \`REF | key=value\` annotation, so its parameters could not be checked` })
    }
  }
  return out
}

// ─── geometry checks, which need no annotation at all ────────────────────────────────

function generalChecks(doc: BlueprintDoc): Finding[] {
  const findings: Finding[] = []
  const [vx, vy, vw, vh] = doc.viewBox
  const used = new Set(doc.entities.map((entity) => entity.layer))

  for (const entity of doc.entities) {
    const runs = flatten(entity)
    const box = bbox([entity])
    if (box && (box[0] < vx || box[1] < vy || box[2] > vx + vw || box[3] > vy + vh)) {
      findings.push({ severity: "warning", id: entity.id, message: `${entity.type} extends outside the sheet` })
    }
    if (entity.type === "line" && entity.a[0] === entity.b[0] && entity.a[1] === entity.b[1]) {
      findings.push({ severity: "error", id: entity.id, message: "zero-length line: it will not print" })
    }
    if (entity.type === "rect" && (entity.w === 0 || entity.h === 0)) {
      findings.push({ severity: "error", id: entity.id, message: "rect has a zero dimension" })
    }
    if (entity.type === "polyline") {
      const total = runs.flat().length
      if (total >= 2 && entity.pts.every((p) => p[0] === entity.pts[0]![0] && p[1] === entity.pts[0]![1])) {
        findings.push({ severity: "error", id: entity.id, message: "polyline has no length: every point is the same" })
      }
    }
    if (entity.type === "dimension" && entity.offset === 0) {
      findings.push({
        severity: "warning",
        id: entity.id,
        message: "dimension has zero offset, so its line runs through the feature it measures",
      })
    }
  }

  // Coincident duplicates: two entities of the same type with the same flattened outline.
  const seen = new Map<string, string>()
  for (const entity of doc.entities) {
    if (entity.type === "text") continue
    const key = `${entity.type}:${JSON.stringify(flatten(entity, 1))}`
    const first = seen.get(key)
    if (first) {
      findings.push({ severity: "warning", id: entity.id, message: `duplicate of ${first}: two identical entities on top of each other` })
    } else {
      seen.set(key, entity.id!)
    }
  }

  for (const layer of doc.layers) {
    if (!used.has(layer.id) && doc.layers.length > 1) {
      findings.push({ severity: "info", id: layer.id, message: `layer "${layer.name}" is empty` })
    }
  }

  if (doc.entities.length > 0 && !doc.entities.some((entity) => entity.type === "dimension")) {
    findings.push({
      severity: "warning",
      message: "the drawing has no dimensions — a drawing without dimensions is a sketch, not something that can be built from",
    })
  }

  return findings
}

// ─── electrical ──────────────────────────────────────────────────────────────────────

/**
 * IEC 60364-5-52 Table B.52.4, reference method C (clipped direct, PVC, two loaded
 * copper conductors, 30 °C ambient) — the common case for a domestic final circuit.
 * Any other installation method or grouping needs its own table and a correction factor,
 * which is why an annotation carrying a method the table does not cover is reported as
 * unchecked rather than compared against these numbers.
 */
const AMPACITY_C_PVC_CU: Record<number, number> = {
  1: 15.5,
  1.5: 19.5,
  2.5: 27,
  4: 36,
  6: 46,
  10: 63,
  16: 85,
  25: 112,
  35: 138,
  50: 168,
  70: 213,
  95: 258,
  120: 299,
}

function electricalChecks(doc: BlueprintDoc): { findings: Finding[]; unchecked: { id: string; why: string }[]; checked: number } {
  const findings: Finding[] = []
  const unchecked = unannotated(doc, ["cable", "circuit", "wiring"])
  const cables = annotated(doc, ["cable", "circuit", "wiring"])
  const refs = new Set<string>()

  for (const { entity, annotation } of cables) {
    const id = entity.id
    const csa = num(annotation, "mm2")
    const current = num(annotation, "a")
    const length = num(annotation, "m")
    const phases = num(annotation, "ph") ?? 1
    const voltage = num(annotation, "v") ?? (phases === 3 ? 400 : 230)
    const breaker = num(annotation, "mcb")

    if (annotation.ref) {
      if (refs.has(annotation.ref)) {
        findings.push({ severity: "error", id, message: `circuit reference ${annotation.ref} is used twice` })
      }
      refs.add(annotation.ref)
    }

    if (csa === undefined || current === undefined) {
      unchecked.push({ id: id!, why: `${annotation.ref || "circuit"} needs at least mm2= and A= to be checked` })
      continue
    }

    const rated = AMPACITY_C_PVC_CU[csa]
    if (rated === undefined) {
      unchecked.push({ id: id!, why: `${csa} mm² is not in the reference-method-C table, so its ampacity was not checked` })
    } else if (current > rated) {
      findings.push({
        severity: "error",
        id,
        message: `${annotation.ref || "circuit"}: ${current} A on ${csa} mm² exceeds the ${rated} A capacity`,
        standard: "IEC 60364-5-52 Table B.52.4, reference method C, PVC copper, 30 °C — apply grouping and temperature factors on top",
      })
    }

    if (breaker !== undefined) {
      const coordination = evaluate("protection-coordination", { Ib: current, In: breaker, Iz: rated ?? breaker })
      if (coordination.value === 0) {
        findings.push({
          severity: "error",
          id,
          message: `${annotation.ref || "circuit"}: ${coordination.note}`,
          standard: "IEC 60364-4-43 §433.1 — Ib ≤ In ≤ Iz",
        })
      }
    }

    if (length !== undefined) {
      const drop = evaluate(phases === 3 ? "voltage-drop-3ph" : "voltage-drop-1ph", {
        L: length,
        I: current,
        A: csa,
        rho: RHO.copper,
      })
      const pct = evaluate("voltage-drop-percent", { drop: drop.value, U: voltage })
      const lighting = (str(annotation, "use") ?? "").toLowerCase().includes("light")
      const limit = lighting ? 3 : 5
      if (pct.value > limit) {
        findings.push({
          severity: "error",
          id,
          message: `${annotation.ref || "circuit"}: ${drop.value} V drop over ${length} m is ${Math.round(pct.value * 100) / 100} %, over the ${limit} % limit`,
          standard: "IEC 60364-5-52 App. G — 3 % lighting, 5 % other",
        })
      }
    } else {
      unchecked.push({ id: id!, why: `${annotation.ref || "circuit"} has no m= route length, so voltage drop was not checked` })
    }

    const rcd = str(annotation, "rcd")
    const use = (str(annotation, "use") ?? "").toLowerCase()
    if (!rcd && /socket|bathroom|outdoor|wet|kitchen/.test(use)) {
      findings.push({
        severity: "error",
        id,
        message: `${annotation.ref || "circuit"} serves ${use} but declares no RCD`,
        standard: "IEC 60364-4-41 §411.3.3 — 30 mA RCD on socket outlets up to 32 A and on circuits in wet locations",
      })
    }
  }

  const earthing = annotated(doc, ["earth", "supply"]).map(({ annotation }) => str(annotation, "system")).filter(Boolean)
  if (new Set(earthing).size > 1) {
    findings.push({
      severity: "error",
      message: `more than one earthing system declared on the same installation: ${[...new Set(earthing)].join(", ")}`,
      standard: "IEC 60364-1 §312.2",
    })
  }

  return { findings, unchecked, checked: cables.length }
}

// ─── building ────────────────────────────────────────────────────────────────────────

function buildingChecks(doc: BlueprintDoc): { findings: Finding[]; unchecked: { id: string; why: string }[]; checked: number } {
  const findings: Finding[] = []
  const keywords = ["door", "window", "stair", "ramp", "room", "corridor"]
  const unchecked = unannotated(doc, keywords)
  const items = annotated(doc, keywords)
  const names = layerNames(doc)

  for (const { entity, annotation } of items) {
    const id = entity.id
    const layer = names.get(entity.layer!) ?? ""
    const ref = annotation.ref || layer

    if (layer.includes("door")) {
      const width = num(annotation, "w")
      if (width === undefined) {
        unchecked.push({ id: id!, why: `door ${ref} has no w= clear width` })
      } else if (width < 800) {
        findings.push({
          severity: width < 750 ? "error" : "warning",
          id,
          message: `door ${ref} is ${width} mm clear, below the 800 mm accessible minimum`,
          standard: "EN 17210 — 800 mm clear width for an accessible door; national regulations may require more",
        })
      }
      const height = num(annotation, "h")
      if (height !== undefined && height < 2000) {
        findings.push({ severity: "warning", id, message: `door ${ref} head height ${height} mm is below the usual 2000 mm` })
      }
    }

    if (layer.includes("stair")) {
      const rise = num(annotation, "rise")
      const going = num(annotation, "going")
      if (rise === undefined || going === undefined) {
        unchecked.push({ id: id!, why: `stair ${ref} needs rise= and going= to be checked` })
      } else {
        const rule = evaluate("stair-rule", { rise, going })
        if (!rule.note?.includes("within the usual")) {
          findings.push({
            severity: "error",
            id,
            message: `stair ${ref}: ${rule.note}`,
            standard: "EN 17210 and national building regulations — 2R+G in 600–650 mm, rise ≤ 190, going ≥ 250 for a private stair",
          })
        }
        const pitch = evaluate("stair-pitch", { rise, going })
        if (pitch.value > 42) {
          findings.push({ severity: "error", id, message: `stair ${ref} pitch is ${Math.round(pitch.value * 10) / 10}°, over the 42° maximum` })
        }
      }
      const headroom = num(annotation, "headroom")
      if (headroom !== undefined && headroom < 2000) {
        findings.push({ severity: "error", id, message: `stair ${ref} headroom ${headroom} mm is below the 2000 mm minimum` })
      }
    }

    if (layer.includes("ramp")) {
      const gradient = num(annotation, "gradient")
      if (gradient === undefined) {
        unchecked.push({ id: id!, why: `ramp ${ref} has no gradient= denominator` })
      } else if (gradient < 12) {
        findings.push({
          severity: "error",
          id,
          message: `ramp ${ref} at 1:${gradient} is steeper than the 1:12 accessible maximum`,
          standard: "EN 17210 — 1:20 preferred, 1:12 the maximum for a short run",
        })
      }
      const rise = num(annotation, "rise")
      if (rise !== undefined && rise > 500) {
        findings.push({ severity: "warning", id, message: `ramp ${ref} rises ${rise} mm in one run — landings are needed every 500 mm of rise` })
      }
    }

    if (layer.includes("corridor")) {
      const width = num(annotation, "w")
      if (width !== undefined && width < 1200) {
        findings.push({
          severity: width < 900 ? "error" : "warning",
          id,
          message: `corridor ${ref} is ${width} mm wide; 1200 mm is the usual accessible minimum and 900 mm an absolute floor`,
          standard: "EN 17210",
        })
      }
    }

    if (layer.includes("room")) {
      const area = num(annotation, "area")
      const category = num(annotation, "cat")
      if (area !== undefined && category !== undefined) {
        const load = evaluate("imposed-floor-load", { category })
        findings.push({
          severity: "info",
          id,
          message: `room ${ref}: ${area} m² at ${load.value} kN/m² imposed = ${Math.round(area * load.value * 10) / 10} kN total`,
          standard: load.note,
        })
      }
    }
  }

  return { findings, unchecked, checked: items.length }
}

// ─── IoT ─────────────────────────────────────────────────────────────────────────────

function iotChecks(doc: BlueprintDoc): { findings: Finding[]; unchecked: { id: string; why: string }[]; checked: number } {
  const findings: Finding[] = []
  const keywords = ["device", "supply", "bus", "power"]
  const unchecked = unannotated(doc, keywords)
  const items = annotated(doc, keywords)

  let draw = 0
  let available = 0
  const busVoltages = new Map<string, Set<number>>()
  const addresses = new Map<string, string[]>()
  const pins = new Map<string, string[]>()

  for (const { entity, annotation } of items) {
    const id = entity.id
    const ref = annotation.ref || "device"
    const supply = num(annotation, "supplyma")
    if (supply !== undefined) {
      available += supply
      continue
    }

    const mA = num(annotation, "ma")
    if (mA === undefined) {
      unchecked.push({ id: id!, why: `${ref} has no mA= current, so it was left out of the power budget` })
    } else {
      draw += mA
    }

    const volts = num(annotation, "v")
    const bus = str(annotation, "bus")
    if (bus && volts !== undefined) {
      const key = bus.toLowerCase()
      if (!busVoltages.has(key)) busVoltages.set(key, new Set())
      busVoltages.get(key)!.add(volts)
    }

    const address = str(annotation, "addr")
    if (address && bus) {
      const key = `${bus.toLowerCase()}:${address.toLowerCase()}`
      if (!addresses.has(key)) addresses.set(key, [])
      addresses.get(key)!.push(ref)
    }

    const pin = str(annotation, "pin")
    if (pin) {
      for (const one of pin.split("/")) {
        const key = one.trim().toLowerCase()
        if (!key) continue
        if (!pins.has(key)) pins.set(key, [])
        pins.get(key)!.push(ref)
      }
    }
  }

  for (const [bus, voltages] of busVoltages) {
    if (voltages.size > 1) {
      const shifted = items.some(({ annotation }) => (str(annotation, "shift") ?? "").toLowerCase() === "yes" && (str(annotation, "bus") ?? "").toLowerCase() === bus)
      if (!shifted) {
        findings.push({
          severity: "error",
          message: `the ${bus} bus mixes ${[...voltages].sort().join(" V and ")} V logic with no level shifter declared (add shift=yes on the shifter)`,
          standard: "Driving a 3.3 V input from a 5 V output exceeds its absolute maximum rating and damages the part over time",
        })
      }
    }
  }

  for (const [key, users] of addresses) {
    if (users.length > 1) {
      const [bus, address] = key.split(":")
      findings.push({ severity: "error", message: `${users.join(" and ")} both claim address ${address} on the ${bus} bus` })
    }
  }

  for (const [pin, users] of pins) {
    if (users.length > 1) {
      findings.push({ severity: "error", message: `pin ${pin} is assigned to ${users.join(" and ")}` })
    }
  }

  if (available > 0 && draw > 0) {
    const budget = evaluate("current-budget", { total: draw, supply: available, headroom: 0.2 })
    findings.push({
      severity: budget.value < 0 ? "error" : "info",
      message: `power budget: ${draw} mA drawn against ${available} mA available — ${budget.note}`,
    })
  } else if (draw > 0) {
    unchecked.push({ id: "—", why: `${draw} mA of load found but no supply declared (add a supplyMA= annotation on the source)` })
  }

  return { findings, unchecked, checked: items.length }
}

// ─── entry point ─────────────────────────────────────────────────────────────────────

export function checkDoc(doc: BlueprintDoc, domain: CheckDomain): CheckReport {
  const general = generalChecks(doc)
  if (domain === "general") return { findings: general, unchecked: [], checked: doc.entities.length }

  const specific =
    domain === "electrical" ? electricalChecks(doc) : domain === "building" ? buildingChecks(doc) : iotChecks(doc)

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  const findings = [...specific.findings, ...general].sort((a, b) => order[a.severity] - order[b.severity])
  return { findings, unchecked: specific.unchecked, checked: specific.checked }
}

/** The report as the model and the transcript see it. */
export function formatReport(name: string, domain: CheckDomain, report: CheckReport): string {
  const glyph: Record<Severity, string> = { error: "✗", warning: "!", info: "·" }
  const lines: string[] = []

  const errors = report.findings.filter((f) => f.severity === "error").length
  const warnings = report.findings.filter((f) => f.severity === "warning").length
  lines.push(`${name} — ${domain} check: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${report.checked} annotated item${report.checked === 1 ? "" : "s"} read`)

  if (report.findings.length === 0) lines.push("", "nothing found")
  else {
    lines.push("")
    for (const finding of report.findings) {
      lines.push(`${glyph[finding.severity]} ${finding.id ? `${finding.id}  ` : ""}${finding.message}`)
      if (finding.standard) lines.push(`    ${finding.standard}`)
    }
  }

  if (report.unchecked.length > 0) {
    lines.push("", `NOT CHECKED — ${report.unchecked.length} item${report.unchecked.length === 1 ? "" : "s"} could not be read, treat them as unverified:`)
    for (const entry of report.unchecked) lines.push(`  ${entry.id}  ${entry.why}`)
  }

  lines.push("", "This is a drawing aid, not a design check. A competent person signs off what gets built.")
  return lines.join("\n")
}

/** Pt is re-exported so the tool file does not need a second schema import. */
export type { Pt }
