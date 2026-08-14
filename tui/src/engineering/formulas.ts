/**
 * Engineering formulas, evaluated rather than recalled. Metric and EU standards
 * throughout: mm², amperes and IEC 60364 for electrical work, kN and the Eurocodes for
 * structure, °C and EN for building physics.
 *
 * The point of a table rather than prose in a skill file is that the drafting agent runs
 * with `bash: false` and cannot shell out to do arithmetic — and that a formula recalled
 * from memory is a formula that can be subtly wrong. Every entry carries the clause it
 * comes from so the number can be checked against the source.
 *
 * These are design aids. Anything that gets built needs a competent person's sign-off;
 * nothing here is a substitute for one.
 *
 * Pure: no I/O, no imports. The web app can use it through the same alias the blueprint
 * engine uses.
 */

export type FormulaResult = number | { value: number; note: string }

export type Formula<K extends string = string> = {
  describe: string
  /** The clause, table or standard this comes from, where there is one. */
  standard?: string
  /** Input name -> unit and meaning. Every one is required. */
  inputs: Record<K, string>
  /** Unit of the returned value. */
  unit: string
  compute: (v: Record<K, number>) => FormulaResult
}

/**
 * Defines one formula, inferring its input names from `inputs`. That inference is the
 * point: `compute` then destructures a mapped type with known keys rather than an index
 * signature, so referring to an input that was never declared is a compile error instead
 * of a silent `NaN` in someone's cable calculation.
 *
 * The cast is what widens it back for storage; `evaluate` has already checked that every
 * declared input is present and finite before `compute` ever runs.
 */
const def = <K extends string>(formula: Formula<K>): Formula => formula as Formula

// ─── constants ───────────────────────────────────────────────────────────────────────

/**
 * Resistivity in Ω·mm²/m at the conductor's normal operating temperature, which is what
 * IEC 60364-5-52 App. G uses for voltage drop — 1.25 × the 20 °C value, i.e. the cable
 * running warm. Using the 20 °C figure under-states the drop by a quarter.
 */
export const RHO = { copper: 0.0225, aluminium: 0.036 } as const

/** Adiabatic k factors, IEC 60364-4-43 Table 43A: conductor material against insulation. */
export const K_FACTOR = { "cu-pvc": 115, "cu-xlpe": 143, "al-pvc": 76, "al-xlpe": 94 } as const

const SQRT3 = Math.sqrt(3)

const round = (n: number, places = 4) => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ─── electrical ──────────────────────────────────────────────────────────────────────

const electrical: Record<string, Formula> = {
  "ohms-law-voltage": def({
    describe: "Voltage across a resistance: U = I × R",
    inputs: { I: "A — current", R: "Ω — resistance" },
    unit: "V",
    compute: ({ I, R }) => I * R,
  }),
  "ohms-law-current": def({
    describe: "Current through a resistance: I = U / R",
    inputs: { U: "V — voltage", R: "Ω — resistance" },
    unit: "A",
    compute: ({ U, R }) => U / R,
  }),
  "ohms-law-resistance": def({
    describe: "Resistance from voltage and current: R = U / I",
    inputs: { U: "V — voltage", I: "A — current" },
    unit: "Ω",
    compute: ({ U, I }) => U / I,
  }),
  "power-dc": def({
    describe: "DC power: P = U × I",
    inputs: { U: "V — voltage", I: "A — current" },
    unit: "W",
    compute: ({ U, I }) => U * I,
  }),
  "power-resistive": def({
    describe: "Power dissipated in a resistance: P = I² × R",
    inputs: { I: "A — current", R: "Ω — resistance" },
    unit: "W",
    compute: ({ I, R }) => I * I * R,
  }),
  "power-ac-1ph": def({
    describe: "Single-phase real power: P = U × I × cosφ",
    inputs: { U: "V — line to neutral, 230 V in the EU", I: "A — current", pf: "— power factor cosφ, 0 to 1" },
    unit: "W",
    compute: ({ U, I, pf }) => U * I * pf,
  }),
  "power-ac-3ph": def({
    describe: "Three-phase real power: P = √3 × U × I × cosφ, with U line-to-line",
    inputs: { U: "V — line to line, 400 V in the EU", I: "A — line current", pf: "— power factor cosφ" },
    unit: "W",
    compute: ({ U, I, pf }) => SQRT3 * U * I * pf,
  }),
  "current-1ph": def({
    describe: "Design current of a single-phase load: Ib = P / (U × cosφ)",
    standard: "IEC 60364-5-52",
    inputs: { P: "W — real power", U: "V — line to neutral", pf: "— power factor cosφ" },
    unit: "A",
    compute: ({ P, U, pf }) => P / (U * pf),
  }),
  "current-3ph": def({
    describe: "Design current of a three-phase load: Ib = P / (√3 × U × cosφ)",
    standard: "IEC 60364-5-52",
    inputs: { P: "W — real power", U: "V — line to line", pf: "— power factor cosφ" },
    unit: "A",
    compute: ({ P, U, pf }) => P / (SQRT3 * U * pf),
  }),
  "motor-current-3ph": def({
    describe: "Line current of a three-phase motor from its shaft power: I = P / (√3 × U × η × cosφ)",
    inputs: { P: "W — shaft (rated) power", U: "V — line to line", eff: "— efficiency, 0 to 1", pf: "— power factor cosφ" },
    unit: "A",
    compute: ({ P, U, eff, pf }) => P / (SQRT3 * U * eff * pf),
  }),
  "voltage-drop-1ph": def({
    describe: "Voltage drop on a single-phase circuit: ΔU = 2 × ρ × L × Ib / A. The 2 is there and back",
    standard: "IEC 60364-5-52 App. G",
    inputs: { L: "m — one-way route length", I: "A — design current Ib", A: "mm² — conductor cross-section", rho: "Ω·mm²/m — 0.0225 copper, 0.036 aluminium" },
    unit: "V",
    compute: ({ L, I, A, rho }) => (2 * rho * L * I) / A,
  }),
  "voltage-drop-3ph": def({
    describe: "Voltage drop on a balanced three-phase circuit: ΔU = √3 × ρ × L × Ib / A",
    standard: "IEC 60364-5-52 App. G",
    inputs: { L: "m — one-way route length", I: "A — design current Ib", A: "mm² — conductor cross-section", rho: "Ω·mm²/m — 0.0225 copper, 0.036 aluminium" },
    unit: "V",
    compute: ({ L, I, A, rho }) => (SQRT3 * rho * L * I) / A,
  }),
  "voltage-drop-percent": def({
    describe: "Voltage drop as a percentage of nominal, against the EU limits",
    standard: "EN 60364-5-52 App. G / CENELEC: 3 % lighting, 5 % other, from the origin",
    inputs: { drop: "V — the calculated ΔU", U: "V — nominal voltage" },
    unit: "%",
    compute: ({ drop, U }) => {
      const pct = (drop / U) * 100
      const note =
        pct > 5
          ? "over the 5 % limit for power circuits — increase the cross-section or shorten the run"
          : pct > 3
            ? "within the 5 % power limit but over the 3 % lighting limit"
            : "within both the 3 % lighting and 5 % power limits"
      return { value: pct, note }
    },
  }),
  "cable-csa-1ph": def({
    describe: "Minimum cross-section for a single-phase run at a given permitted drop: A = 2 × ρ × L × Ib / ΔU",
    standard: "IEC 60364-5-52 App. G",
    inputs: { L: "m — one-way route length", I: "A — design current Ib", drop: "V — permitted voltage drop", rho: "Ω·mm²/m — 0.0225 copper" },
    unit: "mm²",
    compute: ({ L, I, drop, rho }) => {
      const a = (2 * rho * L * I) / drop
      return { value: a, note: `next standard size up: ${nextSize(a)} mm² — this is the voltage-drop minimum only, still check ampacity` }
    },
  }),
  "cable-csa-3ph": def({
    describe: "Minimum cross-section for a three-phase run at a given permitted drop: A = √3 × ρ × L × Ib / ΔU",
    standard: "IEC 60364-5-52 App. G",
    inputs: { L: "m — one-way route length", I: "A — design current Ib", drop: "V — permitted voltage drop", rho: "Ω·mm²/m — 0.0225 copper" },
    unit: "mm²",
    compute: ({ L, I, drop, rho }) => {
      const a = (SQRT3 * rho * L * I) / drop
      return { value: a, note: `next standard size up: ${nextSize(a)} mm² — voltage-drop minimum only, still check ampacity` }
    },
  }),
  "conductor-resistance": def({
    describe: "DC resistance of a conductor: R = ρ × L / A",
    inputs: { L: "m — conductor length", A: "mm² — cross-section", rho: "Ω·mm²/m — 0.0225 copper at operating temperature, 0.0175 at 20 °C" },
    unit: "Ω",
    compute: ({ L, A, rho }) => (rho * L) / A,
  }),
  "protection-coordination": def({
    describe: "The Ib ≤ In ≤ Iz rule: design current, then device rating, then cable capacity",
    standard: "IEC 60364-4-43 §433.1",
    inputs: { Ib: "A — design current of the circuit", In: "A — rated current of the protective device", Iz: "A — continuous current-carrying capacity of the cable" },
    unit: "— pass/fail as 1/0",
    compute: ({ Ib, In, Iz }) => {
      const ok = Ib <= In && In <= Iz
      const why = Ib > In ? "Ib exceeds In: the device will trip on normal load" : In > Iz ? "In exceeds Iz: the cable can overheat before the device trips" : "coordinated"
      return { value: ok ? 1 : 0, note: why }
    },
  }),
  "earth-fault-current": def({
    describe: "Prospective earth-fault current: Ia = Uo / Zs",
    standard: "IEC 60364-4-41",
    inputs: { Uo: "V — nominal line-to-earth voltage, 230 V in the EU", Zs: "Ω — earth fault loop impedance" },
    unit: "A",
    compute: ({ Uo, Zs }) => Uo / Zs,
  }),
  "max-loop-impedance": def({
    describe: "Maximum permitted Zs for a device to disconnect in time: Zs = Uo / Ia",
    standard: "IEC 60364-4-41 §411.4 — 0.4 s for final circuits up to 32 A on TN",
    inputs: { Uo: "V — nominal line-to-earth voltage", Ia: "A — current that operates the device in the required time" },
    unit: "Ω",
    compute: ({ Uo, Ia }) => Uo / Ia,
  }),
  "adiabatic-csa": def({
    describe: "Minimum protective-conductor cross-section for a fault: S = √(I² × t) / k",
    standard: "IEC 60364-5-54 §543.1.2, k from Table 43A",
    inputs: { I: "A — prospective fault current", t: "s — disconnection time of the device", k: "— material factor: 115 Cu/PVC, 143 Cu/XLPE, 76 Al/PVC" },
    unit: "mm²",
    compute: ({ I, t, k }) => {
      const s = Math.sqrt(I * I * t) / k
      return { value: s, note: `next standard size up: ${nextSize(s)} mm²` }
    },
  }),
  "led-resistor": def({
    describe: "Series resistor for an LED: R = (Us − Uf) / If",
    inputs: { Us: "V — supply voltage", Uf: "V — LED forward voltage: ~2.0 red, ~3.2 blue/white", If: "A — desired forward current, e.g. 0.02 for 20 mA" },
    unit: "Ω",
    compute: ({ Us, Uf, If }) => {
      if (Us <= Uf) return { value: 0, note: "the supply is at or below the forward voltage — this LED will not light" }
      const r = (Us - Uf) / If
      const p = (Us - Uf) * If
      return { value: r, note: `dissipates ${round(p * 1000, 1)} mW — a 0.25 W resistor is fine below 250 mW` }
    },
  }),
  "voltage-divider": def({
    describe: "Output of an unloaded divider: Uout = Uin × R2 / (R1 + R2)",
    inputs: { Uin: "V — input voltage", R1: "Ω — top resistor, from Uin to the tap", R2: "Ω — bottom resistor, from the tap to 0 V" },
    unit: "V",
    compute: ({ Uin, R1, R2 }) => (Uin * R2) / (R1 + R2),
  }),
  "rc-time-constant": def({
    describe: "RC time constant: τ = R × C. 63 % in one τ, 99 % in five",
    inputs: { R: "Ω — resistance", C: "F — capacitance, e.g. 1e-6 for 1 µF" },
    unit: "s",
    compute: ({ R, C }) => R * C,
  }),
  "rc-cutoff": def({
    describe: "−3 dB corner of an RC filter: f = 1 / (2πRC)",
    inputs: { R: "Ω — resistance", C: "F — capacitance" },
    unit: "Hz",
    compute: ({ R, C }) => 1 / (2 * Math.PI * R * C),
  }),
  "lc-resonance": def({
    describe: "Resonant frequency of an LC circuit: f = 1 / (2π√(LC))",
    inputs: { L: "H — inductance", C: "F — capacitance" },
    unit: "Hz",
    compute: ({ L, C }) => 1 / (2 * Math.PI * Math.sqrt(L * C)),
  }),
  "capacitor-energy": def({
    describe: "Energy stored in a capacitor: E = ½CU²",
    inputs: { C: "F — capacitance", U: "V — voltage" },
    unit: "J",
    compute: ({ C, U }) => 0.5 * C * U * U,
  }),
  "transformer-ratio": def({
    describe: "Secondary voltage of an ideal transformer: Us = Up × Ns / Np",
    inputs: { Up: "V — primary voltage", Np: "— primary turns", Ns: "— secondary turns" },
    unit: "V",
    compute: ({ Up, Np, Ns }) => (Up * Ns) / Np,
  }),
  "power-factor-correction": def({
    describe: "Capacitive reactive power to correct cosφ: Qc = P × (tanφ₁ − tanφ₂)",
    inputs: { P: "W — real power", pf1: "— existing power factor", pf2: "— target power factor, typically 0.95" },
    unit: "var",
    compute: ({ P, pf1, pf2 }) => {
      // acos is only defined on [-1, 1]; without this a power factor of 2 returns a
      // confident NaN rather than saying the input is impossible.
      if (pf1 <= 0 || pf1 > 1 || pf2 <= 0 || pf2 > 1) {
        return { value: 0, note: "a power factor must be greater than 0 and at most 1" }
      }
      return { value: P * (Math.tan(Math.acos(pf1)) - Math.tan(Math.acos(pf2))), note: `correcting from ${pf1} to ${pf2}` }
    },
  }),
  "diversity-load": def({
    describe: "Diversified load: the connected load scaled by a diversity factor",
    standard: "IEC 60364-3 — factors are national; state the one you used",
    inputs: { connected: "W — total connected load", factor: "— diversity factor, 0 to 1" },
    unit: "W",
    compute: ({ connected, factor }) => connected * factor,
  }),
}

/** IEC 60228 preferred conductor sizes, for rounding a calculated area up to a real cable. */
const STANDARD_CSA = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const nextSize = (a: number) => STANDARD_CSA.find((size) => size >= a) ?? `>${STANDARD_CSA[STANDARD_CSA.length - 1]}`

// ─── structure ───────────────────────────────────────────────────────────────────────

const structural: Record<string, Formula> = {
  "second-moment-rect": def({
    describe: "Second moment of area of a rectangle about its strong axis: I = b × h³ / 12",
    inputs: { b: "mm — breadth", h: "mm — depth" },
    unit: "mm⁴",
    compute: ({ b, h }) => (b * h ** 3) / 12,
  }),
  "section-modulus-rect": def({
    describe: "Elastic section modulus of a rectangle: W = b × h² / 6",
    inputs: { b: "mm — breadth", h: "mm — depth" },
    unit: "mm³",
    compute: ({ b, h }) => (b * h * h) / 6,
  }),
  "moment-udl-simple": def({
    describe: "Maximum bending moment, simply supported with a uniform load: M = wL² / 8",
    standard: "Statics; load combinations per EN 1990",
    inputs: { w: "kN/m — uniformly distributed design load", L: "m — span" },
    unit: "kNm",
    compute: ({ w, L }) => (w * L * L) / 8,
  }),
  "moment-point-simple": def({
    describe: "Maximum bending moment, simply supported with a central point load: M = FL / 4",
    inputs: { F: "kN — point load at mid-span", L: "m — span" },
    unit: "kNm",
    compute: ({ F, L }) => (F * L) / 4,
  }),
  "moment-udl-cantilever": def({
    describe: "Maximum bending moment of a cantilever under a uniform load: M = wL² / 2",
    inputs: { w: "kN/m — uniformly distributed design load", L: "m — cantilever length" },
    unit: "kNm",
    compute: ({ w, L }) => (w * L * L) / 2,
  }),
  "moment-point-cantilever": def({
    describe: "Bending moment of a cantilever with a load at the tip: M = FL",
    inputs: { F: "kN — tip load", L: "m — cantilever length" },
    unit: "kNm",
    compute: ({ F, L }) => F * L,
  }),
  "deflection-udl-simple": def({
    describe: "Mid-span deflection, simply supported with a uniform load: δ = 5wL⁴ / (384EI)",
    standard: "EN 1995-1-1 / EN 1993-1-1 serviceability; check against the span/limit ratio",
    inputs: { w: "kN/m — service (unfactored) load", L: "m — span", E: "N/mm² — modulus: ~11000 C24 timber, 210000 steel, ~30000 C25/30 concrete", I: "mm⁴ — second moment of area" },
    unit: "mm",
    compute: ({ w, L, E, I }) => {
      // w kN/m -> N/mm is ×1; L m -> mm is ×1000.
      const wN = w
      const Lmm = L * 1000
      const d = (5 * wN * Lmm ** 4) / (384 * E * I)
      return { value: d, note: `span/${Math.round(Lmm / d)} — EN serviceability commonly asks for better than span/250 (span/300 to span/350 under imposed load)` }
    },
  }),
  "deflection-point-simple": def({
    describe: "Mid-span deflection, simply supported with a central point load: δ = FL³ / (48EI)",
    inputs: { F: "kN — service point load at mid-span", L: "m — span", E: "N/mm² — modulus of elasticity", I: "mm⁴ — second moment of area" },
    unit: "mm",
    compute: ({ F, L, E, I }) => {
      const d = (F * 1000 * (L * 1000) ** 3) / (48 * E * I)
      return { value: d, note: `span/${Math.round((L * 1000) / d)}` }
    },
  }),
  "deflection-udl-cantilever": def({
    describe: "Tip deflection of a cantilever under a uniform load: δ = wL⁴ / (8EI)",
    inputs: { w: "kN/m — service load", L: "m — cantilever length", E: "N/mm² — modulus", I: "mm⁴ — second moment of area" },
    unit: "mm",
    compute: ({ w, L, E, I }) => (w * (L * 1000) ** 4) / (8 * E * I),
  }),
  "deflection-point-cantilever": def({
    describe: "Tip deflection of a cantilever with a tip load: δ = FL³ / (3EI)",
    inputs: { F: "kN — tip load", L: "m — cantilever length", E: "N/mm² — modulus", I: "mm⁴ — second moment of area" },
    unit: "mm",
    compute: ({ F, L, E, I }) => (F * 1000 * (L * 1000) ** 3) / (3 * E * I),
  }),
  "bending-stress": def({
    describe: "Bending stress: σ = M / W",
    inputs: { M: "kNm — bending moment", W: "mm³ — section modulus" },
    unit: "N/mm²",
    compute: ({ M, W }) => (M * 1e6) / W,
  }),
  "deflection-limit": def({
    describe: "Permitted deflection for a span and a limit ratio: δ = L / ratio",
    standard: "EN 1990 A1.4 serviceability; the ratio is set nationally, commonly 250 to 350",
    inputs: { L: "m — span", ratio: "— the denominator, e.g. 250 or 360" },
    unit: "mm",
    compute: ({ L, ratio }) => (L * 1000) / ratio,
  }),
  "euler-buckling": def({
    describe: "Elastic critical buckling load of a column: Ncr = π²EI / (kL)²",
    standard: "EN 1993-1-1 §6.3; k = 1.0 pinned, 0.7 pinned-fixed, 0.5 fixed-fixed, 2.0 free-fixed",
    inputs: { E: "N/mm² — modulus", I: "mm⁴ — second moment of area about the weak axis", L: "m — length", k: "— effective length factor" },
    unit: "kN",
    compute: ({ E, I, L, k }) => (Math.PI ** 2 * E * I) / (k * L * 1000) ** 2 / 1000,
  }),
  "load-udl-from-area": def({
    describe: "Line load on a beam from an area load and a load width: w = q × width",
    inputs: { q: "kN/m² — area load", width: "m — the width of floor the beam carries (half each side)" },
    unit: "kN/m",
    compute: ({ q, width }) => q * width,
  }),
  "load-combination-uls": def({
    describe: "Ultimate limit state combination: 1.35 Gk + 1.5 Qk",
    standard: "EN 1990 §6.4.3.2 eq. 6.10, with the recommended partial factors",
    inputs: { Gk: "kN/m² or kN/m — characteristic permanent action", Qk: "same units — characteristic variable action" },
    unit: "same as the inputs",
    compute: ({ Gk, Qk }) => 1.35 * Gk + 1.5 * Qk,
  }),
  "imposed-floor-load": def({
    describe: "Characteristic imposed floor load by use category. Pass the category number: 1 domestic (A, 1.5–2.0), 2 office (B, 2.5–3.0), 3 assembly (C, 3.0–5.0), 4 retail (D, 4.0–5.0), 5 storage (E, 7.5+)",
    standard: "EN 1991-1-1 Table 6.2 — the exact value is set in each National Annex",
    inputs: { category: "— 1 to 5 as above" },
    unit: "kN/m²",
    compute: ({ category }) => {
      const table: Record<number, [number, string]> = {
        1: [2.0, "Category A, domestic and residential — National Annexes set 1.5 to 2.0"],
        2: [3.0, "Category B, office areas — 2.0 to 3.0"],
        3: [4.0, "Category C, areas of congregation — 3.0 to 5.0 depending on sub-category"],
        4: [4.0, "Category D, shopping areas — 4.0 to 5.0"],
        5: [7.5, "Category E, storage — 7.5 and upwards; confirm against the actual stored goods"],
      }
      const entry = table[Math.round(category)]
      if (!entry) return { value: 0, note: "category must be 1 to 5" }
      return { value: entry[0], note: `${entry[1]}. Confirm against the National Annex for the country you are building in` }
    },
  }),
  "concrete-volume": def({
    describe: "Concrete volume of a slab: V = L × W × t",
    inputs: { L: "m — length", W: "m — width", t: "m — thickness, e.g. 0.15 for 150 mm" },
    unit: "m³",
    compute: ({ L, W, t }) => L * W * t,
  }),
  "masonry-units": def({
    describe: "Number of masonry units for a wall face, before waste",
    inputs: { area: "m² — wall face area", unitL: "mm — unit length including joint, e.g. 225 for a UK brick", unitH: "mm — unit height including joint, e.g. 75" },
    unit: "units",
    compute: ({ area, unitL, unitH }) => {
      const n = (area * 1e6) / (unitL * unitH)
      return { value: n, note: `add 5–10 % for waste and cuts: order about ${Math.ceil(n * 1.08)}` }
    },
  }),
}

// ─── building physics and geometry ───────────────────────────────────────────────────

const buildingPhysics: Record<string, Formula> = {
  "thermal-resistance": def({
    describe: "Thermal resistance of a layer: R = d / λ",
    standard: "EN ISO 6946",
    inputs: { d: "m — layer thickness", lambda: "W/m·K — conductivity: ~0.035 mineral wool, ~0.13 timber, ~0.8 brick, ~2.0 concrete" },
    unit: "m²·K/W",
    compute: ({ d, lambda }) => d / lambda,
  }),
  "u-value": def({
    describe: "U-value of an assembly from the sum of its layer resistances plus the surface resistances: U = 1 / ΣR",
    standard: "EN ISO 6946 — surface resistances Rsi 0.13 and Rse 0.04 for a wall",
    inputs: { sumR: "m²·K/W — the sum of every layer's d/λ", Rsi: "m²·K/W — inside surface, 0.13 wall / 0.10 ceiling", Rse: "m²·K/W — outside surface, 0.04" },
    unit: "W/m²·K",
    compute: ({ sumR, Rsi, Rse }) => {
      const u = 1 / (sumR + Rsi + Rse)
      return { value: u, note: "typical EU new-build targets: 0.15–0.30 wall, 0.10–0.20 roof, 0.8–1.4 window. National limits vary — check the local regulation" }
    },
  }),
  "heat-loss-fabric": def({
    describe: "Steady-state fabric heat loss through an element: Q = U × A × ΔT",
    standard: "EN ISO 13789",
    inputs: { U: "W/m²·K — U-value", A: "m² — element area", dT: "K — inside minus outside temperature" },
    unit: "W",
    compute: ({ U, A, dT }) => U * A * dT,
  }),
  "heat-loss-ventilation": def({
    describe: "Ventilation heat loss: Q = 0.33 × n × V × ΔT, where 0.33 Wh/m³K is the volumetric heat capacity of air",
    standard: "EN ISO 13789",
    inputs: { n: "1/h — air changes per hour", V: "m³ — heated volume", dT: "K — temperature difference" },
    unit: "W",
    compute: ({ n, V, dT }) => 0.33 * n * V * dT,
  }),
  "dew-point": def({
    describe: "Dew-point temperature from air temperature and relative humidity, Magnus approximation",
    standard: "Magnus-Tetens, a = 17.27, b = 237.7 °C",
    inputs: { T: "°C — air temperature", RH: "% — relative humidity, 0 to 100" },
    unit: "°C",
    compute: ({ T, RH }) => {
      const a = 17.27
      const b = 237.7
      const g = (a * T) / (b + T) + Math.log(RH / 100)
      const dp = (b * g) / (a - g)
      return { value: dp, note: `any surface below ${round(dp, 1)} °C will condense — check the internal face of cold bridges against this` }
    },
  }),
  "ventilation-rate": def({
    describe: "Required fresh-air rate for a space: q = occupants × per-person rate + area × per-area rate",
    standard: "EN 16798-1 — category II defaults: 7 l/s per person plus 0.7 l/s·m² for a low-polluting building",
    inputs: { people: "— number of occupants", perPerson: "l/s — per occupant, 7 for category II", area: "m² — floor area", perArea: "l/s·m² — per floor area, 0.7 for a low-polluting building" },
    unit: "l/s",
    compute: ({ people, perPerson, area, perArea }) => {
      const q = people * perPerson + area * perArea
      return { value: q, note: `${round(q * 3.6, 1)} m³/h` }
    },
  }),
  "air-change-rate": def({
    describe: "Air changes per hour from a volumetric flow: n = q / V",
    inputs: { q: "m³/h — supply flow rate", V: "m³ — room volume" },
    unit: "1/h",
    compute: ({ q, V }) => q / V,
  }),
  "stair-rule": def({
    describe: "The going-and-rise check: 2R + G, which should land in the comfortable band",
    standard: "EN 17210 / national building regulations. 600–650 mm is the usual band; max rise ~190 mm, min going ~250 mm for a private stair",
    inputs: { rise: "mm — riser height", going: "mm — tread going" },
    unit: "mm",
    compute: ({ rise, going }) => {
      const value = 2 * rise + going
      const problems: string[] = []
      if (value < 600 || value > 650) problems.push(`2R+G is ${round(value, 0)}, outside the 600–650 comfort band`)
      if (rise > 190) problems.push(`rise ${rise} mm exceeds the usual 190 mm private-stair maximum`)
      if (going < 250) problems.push(`going ${going} mm is below the usual 250 mm private-stair minimum`)
      return { value, note: problems.length > 0 ? problems.join("; ") : "within the usual private-stair limits — confirm against the National Annex" }
    },
  }),
  "stair-run": def({
    describe: "Total going and number of risers for a floor-to-floor height",
    inputs: { height: "mm — floor to floor", maxRise: "mm — maximum acceptable riser, e.g. 190", going: "mm — tread going" },
    unit: "mm of total going",
    compute: ({ height, maxRise, going }) => {
      const risers = Math.ceil(height / maxRise)
      const rise = height / risers
      const run = (risers - 1) * going
      return { value: run, note: `${risers} risers at ${round(rise, 1)} mm, ${risers - 1} treads at ${going} mm. 2R+G = ${round(2 * rise + going, 0)}` }
    },
  }),
  "stair-pitch": def({
    describe: "Pitch angle of a stair: atan(rise / going)",
    standard: "42° is the usual private-stair maximum",
    inputs: { rise: "mm — riser height", going: "mm — tread going" },
    unit: "°",
    compute: ({ rise, going }) => {
      const deg = (Math.atan(rise / going) * 180) / Math.PI
      return { value: deg, note: deg > 42 ? "steeper than the 42° private-stair maximum" : "within the usual pitch limit" }
    },
  }),
  "ramp-length": def({
    describe: "Horizontal length of a ramp for a rise and a gradient: L = rise × denominator",
    standard: "EN 17210 — 1:20 preferred, 1:12 maximum for short accessible runs, with landings every 500 mm of rise",
    inputs: { rise: "mm — vertical rise", gradient: "— the denominator: 20 for 1:20, 12 for 1:12" },
    unit: "mm",
    compute: ({ rise, gradient }) => {
      const L = rise * gradient
      const landings = Math.max(0, Math.ceil(rise / 500) - 1)
      return { value: L, note: `${round(L / 1000, 2)} m of run${landings > 0 ? `, plus ${landings} intermediate landing${landings === 1 ? "" : "s"} of at least 1500 mm` : ""}` }
    },
  }),
  "daylight-factor": def({
    describe: "Average daylight factor, the Lynes/BRE approximation: DF = (W × τ × θ) / (A × (1 − ρ²)) × 100",
    standard: "BRE / EN 17037. 2 % average is the usual adequate-daylight threshold for a habitable room",
    inputs: { W: "m² — net glazed area", tau: "— glass transmittance, ~0.7 double glazing", theta: "° — visible sky angle from the window, ~65 for an unobstructed vertical window", A: "m² — total internal surface area of the room", rho: "— area-weighted mean reflectance, ~0.5" },
    unit: "%",
    compute: ({ W, tau, theta, A, rho }) => {
      const df = ((W * tau * theta) / (A * (1 - rho * rho))) * 100 / 100
      return { value: df, note: df < 2 ? "below the 2 % rule of thumb for adequate daylight" : "adequate by the 2 % rule of thumb" }
    },
  }),
  "illuminance-target": def({
    describe: "Maintained illuminance target by task. Pass: 1 circulation, 2 general office, 3 detailed work, 4 very fine work",
    standard: "EN 12464-1",
    inputs: { task: "— 1 to 4 as above" },
    unit: "lux",
    compute: ({ task }) => {
      const table: Record<number, [number, string]> = {
        1: [100, "circulation and corridors"],
        2: [500, "writing, typing, reading, data processing"],
        3: [750, "technical drawing and detailed inspection"],
        4: [1500, "very fine work such as precision assembly"],
      }
      const entry = table[Math.round(task)]
      if (!entry) return { value: 0, note: "task must be 1 to 4" }
      return { value: entry[0], note: `EN 12464-1: ${entry[1]}` }
    },
  }),
  "lumens-required": def({
    describe: "Lamp lumens for a target illuminance, lumen method: Φ = E × A / (UF × MF)",
    standard: "EN 12464-1",
    inputs: { E: "lux — maintained illuminance target", A: "m² — floor area", UF: "— utilisation factor, 0.4 to 0.6 typical", MF: "— maintenance factor, ~0.8" },
    unit: "lm",
    compute: ({ E, A, UF, MF }) => (E * A) / (UF * MF),
  }),
  "room-area": def({
    describe: "Rectangular room area and its perimeter",
    inputs: { L: "m — length", W: "m — width" },
    unit: "m²",
    compute: ({ L, W }) => ({ value: L * W, note: `perimeter ${round(2 * (L + W), 2)} m` }),
  }),
}

// ─── low voltage and IoT ─────────────────────────────────────────────────────────────

const lowVoltage: Record<string, Formula> = {
  "battery-life": def({
    describe: "Battery life from capacity and average current, with a derating factor for real-world losses",
    inputs: { capacity: "mAh — cell capacity", current: "mA — average current draw", derate: "— usable fraction, 0.7 to 0.85 is realistic for a Li-ion with a regulator" },
    unit: "h",
    compute: ({ capacity, current, derate }) => {
      const h = (capacity * derate) / current
      return { value: h, note: `${round(h / 24, 2)} days — measure the real average current before trusting this` }
    },
  }),
  "average-current-duty": def({
    describe: "Average current of a duty-cycled device: Iavg = (Iactive × tactive + Isleep × tsleep) / (tactive + tsleep)",
    inputs: { Iactive: "mA — current while awake", tActive: "s — awake time per cycle", Isleep: "mA — sleep current", tSleep: "s — sleep time per cycle" },
    unit: "mA",
    compute: ({ Iactive, tActive, Isleep, tSleep }) => (Iactive * tActive + Isleep * tSleep) / (tActive + tSleep),
  }),
  "dc-wire-drop": def({
    describe: "Voltage drop on a low-voltage DC run: ΔU = 2 × ρ × L × I / A. Matters far more at 5 V than at 230 V",
    inputs: { L: "m — one-way length", I: "A — current", A: "mm² — conductor cross-section", rho: "Ω·mm²/m — 0.0175 copper at 20 °C" },
    unit: "V",
    compute: ({ L, I, A, rho }) => {
      const drop = (2 * rho * L * I) / A
      return { value: drop, note: `on a 5 V rail that is ${round((drop / 5) * 100, 1)} % — keep it under 2 % for logic supplies` }
    },
  }),
  "i2c-pullup": def({
    describe: "Maximum I²C pull-up resistance for a rise time: Rmax = tr / (0.8473 × Cb)",
    standard: "NXP UM10204 §7.1 — tr is 1000 ns at 100 kHz standard mode, 300 ns at 400 kHz fast mode",
    inputs: { tr: "ns — permitted rise time: 1000 standard, 300 fast", Cb: "pF — total bus capacitance, ~10 pF per device plus ~1 pF per cm of track" },
    unit: "Ω",
    compute: ({ tr, Cb }) => {
      const r = (tr * 1e-9) / (0.8473 * Cb * 1e-12)
      return { value: r, note: `use the next value below: 4.7 kΩ is the safe default at 3.3 V, 2.2 kΩ for a long or fast bus` }
    },
  }),
  "i2c-pullup-min": def({
    describe: "Minimum I²C pull-up, set by the sink current the bus drivers can take: Rmin = (Vdd − Vol) / Iol",
    standard: "NXP UM10204 — Vol 0.4 V at Iol 3 mA",
    inputs: { Vdd: "V — bus supply", Vol: "V — maximum low-level output voltage, 0.4", Iol: "A — sink current, 0.003" },
    unit: "Ω",
    compute: ({ Vdd, Vol, Iol }) => (Vdd - Vol) / Iol,
  }),
  "adc-resolution": def({
    describe: "Voltage per ADC step: LSB = Vref / 2ⁿ",
    inputs: { Vref: "V — reference voltage", bits: "— ADC resolution in bits" },
    unit: "V",
    compute: ({ Vref, bits }) => {
      const lsb = Vref / 2 ** bits
      return { value: lsb, note: `${round(lsb * 1000, 3)} mV per step; real accuracy is well below this once noise and INL are counted` }
    },
  }),
  "regulator-dissipation": def({
    describe: "Power a linear regulator turns into heat: P = (Uin − Uout) × I",
    inputs: { Uin: "V — input voltage", Uout: "V — output voltage", I: "A — load current" },
    unit: "W",
    compute: ({ Uin, Uout, I }) => {
      const p = (Uin - Uout) * I
      return {
        value: p,
        note: p > 1 ? "over 1 W in a linear regulator needs a heatsink — a buck converter is usually the better answer" : "a small package will cope; check the junction temperature with heatsink-thermal",
      }
    },
  }),
  "buck-input-current": def({
    describe: "Input current of a buck converter: Iin = (Uout × Iout) / (Uin × η)",
    inputs: { Uin: "V — input voltage", Uout: "V — output voltage", Iout: "A — output current", eff: "— efficiency, 0.85 to 0.95" },
    unit: "A",
    compute: ({ Uin, Uout, Iout, eff }) => (Uout * Iout) / (Uin * eff),
  }),
  "heatsink-thermal": def({
    describe: "Heatsink thermal resistance needed: Rθsa = (Tj − Ta) / P − Rθjc − Rθcs",
    inputs: { Tj: "°C — maximum junction temperature, derate to ~110 from a 125 rating", Ta: "°C — ambient", P: "W — dissipation", Rjc: "K/W — junction to case, from the datasheet", Rcs: "K/W — case to sink, ~0.5 with paste" },
    unit: "K/W",
    compute: ({ Tj, Ta, P, Rjc, Rcs }) => {
      const r = (Tj - Ta) / P - Rjc - Rcs
      return { value: r, note: r <= 0 ? "no heatsink can do this — reduce the dissipation or improve the mounting" : "a heatsink of this rating or lower will hold the junction temperature" }
    },
  }),
  "mosfet-conduction-loss": def({
    describe: "Conduction loss in a MOSFET: P = I² × Rds(on)",
    inputs: { I: "A — drain current", Rds: "Ω — on-resistance at the gate voltage you are actually driving it with" },
    unit: "W",
    compute: ({ I, Rds }) => I * I * Rds,
  }),
  "poe-budget": def({
    describe: "Power available at a PoE powered device after cable loss. Pass the standard: 1 for 802.3af, 2 for 802.3at, 3 for 802.3bt type 3",
    standard: "IEEE 802.3af 15.4 W at source / 12.95 W at the device; 802.3at 30 W / 25.5 W; 802.3bt type 3 60 W / 51 W",
    inputs: { standard: "— 1 af, 2 at, 3 bt type 3" },
    unit: "W at the device",
    compute: ({ standard }) => {
      const table: Record<number, [number, string]> = {
        1: [12.95, "802.3af: 15.4 W at the source, 12.95 W guaranteed at the device over 100 m"],
        2: [25.5, "802.3at (PoE+): 30 W at the source, 25.5 W at the device"],
        3: [51, "802.3bt type 3: 60 W at the source, 51 W at the device"],
      }
      const entry = table[Math.round(standard)]
      if (!entry) return { value: 0, note: "standard must be 1, 2 or 3" }
      return { value: entry[0], note: entry[1] }
    },
  }),
  "free-space-path-loss": def({
    describe: "Free-space path loss: FSPL = 32.45 + 20·log₁₀(f MHz) + 20·log₁₀(d km)",
    standard: "Friis; the free-space case only — real paths are worse",
    inputs: { f: "MHz — frequency, 868 for EU LoRa, 2400 for Wi-Fi/BLE", d: "km — distance" },
    unit: "dB",
    compute: ({ f, d }) => 32.45 + 20 * Math.log10(f) + 20 * Math.log10(d),
  }),
  "link-budget": def({
    describe: "Received power: Prx = Ptx + Gtx + Grx − losses",
    inputs: { Ptx: "dBm — transmit power, 14 dBm is the EU 868 MHz limit", Gtx: "dBi — transmit antenna gain", Grx: "dBi — receive antenna gain", loss: "dB — path loss plus cable and connector losses" },
    unit: "dBm",
    compute: ({ Ptx, Gtx, Grx, loss }) => {
      const p = Ptx + Gtx + Grx - loss
      return { value: p, note: `a LoRa SF12 receiver sits near −137 dBm and BLE near −95 dBm; keep at least 10–20 dB of margin above the sensitivity` }
    },
  }),
  "fresnel-radius": def({
    describe: "Radius of the first Fresnel zone at mid-path: r = 8.657 × √(D / f), D in km and f in GHz",
    standard: "Keep 60 % of this zone clear or the link degrades even with line of sight",
    inputs: { D: "km — total path length", f: "GHz — frequency, 0.868 for EU LoRa, 2.4 for Wi-Fi" },
    unit: "m",
    compute: ({ D, f }) => {
      const r = 8.657 * Math.sqrt(D / f)
      return { value: r, note: `keep at least ${round(r * 0.6, 2)} m of clearance (60 %) at mid-path` }
    },
  }),
  "pwm-average-voltage": def({
    describe: "Average voltage of a PWM output: Uavg = Usupply × duty",
    inputs: { U: "V — supply voltage", duty: "— duty cycle, 0 to 1" },
    unit: "V",
    compute: ({ U, duty }) => U * duty,
  }),
  "current-budget": def({
    describe: "Total current of a device list against its supply, with headroom",
    inputs: { total: "mA — the sum of every peak current on the rail", supply: "mA — what the source can deliver", headroom: "— required margin, 0.2 for 20 %" },
    unit: "mA of margin",
    compute: ({ total, supply, headroom }) => {
      const needed = total * (1 + headroom)
      const margin = supply - needed
      return {
        value: margin,
        note: margin < 0 ? `short by ${round(-margin, 1)} mA including ${headroom * 100} % headroom — size the supply for peaks, not averages` : `${round(margin, 1)} mA spare including headroom`,
      }
    },
  }),
  "capacitor-hold-up": def({
    describe: "How long a bulk capacitor holds a rail up during a current burst: t = C × ΔU / I",
    inputs: { C: "F — capacitance, e.g. 1000e-6 for 1000 µF", dU: "V — permitted droop", I: "A — burst current" },
    unit: "s",
    compute: ({ C, dU, I }) => {
      const t = (C * dU) / I
      return { value: t, note: `${round(t * 1000, 2)} ms — a SIM800L TX burst is around 0.6 ms, a Wi-Fi TX burst a few ms` }
    },
  }),
}

export const FORMULAS: Record<string, Formula> = {
  ...electrical,
  ...structural,
  ...buildingPhysics,
  ...lowVoltage,
}

export class FormulaError extends Error {}

/** Evaluates a formula, refusing anything it cannot compute honestly. */
export function evaluate(name: string, values: Record<string, number>): { value: number; unit: string; note?: string; standard?: string; describe: string } {
  const formula = FORMULAS[name]
  if (!formula) throw new FormulaError(`no such formula: ${name}`)

  const expected = Object.keys(formula.inputs)
  const missing = expected.filter((key) => typeof values[key] !== "number" || !Number.isFinite(values[key]))
  if (missing.length > 0) {
    throw new FormulaError(
      `${name} needs ${missing.join(", ")}. Inputs: ${expected.map((key) => `${key} (${formula.inputs[key]})`).join("; ")}`,
    )
  }
  const extra = Object.keys(values).filter((key) => !expected.includes(key))
  // Loud rather than ignored: a stray key is nearly always a misremembered input name,
  // and silently dropping it would return a confident answer to the wrong question.
  if (extra.length > 0) throw new FormulaError(`${name} does not take ${extra.join(", ")}. It takes ${expected.join(", ")}`)

  const result = formula.compute(values)
  const value = typeof result === "number" ? result : result.value
  if (!Number.isFinite(value)) throw new FormulaError(`${name} is undefined for those inputs — check for a division by zero`)

  return {
    describe: formula.describe,
    value: round(value, 6),
    unit: formula.unit,
    note: typeof result === "number" ? undefined : result.note,
    standard: formula.standard,
  }
}
