import { expect, test } from "bun:test"
import { GestureCommands, type Frame } from "../src/pi/gestures.ts"

const config = { map: { thumbs_up: "approve", palm: "interrupt", swipe_up: "scrollHalfDown" }, minScore: 0.8, holdMs: 400, cooldownMs: 800 }
const pose = (t: number, name: string, score = 0.95): Frame => ({ t, hands: [{ score: 1, landmarks: [], gesture: { name, score } }] })
const swipe = (t: number, name = "swipe_up"): Frame => ({ ...pose(t, "palm"), motion: { name, score: 0.95 } })
const run = (reader: GestureCommands, frames: Frame[]) => frames.flatMap((frame) => reader.push(frame).map((c) => `${frame.t}:${c.action}`))

test("a pose fires once per hold, survives an unsure frame, and re-arms on a change", () => {
  const reader = new GestureCommands(config)
  const fired = run(reader, [
    pose(0, "thumbs_up"),
    pose(200, "thumbs_up", 0.5), // unsure: neither breaks nor fires
    pose(399, "thumbs_up"),
    pose(400, "thumbs_up"),
    pose(900, "thumbs_up"), // still held: no repeat
    pose(1000, "none"),
    pose(1100, "thumbs_up"),
    pose(1500, "thumbs_up"),
  ])
  expect(fired).toEqual(["400:approve", "1500:approve"])
})

test("the hand leaving breaks a hold before it completes", () => {
  const reader = new GestureCommands(config)
  expect(run(reader, [pose(0, "palm"), { t: 300, hands: [] }, pose(350, "palm"), pose(700, "palm")])).toEqual([])
})

test("a motion fires once per run and cooldown, and the palm that swiped is not a stop", () => {
  const reader = new GestureCommands(config)
  const fired = run(reader, [
    swipe(0),
    swipe(100), // same run
    pose(200, "palm"),
    swipe(300), // new run, but inside the cooldown
    pose(500, "palm"),
    pose(1000, "palm"), // quiet ended at 800: the hold starts here
    pose(1399, "palm"),
    pose(1400, "palm"),
    swipe(1600),
  ])
  expect(fired).toEqual(["0:scrollHalfDown", "1400:interrupt", "1600:scrollHalfDown"])
})
