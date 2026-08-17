import { flatten } from "./geom.ts"
import type { BlueprintDoc, Entity, Layer } from "./schema.ts"

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!)

const num = (value: number) => String(Math.round(value * 1e3) / 1e3)

const DASH: Record<string, string> = { dashed: "4 2", dotted: "1 2" }

function strokeAttrs(entity: Entity, layer: Layer | undefined, scale: number): string {
  const color = entity.stroke ?? layer?.color ?? "currentColor"
  const width = (entity.width ?? 0.4) * scale
  const dash = entity.dash && entity.dash !== "solid" ? ` stroke-dasharray="${DASH[entity.dash]}"` : ""
  return `fill="none" stroke="${escape(color)}" stroke-width="${num(width)}"${dash}`
}

/**
 * SVG shares this format's coordinate system exactly — Y down, same viewBox meaning —
 * so export is a direct transcription with no flips or offsets. Curves go out as real
 * arcs and béziers rather than the flattened polylines, so the file stays editable in
 * a vector tool; only `dimension` is emitted pre-flattened, since it has no SVG analogue.
 */
export function toSvg(doc: BlueprintDoc, options: { width?: number; showGrid?: boolean; layers?: string[] } = {}): string {
  const [vx, vy, vw, vh] = doc.viewBox
  const layers = new Map(doc.layers.map((layer) => [layer.id, layer]))
  const shown = new Set(
    doc.layers
      .filter((layer) => (options.layers ? options.layers.includes(layer.id) : layer.visible !== false))
      .map((layer) => layer.id),
  )
  // Stroke widths are authored in document units, so they need no scaling — but a very
  // large or small sheet reads better with a nudge, and this keeps hairlines visible.
  const scale = Math.max(vw, vh) / 300

  const body: string[] = []

  if (options.showGrid) {
    body.push(
      `  <defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">` +
        `<path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" stroke-width="${num(0.1 * scale)}" opacity="0.25"/>` +
        `</pattern></defs>`,
      `  <rect x="${num(vx)}" y="${num(vy)}" width="${num(vw)}" height="${num(vh)}" fill="url(#grid)"/>`,
    )
  }

  for (const entity of doc.entities) {
    const layer = layers.get(entity.layer ?? doc.layers[0]!.id)
    if (!shown.has(layer?.id ?? "")) continue
    const attrs = strokeAttrs(entity, layer, scale)
    const id = ` id="${escape(entity.id ?? "")}"`

    switch (entity.type) {
      case "line":
        body.push(
          `  <line${id} x1="${num(entity.a[0])}" y1="${num(entity.a[1])}" x2="${num(entity.b[0])}" y2="${num(entity.b[1])}" ${attrs}/>`,
        )
        break
      case "polyline": {
        const points = entity.pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")
        const tag = entity.closed ? "polygon" : "polyline"
        body.push(`  <${tag}${id} points="${points}" ${attrs}/>`)
        break
      }
      case "rect": {
        // Negative width/height is legal in this format but not in SVG.
        const x = entity.w < 0 ? entity.at[0] + entity.w : entity.at[0]
        const y = entity.h < 0 ? entity.at[1] + entity.h : entity.at[1]
        const rx = entity.rx ? ` rx="${num(entity.rx)}"` : ""
        body.push(
          `  <rect${id} x="${num(x)}" y="${num(y)}" width="${num(Math.abs(entity.w))}" height="${num(Math.abs(entity.h))}"${rx} ${attrs}/>`,
        )
        break
      }
      case "circle":
        body.push(`  <circle${id} cx="${num(entity.c[0])}" cy="${num(entity.c[1])}" r="${num(entity.r)}" ${attrs}/>`)
        break
      case "arc": {
        const rad = (deg: number) => (deg * Math.PI) / 180
        const sweep = entity.a1 - entity.a0
        const sx = entity.c[0] + entity.r * Math.cos(rad(entity.a0))
        const sy = entity.c[1] + entity.r * Math.sin(rad(entity.a0))
        const ex = entity.c[0] + entity.r * Math.cos(rad(entity.a1))
        const ey = entity.c[1] + entity.r * Math.sin(rad(entity.a1))
        // A full turn has no arc representation — both endpoints coincide, so SVG draws
        // nothing. Fall back to a circle.
        if (Math.abs(sweep) >= 360) {
          body.push(`  <circle${id} cx="${num(entity.c[0])}" cy="${num(entity.c[1])}" r="${num(entity.r)}" ${attrs}/>`)
          break
        }
        const large = Math.abs(sweep) > 180 ? 1 : 0
        const positive = sweep > 0 ? 1 : 0
        body.push(
          `  <path${id} d="M ${num(sx)} ${num(sy)} A ${num(entity.r)} ${num(entity.r)} 0 ${large} ${positive} ${num(ex)} ${num(ey)}" ${attrs}/>`,
        )
        break
      }
      case "path": {
        const d = entity.d
          .map((command) => (command[0] === "Z" ? "Z" : `${command[0]} ${command.slice(1).map(Number).map(num).join(" ")}`))
          .join(" ")
        body.push(`  <path${id} d="${d}" ${attrs}/>`)
        break
      }
      case "text": {
        const size = entity.size ?? 4
        const color = entity.stroke ?? layer?.color ?? "currentColor"
        const spin = entity.angle ? ` transform="rotate(${num(entity.angle)} ${num(entity.at[0])} ${num(entity.at[1])})"` : ""
        body.push(
          `  <text${id} x="${num(entity.at[0])}" y="${num(entity.at[1])}" font-size="${num(size)}" ` +
            `font-family="ui-sans-serif, system-ui, sans-serif" fill="${escape(color)}"${spin}>${escape(entity.text)}</text>`,
        )
        break
      }
      case "dimension": {
        for (const run of flatten(entity)) {
          const points = run.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")
          body.push(`  <polyline points="${points}" ${attrs}/>`)
        }
        const length = Math.hypot(entity.b[0] - entity.a[0], entity.b[1] - entity.a[1])
        const label = entity.label ?? `${Math.round(length * 100) / 100}`
        const mx = (entity.a[0] + entity.b[0]) / 2
        const my = (entity.a[1] + entity.b[1]) / 2
        const nx = -(entity.b[1] - entity.a[1]) / (length || 1)
        const ny = (entity.b[0] - entity.a[0]) / (length || 1)
        const color = entity.stroke ?? layer?.color ?? "currentColor"
        body.push(
          `  <text x="${num(mx + nx * (entity.offset + Math.sign(entity.offset || 1) * 2))}" ` +
            `y="${num(my + ny * (entity.offset + Math.sign(entity.offset || 1) * 2))}" ` +
            `font-size="${num(3 * scale)}" text-anchor="middle" ` +
            `font-family="ui-sans-serif, system-ui, sans-serif" fill="${escape(color)}">${escape(label)}</text>`,
        )
        break
      }
    }
  }

  const width = options.width ? ` width="${num(options.width)}"` : ""
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}"${width} role="img" aria-label="${escape(doc.name)}">`,
    ...body,
    "</svg>",
    "",
  ].join("\n")
}
