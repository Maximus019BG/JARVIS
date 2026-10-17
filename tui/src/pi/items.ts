/**
 * Few-shot item finding: teach an item from a few boxed photos, then find it in new ones.
 *
 * There is no training. A frozen DINOv2-small turns a photo into one feature per 14×14
 * patch. Teaching keeps the patches inside the box (what the item looks like) and well
 * outside it (what it was photographed against). Finding marks every scene patch whose
 * nearest taught patch is an item patch, and boxes the connected groups. The background
 * patches are what stop a table that happened to be in every photo from matching too.
 *
 * Shared by the web API's vision routes and, later, the Pi. Runtime-neutral like track.ts:
 * `ort` is handed in, and nothing here imports Bun or Node.
 */
import type { Roi } from "./detect.ts"
import type { Camera, Ort } from "./track.ts"

export class ItemError extends Error {}

/** DINOv2's patch size, and the width of one feature for the small model. */
export const PATCH = 14
export const DIMS = 384
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/** A group needs this many patches (2×2) to count as the item, in teaching and in finding. Measured: stray background matches come in 2–3s. */
export const MIN_PATCHES = 4
/** Taught patches kept per bank. Evenly sampled, so every photo stays represented. */
export const MAX_BANK = 256
const MAX_BOXES = 8
/**
 * Cosine an item patch must reach to count. Measured on pasted-object scenes: the taught
 * item's patches sit at a median of 0.80+, other objects' at 0.2–0.46 and rarely past 0.6.
 * ponytail: a calibration knob, tuned on synthetic scenes only; callers override it per
 * request, and `best` in the answer says how close a miss came.
 */
export const DEFAULT_THRESHOLD = 0.65
/**
 * How far under the bar a patch may score and still join a group whose strongest patch
 * reaches it. Another lamp or room knocks an item's weak patches (edges, plain sides) under
 * the bar while its core holds, and the 2×2 group used to fall apart under `MIN_PATCHES`.
 * 0.65 − 0.1 still sits above the 0.46 other objects topped out at.
 * ponytail: a calibration knob, from synthetic scenes; untuned on real cameras.
 */
export const GROW = 0.1

/** One photo as the model sees it: `cols × rows` unit vectors, row-major, and the photo size they map back to. */
export type Patches = { vectors: Float32Array; cols: number; rows: number; camera: Camera }
/** What a taught item is: up to `MAX_BANK` item patches and background patches, packed. */
export type Item = { pos: Float32Array; neg: Float32Array }
export type Found = Roi & { score: number }

/**
 * Packed RGB → the model's NCHW input. The long side becomes `size` and each side is
 * rounded to whole patches, so the aspect survives: a stretched photo would teach a
 * stretched item, and a phone and a webcam disagree about aspect.
 * ponytail: nearest neighbour aliases on big downscales; area-average if matching is weak.
 */
export function toPixelValues(rgb: Uint8Array, camera: Camera, size = 448) {
  const scale = size / Math.max(camera.width, camera.height)
  const cols = Math.max(1, Math.round((camera.width * scale) / PATCH))
  const rows = Math.max(1, Math.round((camera.height * scale) / PATCH))
  const w = cols * PATCH
  const h = rows * PATCH
  const plane = w * h
  const data = new Float32Array(3 * plane)
  for (let y = 0; y < h; y++) {
    const sourceY = Math.min(camera.height - 1, Math.floor(((y + 0.5) * camera.height) / h))
    for (let x = 0; x < w; x++) {
      const sourceX = Math.min(camera.width - 1, Math.floor(((x + 0.5) * camera.width) / w))
      const source = (sourceY * camera.width + sourceX) * 3
      for (let c = 0; c < 3; c++) data[c * plane + y * w + x] = ((rgb[source + c] ?? 0) / 255 - MEAN[c]!) / STD[c]!
    }
  }
  return { data, cols, rows }
}

/** Another light on the same photo: a gamma, then a gain per channel. */
export type Light = { gain: readonly [number, number, number]; gamma: number }
/**
 * The lights every boxed teach shot is also seen in, so `pos` is not one lamp's worth of
 * item: dim and warm (a lamp at night), brighter and cool (daylight).
 * ponytail: two fixed global lights, untuned; no shadows, glare or noise. Random jitter
 * per shot if these two do not cover a real room.
 */
export const LIGHTS: readonly Light[] = [
  { gain: [0.69, 0.6, 0.45], gamma: 1.15 },
  { gain: [1.1, 1.25, 1.4], gamma: 0.9 },
]

/** Packed RGB under `light`, through one 256-entry table per channel. */
export function relight(rgb: Uint8Array, { gain, gamma }: Light): Uint8Array {
  const tables = gain.map((g) => Uint8Array.from({ length: 256 }, (_, v) => Math.round(255 * Math.min(1, g * (v / 255) ** gamma))))
  return rgb.map((v, i) => tables[i % 3]![v]!)
}

/** Scales each `DIMS`-wide vector to unit length in place, so cosine is a plain dot product. */
export function normalise(vectors: Float32Array): Float32Array {
  for (let start = 0; start < vectors.length; start += DIMS) {
    let sum = 0
    for (let i = start; i < start + DIMS; i++) sum += vectors[i]! * vectors[i]!
    const inverse = sum > 0 ? 1 / Math.sqrt(sum) : 0
    for (let i = start; i < start + DIMS; i++) vectors[i]! *= inverse
  }
  return vectors
}

export type Embedder = { embed(rgb: Uint8Array, camera: Camera): Promise<Patches> }

export async function createEmbedder(ort: Ort, path: string, size = 448): Promise<Embedder> {
  const session = await ort.InferenceSession.create(path)
  return {
    async embed(rgb, camera) {
      const { data, cols, rows } = toPixelValues(rgb, camera, size)
      const output = await session.run({
        [session.inputNames[0]!]: new ort.Tensor("float32", data, [1, 3, rows * PATCH, cols * PATCH]),
      })
      const tokens = output[session.outputNames[0]!]!.data as Float32Array
      // A model with register tokens, or a wider one, would silently shift every patch.
      if (tokens.length !== (1 + cols * rows) * DIMS) {
        throw new ItemError(`expected ${1 + cols * rows}×${DIMS} tokens, got ${tokens.length} values — wrong model?`)
      }
      // Token 0 is CLS: the whole photo, not a place in it.
      return { vectors: normalise(tokens.slice(DIMS)), cols, rows, camera }
    },
  }
}

const vectorAt = (vectors: Float32Array, index: number) => vectors.subarray(index * DIMS, (index + 1) * DIMS)

function pack(list: readonly Float32Array[]): Float32Array {
  return join(list.length <= MAX_BANK ? list : Array.from({ length: MAX_BANK }, (_, i) => list[Math.floor((i * list.length) / MAX_BANK)]!))
}

/**
 * A box patch this close to any background patch is background seen through the box, not
 * the item: the wall or table behind it, in every shot, at the same place.
 * ponytail: a calibration knob, set just above the 0.6 that unrelated content rarely passes
 * (see `DEFAULT_THRESHOLD`); untuned on real cameras.
 */
export const BACKGROUND_SIM = 0.7

const join = (list: readonly Float32Array[]) => {
  const out = new Float32Array(list.length * DIMS)
  list.forEach((vector, i) => out.set(vector, i * DIMS))
  return out
}

/**
 * Turns boxed photos into an item. A patch counts as the item when it lies wholly inside
 * the box, and as background when its centre is more than a patch clear of it. The ones
 * on the edge are part item, part table, and neither bank wants them: measured, letting
 * edge patches into `pos` made the training backgrounds themselves match at 0.79.
 *
 * A photo with no box is a background shot, the empty spot the item is held in: all of it
 * is background. The box is always bigger than the item, so what is behind the item lands
 * in `pos` too; any `pos` patch that matches a background patch is dropped. Without that,
 * the empty spot matched the item at the same place once the item was gone.
 *
 * `relit` are the same boxed photo under `LIGHTS`, same grid. Their box patches join `pos`
 * alongside the original's, and go with it when it is pruned.
 * ponytail: the prune is pos × every neg patch × 384 (~1 s for 7 photos); once per teach.
 */
export function learn(samples: readonly { patches: Patches; box: Roi | null; relit?: readonly Patches[] }[]): Item {
  /** One box patch per entry: the original first, then its copy under each light. */
  const pos: Float32Array[][] = []
  const neg: Float32Array[] = []
  if (!samples.some((sample) => sample.box)) throw new ItemError("no photo has the item in a box")
  samples.forEach(({ patches, box, relit = [] }, photo) => {
    const { cols, rows, camera } = patches
    const pw = camera.width / cols
    const ph = camera.height / rows
    let inside = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * pw
        const y = (r + 0.5) * ph
        const vector = vectorAt(patches.vectors, r * cols + c)
        if (!box) neg.push(vector)
        else if (c * pw >= box.x && (c + 1) * pw <= box.x + box.w && r * ph >= box.y && (r + 1) * ph <= box.y + box.h) {
          pos.push([vector, ...relit.map((copy) => vectorAt(copy.vectors, r * cols + c))])
          inside++
        } else if (x < box.x - pw || x >= box.x + box.w + pw || y < box.y - ph || y >= box.y + box.h + ph) {
          neg.push(vector)
        }
      }
    }
    if (box && inside < MIN_PATCHES) {
      throw new ItemError(`photo ${photo}: the box covers ${inside} patch(es), needs ${MIN_PATCHES} — the item is too small, send a closer shot`)
    }
  })
  // Against every background patch, not the packed bank: packing keeps 256 of thousands and
  // would usually drop the very spot behind the item.
  const background = join(neg)
  const kept = pos.filter(([original]) => nearest(original!, background) < BACKGROUND_SIM)
  if (kept.length < MIN_PATCHES) {
    throw new ItemError("the item looks like what is behind it — try a plainer background or a tighter box")
  }
  // Light by light, not patch by patch: with 3 lights and a stride of exactly 3, an even
  // sample of interleaved [a, a', a'', b, …] would keep only the originals.
  const item: Float32Array[] = []
  const lights = Math.max(...kept.map((group) => group.length))
  for (let light = 0; light < lights; light++) for (const group of kept) if (group[light]) item.push(group[light]!)
  return { pos: pack(item), neg: pack(neg) }
}

/**
 * One item from two teaches of it, say in two rooms: both banks pooled and sampled again,
 * so each teach keeps a share in proportion to its patches.
 * ponytail: every add halves the older teaches' share; a per-teach cap or a bigger
 * `MAX_BANK` if a third or fourth room fades.
 */
export function merge(a: Item, b: Item): Item {
  const vectors = (bank: Float32Array) => Array.from({ length: bank.length / DIMS }, (_, i) => vectorAt(bank, i))
  return { pos: pack([...vectors(a.pos), ...vectors(b.pos)]), neg: pack([...vectors(a.neg), ...vectors(b.neg)]) }
}

/** Highest dot product of `vector` against every vector in `bank`; -Infinity for an empty bank. */
function nearest(vector: Float32Array, bank: Float32Array): number {
  let best = -Infinity
  for (let offset = 0; offset < bank.length; offset += DIMS) {
    let dot = 0
    for (let i = 0; i < DIMS; i++) dot += vector[i]! * bank[offset + i]!
    if (dot > best) best = dot
  }
  return best
}

/**
 * Where the item is in a scene: one box per connected group of item patches, best first.
 * A group needs one patch at `threshold`; the rest may be up to `GROW` under it.
 * The groups are disjoint by construction, so there is nothing for NMS to do.
 *
 * `best` is the strongest patch that beat the background, found or not, the same way
 * speaker `identify` answers: "0.48, and the bar is 0.55" is what lets someone tune it.
 * ponytail: brute-force nearest neighbour, scene × 512 × 384 per item (~150M multiply-adds
 * at 448px). Fine for a handful of items; an index or a smaller bank if it grows to dozens.
 */
export function locate(scene: Patches, item: Item, threshold = DEFAULT_THRESHOLD): { best: number; boxes: Found[] } {
  const { cols, rows, camera } = scene
  const count = cols * rows
  const score = new Float32Array(count)
  const on = new Uint8Array(count)
  let best = 0
  const grow = threshold - GROW
  for (let i = 0; i < count; i++) {
    const vector = vectorAt(scene.vectors, i)
    const p = nearest(vector, item.pos)
    if (p <= nearest(vector, item.neg)) continue
    score[i] = p
    best = Math.max(best, p)
    if (p >= grow) on[i] = 1
  }

  const pw = camera.width / cols
  const ph = camera.height / rows
  const seen = new Uint8Array(count)
  const boxes: Found[] = []
  for (let start = 0; start < count; start++) {
    if (!on[start] || seen[start]) continue
    seen[start] = 1
    const stack = [start]
    let left = cols, right = -1, top = rows, bottom = -1, sum = 0, size = 0, peak = 0
    while (stack.length > 0) {
      const i = stack.pop()!
      const r = Math.floor(i / cols)
      const c = i % cols
      left = Math.min(left, c)
      right = Math.max(right, c)
      top = Math.min(top, r)
      bottom = Math.max(bottom, r)
      sum += score[i]!
      peak = Math.max(peak, score[i]!)
      size++
      for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
        if (j >= 0 && j < count && on[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (size < MIN_PATCHES || peak < threshold) continue
    boxes.push({ x: left * pw, y: top * ph, w: (right - left + 1) * pw, h: (bottom - top + 1) * ph, score: sum / size })
  }
  boxes.sort((a, b) => b.score - a.score)
  return { best, boxes: boxes.slice(0, MAX_BOXES) }
}
