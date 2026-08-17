/**
 * Hand landmark indices, MediaPipe order. Any hand source has to produce this layout.
 */
export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX_MCP = 5
export const INDEX_PIP = 6
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const MIDDLE_PIP = 10
export const MIDDLE_TIP = 12
export const RING_TIP = 16
export const PINKY_MCP = 17
export const PINKY_TIP = 20

export type Landmark = { x: number; y: number; z?: number }

export type Hand = {
  handedness?: "left" | "right"
  score: number
  /** 21 landmarks in camera pixel coordinates. */
  landmarks: Landmark[]
}

export type Frame = { t: number; hands: Hand[] }

export type GestureConfig = {
  /**
   * Pinch thresholds as a fraction of hand size, not pixels: a hand twice as far from the
   * camera is half the size on screen, and a fixed pixel threshold would stop working the
   * moment the user leans in. Separate enter/exit values give hysteresis — with one
   * threshold a finger sitting right on it toggles the pen every other frame.
   */
  pinchEnter: number
  pinchExit: number
  /** Frames a change must persist before it counts. */
  debounce: number
  /** How long a point has to be held before the palette opens. */
  pointHoldMs: number
  /** Minimum detector confidence to consider a hand at all. */
  minScore: number
  /** Two-hand pinch distance change, as a fraction, before it reads as a zoom. */
  zoomDeadZone: number
}

export const DEFAULT_GESTURES: GestureConfig = {
  pinchEnter: 0.32,
  pinchExit: 0.45,
  debounce: 3,
  pointHoldMs: 400,
  minScore: 0.6,
  zoomDeadZone: 0.08,
}

export type GestureEvent =
  | { type: "pen-down"; at: [number, number] }
  | { type: "pen-move"; at: [number, number] }
  | { type: "pen-up" }
  | { type: "palette"; at: [number, number] }
  | { type: "cancel" }
  | { type: "undo" }
  | { type: "zoom"; scale: number; centre: [number, number] }

const gap = (a: Landmark, b: Landmark) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * Wrist to middle-finger knuckle: the most stable length on a hand, since it barely
 * changes as fingers move. Everything else is measured relative to it so the gestures are
 * scale-invariant.
 */
export function handSpan(hand: Hand): number {
  const wrist = hand.landmarks[WRIST]
  const middle = hand.landmarks[MIDDLE_MCP]
  if (!wrist || !middle) return 0
  return Math.max(gap(wrist, middle), 1e-6)
}

/** Thumb-tip to index-tip distance, in hand spans. */
export function pinchRatio(hand: Hand): number {
  const thumb = hand.landmarks[THUMB_TIP]
  const index = hand.landmarks[INDEX_TIP]
  if (!thumb || !index) return Infinity
  return gap(thumb, index) / handSpan(hand)
}

/** Which of the four fingers are extended, by tip-from-wrist versus pip-from-wrist. */
export function extendedFingers(hand: Hand): number {
  const wrist = hand.landmarks[WRIST]
  if (!wrist) return 0
  const pairs: [number, number][] = [
    [INDEX_TIP, INDEX_PIP],
    [MIDDLE_TIP, MIDDLE_PIP],
    [RING_TIP, RING_TIP - 2],
    [PINKY_TIP, PINKY_TIP - 2],
  ]
  let count = 0
  for (const [tip, pip] of pairs) {
    const tipMark = hand.landmarks[tip]
    const pipMark = hand.landmarks[pip]
    if (tipMark && pipMark && gap(wrist, tipMark) > gap(wrist, pipMark) * 1.15) count += 1
  }
  return count
}

/** Index extended while the others are curled. */
export function isPointing(hand: Hand): boolean {
  const wrist = hand.landmarks[WRIST]
  const index = hand.landmarks[INDEX_TIP]
  const indexPip = hand.landmarks[INDEX_PIP]
  if (!wrist || !index || !indexPip) return false
  const indexOut = gap(wrist, index) > gap(wrist, indexPip) * 1.15;
  return indexOut && extendedFingers(hand) === 1
}

export const isOpenPalm = (hand: Hand): boolean => extendedFingers(hand) === 4
export const isFist = (hand: Hand): boolean => extendedFingers(hand) === 0 && pinchRatio(hand) < 0.9

/** Midpoint of thumb and index tips — where a pinch actually feels like it is. */
export function pinchPoint(hand: Hand): [number, number] {
  const thumb = hand.landmarks[THUMB_TIP]!
  const index = hand.landmarks[INDEX_TIP]!
  return [(thumb.x + index.x) / 2, (thumb.y + index.y) / 2]
}

/** Counts consecutive frames a condition has held, so one bad frame changes nothing. */
class Debounced {
  private streak = 0
  private state = false

  constructor(private readonly frames: number) {}

  /** Returns the stable value, and whether it just changed. */
  push(value: boolean): { value: boolean; changed: boolean } {
    if (value === this.state) {
      this.streak = 0
      return { value: this.state, changed: false }
    }
    this.streak += 1
    if (this.streak < this.frames) return { value: this.state, changed: false }
    this.streak = 0
    this.state = value
    return { value: this.state, changed: true }
  }

  get current(): boolean {
    return this.state
  }
}

/**
 * Turns a stream of hand frames into drawing events.
 *
 * Deliberately a plain object with a `push` method rather than anything reactive: the
 * whole point is that it is pure enough to feed recorded frames through in a test and get
 * the same events a real camera would produce.
 */
export class GestureReader {
  private readonly pinch: Debounced
  private readonly palm: Debounced
  private readonly fist: Debounced
  private readonly pointing: Debounced
  private pointingSince?: number
  private paletteFired = false
  private twoHandBase?: number
  private drawing = false

  constructor(private readonly config: GestureConfig = DEFAULT_GESTURES) {
    this.pinch = new Debounced(config.debounce)
    this.palm = new Debounced(config.debounce)
    this.fist = new Debounced(config.debounce)
    this.pointing = new Debounced(config.debounce)
  }

  get isDrawing(): boolean {
    return this.drawing
  }

  push(frame: Frame): GestureEvent[] {
    const events: GestureEvent[] = []
    const hands = frame.hands.filter((hand) => hand.score >= this.config.minScore)

    // Losing the hand mid-stroke has to end the stroke, or the next time it reappears the
    // line jumps across the sheet to wherever it came back.
    if (hands.length === 0) {
      this.pinch.push(false)
      this.palm.push(false)
      this.fist.push(false)
      this.pointing.push(false)
      this.pointingSince = undefined
      this.twoHandBase = undefined
      if (this.drawing) {
        this.drawing = false
        events.push({ type: "pen-up" })
      }
      return events
    }

    if (hands.length >= 2) {
      const [first, second] = hands as [Hand, Hand]
      const bothPinching = pinchRatio(first) < this.config.pinchEnter && pinchRatio(second) < this.config.pinchEnter
      if (bothPinching) {
        // A two-hand pinch is a zoom, so any in-progress stroke ends rather than being
        // dragged sideways by the second hand.
        if (this.drawing) {
          this.drawing = false
          events.push({ type: "pen-up" })
        }
        const a = pinchPoint(first)
        const b = pinchPoint(second)
        const spread = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (this.twoHandBase === undefined) this.twoHandBase = spread
        const scale = spread / this.twoHandBase
        if (Math.abs(scale - 1) > this.config.zoomDeadZone) {
          events.push({ type: "zoom", scale, centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] })
          this.twoHandBase = spread
        }
        return events
      }
      this.twoHandBase = undefined
    } else {
      this.twoHandBase = undefined
    }

    const hand = hands[0]!
    const ratio = pinchRatio(hand)

    // Hysteresis: it takes `pinchEnter` to close and the looser `pinchExit` to open.
    const wantPinch = this.pinch.current ? ratio < this.config.pinchExit : ratio < this.config.pinchEnter
    const pinch = this.pinch.push(wantPinch)

    const palm = this.palm.push(isOpenPalm(hand))
    if (palm.changed && palm.value) {
      if (this.drawing) {
        this.drawing = false
        events.push({ type: "pen-up" })
      }
      events.push({ type: "cancel" })
      return events
    }

    const fist = this.fist.push(isFist(hand))
    if (fist.changed && fist.value) {
      if (this.drawing) {
        this.drawing = false
        events.push({ type: "pen-up" })
      }
      events.push({ type: "undo" })
      return events
    }

    if (pinch.value) {
      const at = pinchPoint(hand)
      if (!this.drawing) {
        this.drawing = true
        events.push({ type: "pen-down", at })
      } else {
        events.push({ type: "pen-move", at })
      }
      this.pointingSince = undefined
      this.paletteFired = false
      return events
    }

    if (this.drawing) {
      this.drawing = false
      events.push({ type: "pen-up" })
    }

    const pointing = this.pointing.push(isPointing(hand))
    if (pointing.value) {
      this.pointingSince ??= frame.t
      if (!this.paletteFired && frame.t - this.pointingSince >= this.config.pointHoldMs) {
        this.paletteFired = true
        const tip = hand.landmarks[INDEX_TIP]!
        events.push({ type: "palette", at: [tip.x, tip.y] })
      }
    } else {
      this.pointingSince = undefined
      this.paletteFired = false
    }

    return events
  }
}
