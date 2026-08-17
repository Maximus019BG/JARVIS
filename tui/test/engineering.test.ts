import { describe, expect, test } from "bun:test"
import { evaluate, FORMULAS, FormulaError, RHO } from "../src/engineering/formulas.ts"

/** Every formula's value, rounded, so a golden number reads like the hand calculation. */
const at = (name: string, inputs: Record<string, number>, places = 3) => {
  const f = 10 ** places
  return Math.round(evaluate(name, inputs).value * f) / f
}

describe("formula table", () => {
  test("every entry names its inputs and its unit", () => {
    for (const [name, formula] of Object.entries(FORMULAS)) {
      expect(Object.keys(formula.inputs).length, `${name} has no inputs`).toBeGreaterThan(0)
      expect(formula.unit.length, `${name} has no unit`).toBeGreaterThan(0)
      expect(formula.describe.length, `${name} has no description`).toBeGreaterThan(0)
    }
  })

  test("every entry computes a finite number from a plausible input set", () => {
    // A blanket value for every input is meaningless physically, but it catches a typo in
    // a formula body: a reference to an input that was never declared returns NaN.
    // Dimensionless inputs — the ones whose unit hint starts with an em dash — are ratios
    // and factors, so they get 0.5 rather than 2, which would be out of domain for acos.
    for (const [name, formula] of Object.entries(FORMULAS)) {
      const inputs = Object.fromEntries(
        Object.entries(formula.inputs).map(([key, hint]) => [key, hint.startsWith("—") ? 0.5 : 2]),
      )
      const result = formula.compute(inputs)
      const value = typeof result === "number" ? result : result.value
      expect(Number.isFinite(value), `${name} returned ${value}`).toBe(true)
    }
  })
})

describe("electrical", () => {
  test("Ohm's law", () => {
    expect(at("ohms-law-voltage", { I: 2, R: 470 })).toBe(940)
    expect(at("ohms-law-current", { U: 12, R: 470 }, 6)).toBe(0.025532)
  })

  test("three-phase power at 400 V", () => {
    // √3 × 400 × 16 × 0.85 = 9422.36 W
    expect(at("power-ac-3ph", { U: 400, I: 16, pf: 0.85 }, 1)).toBe(9422.4)
  })

  test("single-phase design current of a 3 kW resistive load at 230 V", () => {
    expect(at("current-1ph", { P: 3000, U: 230, pf: 1 }, 2)).toBe(13.04)
  })

  test("voltage drop, IEC 60364-5-52 App. G", () => {
    // 2 × 0.0225 × 30 m × 20 A / 2.5 mm² = 10.8 V
    expect(at("voltage-drop-1ph", { L: 30, I: 20, A: 2.5, rho: RHO.copper }, 2)).toBe(10.8)
    // Three-phase, same run: √3 × 0.0225 × 30 × 20 / 2.5 = 9.353 V
    expect(at("voltage-drop-3ph", { L: 30, I: 20, A: 2.5, rho: RHO.copper }, 2)).toBe(9.35)
  })

  test("percentage drop names the limit it breaks", () => {
    const bad = evaluate("voltage-drop-percent", { drop: 10.8, U: 230 })
    expect(bad.value).toBeCloseTo(4.696, 2)
    expect(bad.note).toContain("3 % lighting")

    const worse = evaluate("voltage-drop-percent", { drop: 15, U: 230 })
    expect(worse.note).toContain("over the 5 %")

    const fine = evaluate("voltage-drop-percent", { drop: 5, U: 230 })
    expect(fine.note).toContain("within both")
  })

  test("cable sizing rounds up to a real IEC 60228 conductor", () => {
    // 2 × 0.0225 × 30 × 20 / 6.9 V (3 % of 230) = 3.913 mm² -> 4 mm²
    const result = evaluate("cable-csa-1ph", { L: 30, I: 20, drop: 6.9, rho: RHO.copper })
    expect(result.value).toBeCloseTo(3.913, 2)
    expect(result.note).toContain("4 mm²")
    expect(result.note).toContain("still check ampacity")
  })

  test("Ib <= In <= Iz coordination, IEC 60364-4-43", () => {
    expect(evaluate("protection-coordination", { Ib: 20, In: 25, Iz: 27 }).value).toBe(1)
    expect(evaluate("protection-coordination", { Ib: 20, In: 32, Iz: 27 }).note).toContain("overheat")
    expect(evaluate("protection-coordination", { Ib: 30, In: 25, Iz: 27 }).note).toContain("trip on normal load")
  })

  test("adiabatic protective conductor, IEC 60364-5-54", () => {
    // √(1500² × 0.4) / 115 = 8.25 mm² -> 10 mm²
    const result = evaluate("adiabatic-csa", { I: 1500, t: 0.4, k: 115 })
    expect(result.value).toBeCloseTo(8.25, 1)
    expect(result.note).toContain("10 mm²")
  })

  test("LED resistor, and the case where the supply is too low", () => {
    // (5 − 2) / 0.02 = 150 Ω
    expect(at("led-resistor", { Us: 5, Uf: 2, If: 0.02 })).toBe(150)
    expect(evaluate("led-resistor", { Us: 3.3, Uf: 3.4, If: 0.02 }).note).toContain("will not light")
  })
})

describe("structure", () => {
  test("rectangular section properties", () => {
    // 47 × 195 C24 joist: I = 47 × 195³ / 12 = 29,041,593.75 mm⁴
    expect(at("second-moment-rect", { b: 47, h: 195 }, 0)).toBe(29041594)
    // W = 47 × 195² / 6 = 297,862.5 mm³
    expect(at("section-modulus-rect", { b: 47, h: 195 }, 1)).toBe(297862.5)
  })

  test("simply supported moments", () => {
    // 5 kN/m over 4 m: M = 5 × 16 / 8 = 10 kNm
    expect(at("moment-udl-simple", { w: 5, L: 4 })).toBe(10)
    expect(at("moment-point-simple", { F: 10, L: 4 })).toBe(10)
    expect(at("moment-udl-cantilever", { w: 5, L: 2 })).toBe(10)
  })

  test("deflection of a C24 joist reports the span ratio", () => {
    // 1.5 kN/m over 4 m, E = 11000 (C24), I = 29,041,594 -> 5wL⁴/(384EI)
    const result = evaluate("deflection-udl-simple", { w: 1.5, L: 4, E: 11000, I: 29041594 })
    expect(result.value).toBeCloseTo(15.65, 1)
    expect(result.note).toMatch(/span\/2\d\d/)
  })

  test("Eurocode ULS combination, EN 1990 eq. 6.10", () => {
    // 1.35 × 1.2 + 1.5 × 2.0 = 4.62 kN/m²
    expect(at("load-combination-uls", { Gk: 1.2, Qk: 2.0 }, 2)).toBe(4.62)
  })

  test("imposed floor load cites the National Annex", () => {
    const domestic = evaluate("imposed-floor-load", { category: 1 })
    expect(domestic.value).toBe(2.0)
    expect(domestic.note).toContain("National Annex")
    expect(evaluate("imposed-floor-load", { category: 9 }).note).toContain("must be 1 to 5")
  })

  test("Euler buckling of a pinned steel column", () => {
    // π² × 210000 × 1e6 / 3000² = 230.3 kN
    expect(at("euler-buckling", { E: 210000, I: 1e6, L: 3, k: 1 }, 1)).toBe(230.3)
  })
})

describe("building physics", () => {
  test("U-value of a wall, EN ISO 6946", () => {
    // 150 mm mineral wool at 0.035 = 4.286 m²K/W, plus 0.13 + 0.04 -> U = 0.2244
    const layer = evaluate("thermal-resistance", { d: 0.15, lambda: 0.035 })
    expect(layer.value).toBeCloseTo(4.286, 2)
    const u = evaluate("u-value", { sumR: layer.value, Rsi: 0.13, Rse: 0.04 })
    expect(u.value).toBeCloseTo(0.2244, 3)
    expect(u.note).toContain("0.15–0.30 wall")
  })

  test("fabric and ventilation heat loss", () => {
    expect(at("heat-loss-fabric", { U: 0.25, A: 40, dT: 21 })).toBe(210)
    // 0.33 × 0.5 ach × 200 m³ × 21 K = 693 W
    expect(at("heat-loss-ventilation", { n: 0.5, V: 200, dT: 21 })).toBe(693)
  })

  test("dew point, Magnus", () => {
    // 20 °C at 60 % RH is about 12.0 °C
    const result = evaluate("dew-point", { T: 20, RH: 60 })
    expect(result.value).toBeCloseTo(12.0, 1)
    expect(result.note).toContain("cold bridges")
  })

  test("stair rule flags what is out of band", () => {
    const good = evaluate("stair-rule", { rise: 175, going: 275 })
    expect(good.value).toBe(625)
    expect(good.note).toContain("within the usual")

    const steep = evaluate("stair-rule", { rise: 210, going: 220 })
    expect(steep.note).toContain("exceeds the usual 190")
    expect(steep.note).toContain("below the usual 250")
  })

  test("stair run divides a floor height into whole risers", () => {
    // 2700 mm at 190 max -> 15 risers of 180, 14 treads
    const result = evaluate("stair-run", { height: 2700, maxRise: 190, going: 250 })
    expect(result.note).toContain("15 risers at 180")
    expect(result.value).toBe(3500)
  })

  test("accessible ramp reports its landings", () => {
    const result = evaluate("ramp-length", { rise: 900, gradient: 12 })
    expect(result.value).toBe(10800)
    expect(result.note).toContain("intermediate landing")
  })

  test("EN 12464-1 illuminance targets", () => {
    expect(evaluate("illuminance-target", { task: 2 }).value).toBe(500)
    expect(evaluate("illuminance-target", { task: 3 }).note).toContain("technical drawing")
  })

  test("EN 16798 ventilation rate converts to m³/h", () => {
    // 4 people × 7 l/s + 30 m² × 0.7 = 49 l/s = 176.4 m³/h
    const result = evaluate("ventilation-rate", { people: 4, perPerson: 7, area: 30, perArea: 0.7 })
    expect(result.value).toBe(49)
    expect(result.note).toContain("176.4 m³/h")
  })
})

describe("low voltage and IoT", () => {
  test("battery life with derating", () => {
    // 2000 mAh × 0.8 / 5 mA = 320 h
    const result = evaluate("battery-life", { capacity: 2000, current: 5, derate: 0.8 })
    expect(result.value).toBe(320)
    expect(result.note).toContain("13.33 days")
  })

  test("duty-cycled average current", () => {
    // (120 mA × 2 s + 0.05 mA × 598 s) / 600 s = 0.44983 mA
    expect(at("average-current-duty", { Iactive: 120, tActive: 2, Isleep: 0.05, tSleep: 598 }, 4)).toBe(0.4498)
  })

  test("I2C pull-up, NXP UM10204", () => {
    // 300 ns fast mode with 200 pF: 300e-9 / (0.8473 × 200e-12) = 1770 Ω
    const result = evaluate("i2c-pullup", { tr: 300, Cb: 200 })
    expect(result.value).toBeCloseTo(1770, 0)
    expect(result.note).toContain("4.7 kΩ")
    // Minimum set by sink current at 3.3 V: (3.3 − 0.4) / 0.003 = 966.7 Ω
    expect(at("i2c-pullup-min", { Vdd: 3.3, Vol: 0.4, Iol: 0.003 }, 1)).toBe(966.7)
  })

  test("regulator dissipation warns when a linear part is the wrong choice", () => {
    // (12 − 3.3) × 0.5 = 4.35 W
    const hot = evaluate("regulator-dissipation", { Uin: 12, Uout: 3.3, I: 0.5 })
    expect(hot.value).toBeCloseTo(4.35, 2)
    expect(hot.note).toContain("buck converter")
    expect(evaluate("regulator-dissipation", { Uin: 5, Uout: 3.3, I: 0.1 }).note).toContain("small package")
  })

  test("heatsink calculation refuses the impossible case", () => {
    expect(evaluate("heatsink-thermal", { Tj: 110, Ta: 25, P: 100, Rjc: 1, Rcs: 0.5 }).note).toContain("no heatsink can do this")
  })

  test("free-space path loss at 868 MHz over 2 km", () => {
    // 32.45 + 20log10(868) + 20log10(2) = 97.2 dB
    expect(at("free-space-path-loss", { f: 868, d: 2 }, 1)).toBe(97.2)
  })

  test("Fresnel clearance reports the 60 % figure", () => {
    const result = evaluate("fresnel-radius", { D: 2, f: 0.868 })
    expect(result.value).toBeCloseTo(13.14, 1)
    expect(result.note).toContain("60 %")
  })

  test("current budget is short when the supply cannot meet the peak", () => {
    const short = evaluate("current-budget", { total: 900, supply: 1000, headroom: 0.2 })
    expect(short.value).toBeCloseTo(-80, 1)
    expect(short.note).toContain("short by")
    expect(evaluate("current-budget", { total: 500, supply: 1000, headroom: 0.2 }).note).toContain("spare")
  })

  test("PoE budgets are the standard's device-side figures", () => {
    expect(evaluate("poe-budget", { standard: 1 }).value).toBe(12.95)
    expect(evaluate("poe-budget", { standard: 2 }).note).toContain("PoE+")
  })
})

describe("evaluate", () => {
  test("an unknown formula is an error", () => {
    expect(() => evaluate("warp-drive", {})).toThrow(FormulaError)
  })

  test("a missing input says which one and in what unit", () => {
    expect(() => evaluate("ohms-law-voltage", { I: 2 })).toThrow(/needs R/)
    expect(() => evaluate("ohms-law-voltage", { I: 2 })).toThrow(/Ω — resistance/)
  })

  test("an unexpected input is refused rather than ignored", () => {
    // A silently dropped key would return a confident answer to a different question.
    expect(() => evaluate("ohms-law-voltage", { I: 2, R: 4, V: 8 })).toThrow(/does not take V/)
  })

  test("a non-finite result is refused", () => {
    expect(() => evaluate("ohms-law-current", { U: 12, R: 0 })).toThrow(/division by zero/)
  })
})
