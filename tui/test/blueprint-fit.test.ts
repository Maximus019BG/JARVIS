import { describe, expect, test } from "bun:test"
import { fitStroke, simplify, type StrokePoint } from "../src/blueprint/fit.ts"

/** Samples a parametric path the way a hand would: evenly, with a little jitter. */
function trace(
  at: (t: number) => [number, number],
  steps = 60,
  jitter = 0,
  seed = 1,
): StrokePoint[] {
  // Deterministic pseudo-noise, so a flaky test can never be blamed on randomness.
  let state = seed
  const noise = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return ((state / 2147483648) * 2 - 1) * jitter
  }
  return Array.from({ length: steps + 1 }, (_, index) => {
    const [x, y] = at(index / steps)
    return { x: x + noise(), y: y + noise(), t: index * 16 }
  })
}

const line = (a: [number, number], b: [number, number], jitter = 0) =>
  trace((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 40, jitter)

const circle = (cx: number, cy: number, r: number, jitter = 0) =>
  trace((t) => [cx + r * Math.cos(t * 2 * Math.PI), cy + r * Math.sin(t * 2 * Math.PI)], 72, jitter)

function box(x: number, y: number, w: number, h: number, jitter = 0): StrokePoint[] {
  const corners: [number, number][] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ]
  const out: StrokePoint[] = []
  for (let i = 0; i < corners.length - 1; i++) {
    out.push(...line(corners[i]!, corners[i + 1]!, jitter).map((point) => ({ ...point, t: out.length * 16 })))
  }
  return out
}

describe("simplify", () => {
  test("collapses a straight run to its endpoints", () => {
    const points = Array.from({ length: 20 }, (_, i): [number, number] => [i, 0])
    expect(simplify(points, 0.5)).toEqual([
      [0, 0],
      [19, 0],
    ])
  })

  test("keeps a corner", () => {
    expect(
      simplify(
        [
          [0, 0],
          [5, 0],
          [10, 0],
          [10, 5],
          [10, 10],
        ],
        0.5,
      ),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  test("handles a stroke long enough to blow a recursive implementation", () => {
    const points = Array.from({ length: 20000 }, (_, i): [number, number] => [i, i % 2])
    expect(() => simplify(points, 0.1)).not.toThrow()
  })
})

describe("fitStroke auto-classification", () => {
  test("a straight drag becomes a line", () => {
    const entity = fitStroke(line([0, 0], [100, 0], 0.3))!
    expect(entity.type).toBe("line")
    if (entity.type !== "line") return
    expect(entity.a[0]).toBeCloseTo(0, 0)
    expect(entity.b[0]).toBeCloseTo(100, 0)
  })

  test("a loop becomes a circle with a sane centre and radius", () => {
    const entity = fitStroke(circle(50, 50, 20, 0.4))!
    expect(entity.type).toBe("circle")
    if (entity.type !== "circle") return
    expect(entity.c[0]).toBeCloseTo(50, 0)
    expect(entity.c[1]).toBeCloseTo(50, 0)
    expect(entity.r).toBeCloseTo(20, 0)
  })

  test("four corners become a rect", () => {
    const entity = fitStroke(box(10, 10, 80, 40, 0.3))!
    expect(entity.type).toBe("rect")
    if (entity.type !== "rect") return
    expect(entity.at[0]).toBeCloseTo(10, 0)
    expect(entity.w).toBeCloseTo(80, 0)
    expect(entity.h).toBeCloseTo(40, 0)
  })

  test("a smooth open curve becomes a path, not a faceted polyline", () => {
    const entity = fitStroke(trace((t) => [t * 100, 30 * Math.sin(t * Math.PI)], 80, 0.2))!
    expect(entity.type).toBe("path")
    if (entity.type !== "path") return
    expect(entity.d[0]![0]).toBe("M")
    expect(entity.d.some((command) => command[0] === "C")).toBe(true)
  })

  test("a sharp zigzag stays a polyline", () => {
    const points: StrokePoint[] = []
    const corners: [number, number][] = [
      [0, 0],
      [20, 40],
      [40, 0],
      [60, 40],
    ]
    for (let i = 0; i < corners.length - 1; i++) {
      points.push(...line(corners[i]!, corners[i + 1]!).map((p) => ({ ...p, t: points.length * 16 })))
    }
    const entity = fitStroke(points)!
    expect(entity.type).toBe("polyline")
  })

  test("a twitch too small to be a shape is discarded", () => {
    expect(fitStroke([{ x: 5, y: 5, t: 0 }])).toBeUndefined()
    expect(fitStroke(line([0, 0], [0.2, 0.2]))).toBeUndefined()
  })
})

describe("fitStroke with a forced tool", () => {
  test("the circle tool turns a sloppy oval into a circle", () => {
    // Deliberately not circular: the user picked the tool, so their intent wins.
    const entity = fitStroke(
      trace((t) => [50 + 30 * Math.cos(t * 2 * Math.PI), 50 + 12 * Math.sin(t * 2 * Math.PI)], 72),
      { tool: "circle" },
    )!
    expect(entity.type).toBe("circle")
  })

  test("the line tool ignores the wobble between the ends", () => {
    const entity = fitStroke(trace((t) => [t * 60, 20 * Math.sin(t * Math.PI * 3)], 60), { tool: "line" })!
    expect(entity.type).toBe("line")
    if (entity.type !== "line") return
    expect(entity.a).toEqual([0, 0])
    expect(entity.b[0]).toBeCloseTo(60, 0)
  })

  test("the arc tool sweeps the way the stroke travelled", () => {
    const entity = fitStroke(
      trace((t) => [50 + 25 * Math.cos((t * Math.PI) / 2), 50 + 25 * Math.sin((t * Math.PI) / 2)], 40),
      { tool: "arc" },
    )!
    expect(entity.type).toBe("arc")
    if (entity.type !== "arc") return
    expect(entity.r).toBeCloseTo(25, 0)
    expect(entity.a1).toBeGreaterThan(entity.a0)
    expect(entity.a1 - entity.a0).toBeCloseTo(90, 0)
  })

  test("the rect tool boxes whatever was drawn", () => {
    const entity = fitStroke(circle(50, 50, 20), { tool: "rect" })!
    expect(entity.type).toBe("rect")
    if (entity.type !== "rect") return
    expect(entity.w).toBeCloseTo(40, 0)
  })
})

describe("snapping", () => {
  test("snaps to the grid when asked", () => {
    const entity = fitStroke(line([0.4, 0.3], [98.7, 1.2], 0.2), { tool: "line", snapGrid: 5 })!
    if (entity.type !== "line") throw new Error("expected a line")
    expect(entity.a).toEqual([0, 0])
    expect(entity.b).toEqual([100, 0])
  })

  test("an existing endpoint beats the grid, so shapes actually join", () => {
    const entity = fitStroke(line([0, 0], [99, 1]), {
      tool: "line",
      snapGrid: 10,
      snapPoints: [[98.5, 0.5]],
      snapRadius: 4,
    })!
    if (entity.type !== "line") throw new Error("expected a line")
    expect(entity.b).toEqual([98.5, 0.5])
  })

  test("leaves coordinates alone when snapping is off", () => {
    const entity = fitStroke(line([1.3, 2.7], [50.2, 2.9]), { tool: "line" })!
    if (entity.type !== "line") throw new Error("expected a line")
    expect(entity.a[0]).not.toBe(0)
  })
})
