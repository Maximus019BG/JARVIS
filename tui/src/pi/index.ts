import type { ServerWebSocket } from "bun"
import { DEFAULT_FIT, fitStroke, type StrokePoint, type Tool } from "../blueprint/fit.ts"
import { flatten } from "../blueprint/geom.ts"
import { applyOps } from "../blueprint/ops.ts"
import { emptyDoc, serialize, type BlueprintDoc, type Pt } from "../blueprint/schema.ts"
import { blueprintRoot, exists, readDoc, safeName, writeDoc } from "../blueprint/store.ts"
import type { Config } from "../config/config.ts"
import {
  applyHomography,
  calibrate,
  calibrationPath,
  matrixOf,
  saveCalibration,
  TARGETS,
  usableCalibration,
  type Homography,
} from "./calibration.ts"
import { DEFAULT_GESTURES, GestureReader, type Frame } from "./gestures.ts"
import { DEFAULT_CAMERA, onnxSource, replaySource, scriptedSource, type Camera, type HandSource } from "./hand-source.ts"
import { fetchModels, missingModels } from "./models.ts"
import { projectorPage } from "./projector-page.ts"

export type PiOptions = {
  config: Config
  /** Blueprint to draw into. Created if it does not exist. */
  blueprint: string
  port: number
  source: "rpicam" | "webcam" | "script" | "replay"
  replayPath?: string
  camera?: Camera
  /** Run the calibration flow instead of drawing. */
  calibrateOnly?: boolean
  /** Fetch models and exit. */
  modelsOnly?: boolean
}

const TOOLS: Tool[] = ["auto", "line", "polyline", "rect", "circle", "arc", "path"]

type Client = ServerWebSocket<undefined>

/**
 * Flattened geometry, ready to stroke. The projector receives polylines rather than
 * entities so it never has to know what an arc is — the engine stays the only thing that
 * turns an entity into points.
 */
type Scene = {
  viewBox: BlueprintDoc["viewBox"]
  shapes: { runs: number[][]; color?: string; width?: number; dash?: string }[]
  labels: { text: string; at: Pt; size?: number; color?: string; angle?: number; align?: string }[]
}

/** Everything the projector needs to render, and nothing else. */
type Broadcast =
  | { type: "scene"; scene: Scene }
  | { type: "stroke"; points: number[] }
  | { type: "cursor"; at: Pt | null }
  | { type: "tool"; tool: string }
  | { type: "status"; text: string }
  | { type: "calibrate"; index: number; total: number; target: Pt }
  | { type: "calibrate-done" }

/**
 * The Pi daemon: camera in, strokes out, and a projected view of the drawing.
 *
 * The pipeline is deliberately one direction — hand source → gestures → stroke buffer →
 * fit → blueprint commit — with the projector as a pure observer. Nothing the browser does
 * can affect the drawing, which means the kiosk can crash, reload or be closed entirely
 * without the recorded geometry noticing.
 */
export async function runPi(options: PiOptions): Promise<void> {
  const root = blueprintRoot(options.config)
  const name = safeName(options.blueprint)

  if (options.modelsOnly) {
    const { fetched, errors } = await fetchModels((message) => process.stdout.write(`${message}\n`))
    for (const error of errors) process.stderr.write(`warning: ${error}\n`)
    process.stdout.write(
      fetched.length > 0 ? `fetched ${fetched.length} model(s)\n` : "models already present\n",
    )
    if (errors.length > 0) process.exitCode = 1
    return
  }

  // Calibrating is about the rig, not about a drawing, so it must not create one as a side
  // effect. It still reads an existing blueprint when there is one, because the sheet size
  // it calibrates against should be the sheet actually in use.
  if (!exists(root, name) && !options.calibrateOnly) {
    writeDoc(root, name, emptyDoc(name), "create")
    process.stdout.write(`created blueprint ${name}\n`)
  }
  let doc = exists(root, name) ? readDoc(root, name) : emptyDoc(name)

  // Optional chaining throughout: a config from `loadConfig` always carries these, but a
  // caller constructing one by hand should get defaults rather than a crash, and the
  // defaults already exist as constants so there is no second copy of them here.
  const settings = options.config.blueprint?.pi
  const tuning = { ...DEFAULT_GESTURES, ...settings?.gestures }
  const fit = { ...DEFAULT_FIT, ...settings?.fit }

  // A pen that closes at a looser threshold than it opens has no hysteresis at all — it
  // chatters, and every stroke breaks into fragments. Worth refusing rather than debugging.
  if (tuning.pinchExit <= tuning.pinchEnter) {
    throw new Error(
      `blueprint.pi.gestures.pinchExit (${tuning.pinchExit}) must be greater than pinchEnter ` +
        `(${tuning.pinchEnter}) — otherwise the pen has no hysteresis and flickers`,
    )
  }

  // --- projector server ---------------------------------------------------------------
  const clients = new Set<Client>()
  const page = projectorPage()

  const send = (message: Broadcast) => {
    const text = JSON.stringify(message)
    for (const client of clients) client.send(text)
  }
  const status = (text: string) => send({ type: "status", text })

  const server = Bun.serve({
    port: options.port ?? settings?.port ?? 7331,
    fetch(request, self) {
      const url = new URL(request.url)
      if (url.pathname === "/live") {
        return self.upgrade(request) ? undefined : new Response("upgrade failed", { status: 400 })
      }
      if (url.pathname === "/" || url.pathname === "/projector") {
        return new Response(page, { headers: { "content-type": "text/html" } })
      }
      return new Response("not found", { status: 404 })
    },
    websocket: {
      open(client) {
        clients.add(client)
        client.send(JSON.stringify({ type: "scene", scene: sceneOf(doc) } satisfies Broadcast))
        client.send(JSON.stringify({ type: "tool", tool } satisfies Broadcast))
      },
      close(client) {
        clients.delete(client)
      },
      message() {
        // The projector is display-only. Ignoring input here is what keeps a compromised
        // or confused browser from being able to modify the drawing.
      },
    },
  })
  process.stdout.write(`projector at http://localhost:${server.port}/projector\n`)

  // --- hand source --------------------------------------------------------------------
  const camera = options.camera ?? settings?.camera ?? DEFAULT_CAMERA
  let source: HandSource
  if (options.source === "script" && options.calibrateOnly) {
    // Taps the four markers where a perfectly square rig would see them, so the
    // calibration flow itself is exercisable without a projector.
    const inset = 120
    const taps = [
      [inset, inset],
      [camera.width - inset, inset],
      [camera.width - inset, camera.height - inset],
      [inset, camera.height - inset],
    ] as [number, number][]
    source = scriptedSource(
      taps.flatMap((to) => [
        { to, frames: 6, pinch: 1, fingers: 1 },
        { to, frames: 6, pinch: 0.2, fingers: 1 },
        { to, frames: 6, pinch: 1, fingers: 1 },
      ]),
      camera,
      { paced: true },
    )
  } else if (options.source === "script") {
    // A scripted square, so the whole pipeline can be exercised with no camera at all.
    const inset = 120
    source = scriptedSource(
      [
        { to: [inset, inset], frames: 10, pinch: 1, fingers: 1 },
        { to: [inset, inset], frames: 4, pinch: 0.2, fingers: 1 },
        { to: [camera.width - inset, inset], frames: 20, pinch: 0.2, fingers: 1 },
        { to: [camera.width - inset, camera.height - inset], frames: 20, pinch: 0.2, fingers: 1 },
        { to: [inset, camera.height - inset], frames: 20, pinch: 0.2, fingers: 1 },
        { to: [inset, inset], frames: 20, pinch: 0.2, fingers: 1 },
        { to: [inset, inset], frames: 6, pinch: 1, fingers: 1 },
        { to: [inset, inset], frames: 10, pinch: 1, fingers: -1 },
      ],
      camera,
      // Paced, so the projected view has wall-clock time to show the stroke being drawn.
      { paced: true },
    )
  } else if (options.source === "replay") {
    source = replaySource(options.replayPath!, camera)
  } else {
    const missing = missingModels()
    if (missing.length > 0) {
      throw new Error(`missing models: ${missing.join(", ")} — run \`jarvis pi models\` first`)
    }
    source = onnxSource({ camera, source: options.source === "rpicam" ? "rpicam" : "ffmpeg" })
  }

  // --- calibration --------------------------------------------------------------------
  const sheet = { width: doc.viewBox[2], height: doc.viewBox[3] }
  let matrix: Homography | undefined
  const usable = usableCalibration(camera, calibrationPath)

  if (options.calibrateOnly || "stale" in usable) {
    if ("stale" in usable && !options.calibrateOnly) {
      process.stdout.write(`${usable.stale}\n`)
      status(usable.stale)
    }
    matrix = await runCalibration(source, camera, sheet, send, status, tuning)
    if (!matrix) {
      source.close()
      server.stop(true)
      return
    }
    if (options.calibrateOnly) {
      process.stdout.write("calibration saved — run `jarvis pi` to draw\n")
      source.close()
      server.stop(true)
      return
    }
  } else {
    matrix = matrixOf(usable.calibration)
    process.stdout.write(`calibrated, mean error ${usable.calibration.error.toFixed(2)}mm\n`)
  }

  // --- drawing ------------------------------------------------------------------------
  const gestures = new GestureReader(tuning)
  let tool: Tool = "auto"
  let stroke: StrokePoint[] = []

  const toSheet = (at: Pt): Pt => applyHomography(matrix!, at)

  const commit = (entity: ReturnType<typeof fitStroke>) => {
    if (!entity) return
    const result = applyOps(doc, [{ op: "add", entity }])
    doc = result.doc
    writeDoc(root, name, doc, result.summary)
    send({ type: "scene", scene: sceneOf(doc) })
    status(`${result.summary} · ${doc.entities.length} entities`)
  }

  const undo = () => {
    const last = doc.entities.at(-1)
    if (!last) return
    const result = applyOps(doc, [{ op: "delete", ids: [last.id!] }])
    doc = result.doc
    writeDoc(root, name, doc, "undo")
    send({ type: "scene", scene: sceneOf(doc) })
    status(`undid ${last.type}`)
  }

  status("ready — pinch to draw")

  for await (const frame of source.frames()) {
    for (const event of gestures.push(frame)) {
      if (event.type === "pen-down") {
        const at = toSheet(event.at)
        stroke = [{ x: at[0], y: at[1], t: frame.t }]
        send({ type: "cursor", at })
      } else if (event.type === "pen-move") {
        const at = toSheet(event.at)
        stroke.push({ x: at[0], y: at[1], t: frame.t })
        send({ type: "stroke", points: stroke.flatMap((point) => [point.x, point.y]) })
        send({ type: "cursor", at })
      } else if (event.type === "pen-up") {
        // Snapping to existing endpoints is what makes hand-drawn shapes actually join.
        const endpoints = endpointsOf(doc)
        commit(
          fitStroke(stroke, {
            tool,
            snapPoints: endpoints,
            tolerance: fit.tolerance,
            smoothing: fit.smoothing,
            snapGrid: fit.snapGrid,
            snapRadius: fit.snapRadius,
          }),
        )
        stroke = []
        send({ type: "stroke", points: [] })
        send({ type: "cursor", at: null })
      } else if (event.type === "cancel") {
        stroke = []
        send({ type: "stroke", points: [] })
        send({ type: "cursor", at: null })
        status("cancelled")
      } else if (event.type === "undo") {
        undo()
      } else if (event.type === "palette") {
        tool = TOOLS[(TOOLS.indexOf(tool) + 1) % TOOLS.length]!
        send({ type: "tool", tool })
        status(`tool: ${tool}`)
      }
    }
  }

  source.close()
  server.stop(true)
}

/**
 * Flattens a document into what the projector draws. Runs on every commit rather than every
 * frame, so a few hundred entities of tessellation costs nothing — and the live stroke,
 * which *is* per-frame, is already just points.
 */
function sceneOf(doc: BlueprintDoc): Scene {
  const layers = new Map(doc.layers.map((layer) => [layer.id, layer]))
  const shapes: Scene["shapes"] = []
  const labels: Scene["labels"] = []

  for (const entity of doc.entities) {
    const layer = layers.get(entity.layer ?? doc.layers[0]!.id)
    if (layer?.visible === false) continue
    const color = entity.stroke ?? layer?.color

    if (entity.type === "text") {
      labels.push({ text: entity.text, at: entity.at, size: entity.size, color, angle: entity.angle })
      continue
    }

    const runs = flatten(entity).map((run) => run.flatMap(([x, y]) => [x, y]))
    if (runs.length > 0) shapes.push({ runs, color, width: entity.width, dash: entity.dash })

    // A dimension without its measurement is just a line with arrows on it.
    if (entity.type === "dimension") {
      const length = Math.hypot(entity.b[0] - entity.a[0], entity.b[1] - entity.a[1]) || 1
      const nx = -(entity.b[1] - entity.a[1]) / length
      const ny = (entity.b[0] - entity.a[0]) / length
      const away = entity.offset + Math.sign(entity.offset || 1) * 3
      labels.push({
        text: entity.label ?? String(Math.round(length * 100) / 100),
        at: [(entity.a[0] + entity.b[0]) / 2 + nx * away, (entity.a[1] + entity.b[1]) / 2 + ny * away],
        size: 3,
        color,
        align: "center",
      })
    }
  }

  return { viewBox: doc.viewBox, shapes, labels }
}

/** Existing endpoints worth snapping a new stroke to. */
function endpointsOf(doc: BlueprintDoc): Pt[] {
  const points: Pt[] = []
  for (const entity of doc.entities) {
    if (entity.type === "line") points.push(entity.a, entity.b)
    else if (entity.type === "polyline") points.push(entity.pts[0]!, entity.pts.at(-1)!)
    else if (entity.type === "circle") points.push(entity.c)
    else if (entity.type === "rect") points.push(entity.at)
  }
  return points
}

/**
 * Projects four markers and records where the camera saw the fingertip touch each one.
 *
 * This has to happen on real hardware every time the projector moves, which is why it is a
 * first-class flow rather than a constant in a config file: no amount of arithmetic can
 * guess the angle a projector is sitting at.
 */
async function runCalibration(
  source: HandSource,
  camera: Camera,
  sheet: { width: number; height: number },
  send: (message: Broadcast) => void,
  status: (text: string) => void,
  tuning: typeof DEFAULT_GESTURES,
): Promise<Homography | undefined> {
  const gestures = new GestureReader(tuning)
  const captured: Pt[] = []

  status("calibrating — pinch on each marker")
  send({ type: "calibrate", index: 0, total: TARGETS.length, target: target(0, sheet) })

  for await (const frame of source.frames()) {
    for (const event of gestures.push(frame)) {
      // Only the moment of contact counts; a drag afterwards is noise.
      if (event.type !== "pen-down") continue
      captured.push(event.at)
      if (captured.length >= TARGETS.length) {
        send({ type: "calibrate-done" })
        const result = calibrate(captured, camera, sheet, new Date().toISOString())
        if ("error" in result) {
          status(`calibration failed: ${result.error}`)
          process.stderr.write(`calibration failed: ${result.error}\n`)
          return undefined
        }
        saveCalibration(result.calibration)
        const message = `calibrated, mean error ${result.calibration.error.toFixed(2)}mm`
        process.stdout.write(`${message}\n`)
        if (result.calibration.error > 5) {
          process.stderr.write(
            "warning: that is a large error — the markers were probably touched imprecisely. Recalibrate for better accuracy.\n",
          )
        }
        status(message)
        return matrixOf(result.calibration)
      }
      send({
        type: "calibrate",
        index: captured.length,
        total: TARGETS.length,
        target: target(captured.length, sheet),
      })
    }
  }
  return undefined
}

const target = (index: number, sheet: { width: number; height: number }): Pt => [
  TARGETS[index]![0] * sheet.width,
  TARGETS[index]![1] * sheet.height,
]

export { serialize }
