import { describe, expect, test } from "bun:test"
import { checkDoc, formatReport, parseAnnotation, type CheckDomain } from "../src/blueprint/check.ts"
import { applyOps, type Op } from "../src/blueprint/ops.ts"
import { emptyDoc, type BlueprintDoc } from "../src/blueprint/schema.ts"

/** A sheet with the named layers, plus one annotation text entity per entry. */
function sheet(layers: string[], notes: { layer: string; text: string }[], extra: Op[] = []): BlueprintDoc {
  const ops: Op[] = layers.map((name) => ({ op: "addLayer", layer: { name } }))
  const ids = new Map(layers.map((name, i) => [name, `l${i + 1}`]))
  for (const note of notes) {
    ops.push({ op: "add", entity: { type: "text", layer: ids.get(note.layer)!, at: [10, 10], text: note.text } })
  }
  return applyOps(emptyDoc("sheet"), [...ops, ...extra]).doc
}

const messages = (doc: BlueprintDoc, domain: CheckDomain) => checkDoc(doc, domain).findings.map((f) => f.message).join("\n")
const errors = (doc: BlueprintDoc, domain: CheckDomain) => checkDoc(doc, domain).findings.filter((f) => f.severity === "error")

describe("parseAnnotation", () => {
  test("reads a reference and typed key-values", () => {
    const parsed = parseAnnotation("W1 | mm2=2.5, A=16, m=30, use=sockets")
    expect(parsed?.ref).toBe("W1")
    expect(parsed?.values).toEqual({ mm2: 2.5, a: 16, m: 30, use: "sockets" })
  })

  test("text with no bar, or no key-value pairs, is not an annotation", () => {
    expect(parseAnnotation("KITCHEN")).toBeUndefined()
    expect(parseAnnotation("W1 | just a note")).toBeUndefined()
  })

  test("only plain decimals become numbers, so a hex address survives as written", () => {
    const parsed = parseAnnotation("U1 | addr=0x76, ma=5, v=3.3, pin=GPIO21")
    expect(parsed?.values.addr).toBe("0x76")
    expect(parsed?.values.ma).toBe(5)
    expect(parsed?.values.v).toBe(3.3)
    expect(parsed?.values.pin).toBe("GPIO21")
  })
})

describe("general geometry checks", () => {
  test("a zero-length line and a zero-offset dimension are errors", () => {
    const doc = applyOps(emptyDoc("s"), [
      { op: "add", entity: { type: "line", a: [5, 5], b: [5, 5] } },
      { op: "add", entity: { type: "dimension", a: [0, 0], b: [50, 0], offset: 0 } },
    ]).doc
    const found = messages(doc, "general")
    expect(found).toContain("zero-length line")
    expect(found).toContain("zero offset")
  })

  test("an entity off the sheet, and a duplicate, are flagged", () => {
    const doc = applyOps(emptyDoc("s"), [
      { op: "add", entity: { type: "circle", c: [900, 900], r: 5 } },
      { op: "add", entity: { type: "rect", at: [10, 10], w: 20, h: 20 } },
      { op: "add", entity: { type: "rect", at: [10, 10], w: 20, h: 20 } },
    ]).doc
    const found = messages(doc, "general")
    expect(found).toContain("outside the sheet")
    expect(found).toContain("duplicate of")
  })

  test("a drawing with no dimensions is called a sketch", () => {
    const doc = applyOps(emptyDoc("s"), [{ op: "add", entity: { type: "rect", at: [10, 10], w: 50, h: 30 } }]).doc
    expect(messages(doc, "general")).toContain("without dimensions is a sketch")
  })
})

describe("electrical checks", () => {
  test("an undersized cable is flagged with its IEC clause", () => {
    const doc = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=1.5, A=32, m=10" }])
    const found = errors(doc, "electrical")
    const ampacity = found.find((f) => f.message.includes("exceeds"))
    expect(ampacity?.message).toContain("32 A on 1.5 mm²")
    expect(ampacity?.message).toContain("19.5 A capacity")
    expect(ampacity?.standard).toContain("IEC 60364-5-52 Table B.52.4")
  })

  test("a correctly sized cable on a short run passes", () => {
    const doc = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=2.5, A=16, m=10, mcb=16" }])
    expect(errors(doc, "electrical")).toHaveLength(0)
  })

  test("voltage drop over a long run is an error against the 5 % limit", () => {
    // 2 × 0.0225 × 60 × 20 / 2.5 = 21.6 V = 9.4 % of 230 V.
    const doc = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=2.5, A=20, m=60" }])
    const drop = errors(doc, "electrical").find((f) => f.message.includes("drop"))
    expect(drop?.message).toContain("over the 5 % limit")
    expect(drop?.standard).toContain("App. G")
  })

  test("a lighting circuit is held to 3 %, not 5 %", () => {
    // 2 × 0.0225 × 40 × 6 / 1.5 = 7.2 V = 3.13 % — over for lighting, fine for power.
    const lighting = sheet(["cables"], [{ layer: "cables", text: "L1 | mm2=1.5, A=6, m=40, use=lighting" }])
    expect(errors(lighting, "electrical").some((f) => f.message.includes("over the 3 % limit"))).toBe(true)

    const power = sheet(["cables"], [{ layer: "cables", text: "P1 | mm2=1.5, A=6, m=40" }])
    expect(errors(power, "electrical").some((f) => f.message.includes("drop"))).toBe(false)
  })

  test("breaker and cable must coordinate", () => {
    const doc = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=1.5, A=10, m=5, mcb=32" }])
    expect(errors(doc, "electrical").some((f) => f.standard?.includes("Ib ≤ In ≤ Iz"))).toBe(true)
  })

  test("a socket circuit with no RCD is an error", () => {
    const doc = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=2.5, A=16, m=10, use=sockets" }])
    const rcd = errors(doc, "electrical").find((f) => f.message.includes("RCD"))
    expect(rcd?.standard).toContain("IEC 60364-4-41")

    const fixed = sheet(["cables"], [{ layer: "cables", text: "W1 | mm2=2.5, A=16, m=10, use=sockets, rcd=30mA" }])
    expect(errors(fixed, "electrical").some((f) => f.message.includes("RCD"))).toBe(false)
  })

  test("a duplicate circuit reference is caught", () => {
    const doc = sheet("cables".split("|"), [
      { layer: "cables", text: "W1 | mm2=2.5, A=16, m=5" },
      { layer: "cables", text: "W1 | mm2=4, A=20, m=5" },
    ])
    expect(errors(doc, "electrical").some((f) => f.message.includes("used twice"))).toBe(true)
  })

  test("what cannot be read is reported as unchecked, never as a pass", () => {
    const doc = sheet(["cables"], [
      { layer: "cables", text: "W1 | mm2=2.5" },
      { layer: "cables", text: "W2 is the kitchen ring" },
      { layer: "cables", text: "W3 | mm2=300, A=100" },
    ])
    const report = checkDoc(doc, "electrical")
    const why = report.unchecked.map((u) => u.why).join("\n")
    expect(why).toContain("needs at least mm2= and A=")
    expect(why).toContain("no `REF | key=value` annotation")
    expect(why).toContain("not in the reference-method-C table")
    expect(report.findings.some((f) => f.severity === "error")).toBe(false)
  })
})

describe("building checks", () => {
  test("a narrow door is flagged against EN 17210", () => {
    const doc = sheet(["doors"], [{ layer: "doors", text: "D1 | w=700, h=2100" }])
    const found = errors(doc, "building").find((f) => f.message.includes("clear"))
    expect(found?.message).toContain("below the 800 mm accessible minimum")
    expect(found?.standard).toContain("EN 17210")
  })

  test("an 900 mm door passes", () => {
    const doc = sheet(["doors"], [{ layer: "doors", text: "D1 | w=900, h=2100" }])
    expect(errors(doc, "building")).toHaveLength(0)
  })

  test("a steep stair breaks the rise, going and pitch limits", () => {
    const steep = sheet(["stairs"], [{ layer: "stairs", text: "S1 | rise=220, going=200" }])
    const found = errors(steep, "building")
    expect(found.some((f) => f.message.includes("exceeds the usual 190"))).toBe(true)
    expect(found.some((f) => f.message.includes("below the usual 250"))).toBe(true)
    expect(found.some((f) => f.message.includes("over the 42° maximum"))).toBe(true)
  })

  test("a stair inside the rise and going limits can still fail 2R+G", () => {
    // 140 and 300 are individually legal, but 2R+G = 580 is outside the comfort band.
    const doc = sheet(["stairs"], [{ layer: "stairs", text: "S1 | rise=140, going=300" }])
    const found = errors(doc, "building")
    expect(found.some((f) => f.message.includes("2R+G is 580"))).toBe(true)
    expect(found.some((f) => f.message.includes("exceeds") || f.message.includes("below"))).toBe(false)
  })

  test("a comfortable stair passes", () => {
    const fine = sheet(["stairs"], [{ layer: "stairs", text: "S1 | rise=175, going=275" }])
    expect(errors(fine, "building")).toHaveLength(0)
  })

  test("a ramp steeper than 1:12 is an error", () => {
    const doc = sheet(["ramps"], [{ layer: "ramps", text: "R1 | gradient=8, rise=300" }])
    expect(errors(doc, "building").some((f) => f.message.includes("1:12 accessible maximum"))).toBe(true)
  })

  test("a room with a load category reports its total imposed load", () => {
    const doc = sheet(["rooms"], [{ layer: "rooms", text: "KITCHEN | area=12, cat=1" }])
    expect(messages(doc, "building")).toContain("24 kN total")
  })
})

describe("iot checks", () => {
  test("a supply that cannot meet the peak draw is an error", () => {
    const doc = sheet(["devices", "supply"], [
      { layer: "supply", text: "PSU | supplyMA=500" },
      { layer: "devices", text: "U1 | mA=250, v=3.3" },
      { layer: "devices", text: "U2 | mA=300, v=3.3" },
    ])
    const found = errors(doc, "iot").find((f) => f.message.includes("power budget"))
    expect(found?.message).toContain("550 mA drawn against 500 mA")
    expect(found?.message).toContain("short by")
  })

  test("mixed logic levels on one bus need a declared level shifter", () => {
    const bad = sheet(["devices"], [
      { layer: "devices", text: "U1 | mA=10, v=3.3, bus=i2c" },
      { layer: "devices", text: "U2 | mA=10, v=5, bus=i2c" },
    ])
    expect(errors(bad, "iot").some((f) => f.message.includes("mixes"))).toBe(true)

    const shifted = sheet(["devices"], [
      { layer: "devices", text: "U1 | mA=10, v=3.3, bus=i2c" },
      { layer: "devices", text: "U2 | mA=10, v=5, bus=i2c" },
      { layer: "devices", text: "LS1 | mA=1, v=5, bus=i2c, shift=yes" },
    ])
    expect(errors(shifted, "iot").some((f) => f.message.includes("mixes"))).toBe(false)
  })

  test("an I2C address collision and a pin clash are caught", () => {
    const doc = sheet(["devices"], [
      { layer: "devices", text: "U1 | mA=5, v=3.3, bus=i2c, addr=0x76, pin=GPIO21" },
      { layer: "devices", text: "U2 | mA=5, v=3.3, bus=i2c, addr=0x76, pin=GPIO21" },
    ])
    const found = errors(doc, "iot")
    expect(found.some((f) => f.message.includes("both claim address 0x76"))).toBe(true)
    expect(found.some((f) => f.message.includes("pin gpio21 is assigned"))).toBe(true)
  })

  test("load with no declared supply is unchecked, not passed", () => {
    const doc = sheet(["devices"], [{ layer: "devices", text: "U1 | mA=250, v=3.3" }])
    const report = checkDoc(doc, "iot")
    expect(report.unchecked.some((u) => u.why.includes("no supply declared"))).toBe(true)
    expect(report.findings.some((f) => f.severity === "error")).toBe(false)
  })
})

describe("formatReport", () => {
  test("puts the unchecked list and the sign-off line in the output", () => {
    const doc = sheet(["cables"], [
      { layer: "cables", text: "W1 | mm2=1.5, A=32, m=10" },
      { layer: "cables", text: "W2 is the kitchen ring" },
    ])
    const output = formatReport("flat", "electrical", checkDoc(doc, "electrical"))
    expect(output).toContain("flat — electrical check:")
    expect(output).toContain("NOT CHECKED")
    expect(output).toContain("treat them as unverified")
    expect(output).toContain("A competent person signs off")
  })

  test("a clean general check says so", () => {
    const doc = applyOps(emptyDoc("s"), [
      { op: "add", entity: { type: "rect", at: [10, 10], w: 50, h: 30 } },
      { op: "add", entity: { type: "dimension", a: [10, 40], b: [60, 40], offset: 10 } },
    ]).doc
    expect(formatReport("plate", "general", checkDoc(doc, "general"))).toContain("nothing found")
  })
})
