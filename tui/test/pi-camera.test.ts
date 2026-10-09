import { describe, expect, test } from "bun:test"
import { cameraCommands, noCameraTool } from "../src/pi/camera.ts"
import { parseDshowCameras } from "../src/pi/vision-worker.ts"

const camera = { width: 480, height: 360, fps: 30 }
const tools = (...bins: string[]) => (bin: string) => bins.includes(bin)

describe("camera commands", () => {
  test("a Pi tries its camera module first and falls back to a USB webcam", () => {
    const commands = cameraCommands(camera, { platform: "linux", has: tools("rpicam-vid"), ffmpeg: "/x/ffmpeg" })
    expect(commands.map((command) => command[0])).toEqual(["rpicam-vid", "/x/ffmpeg"])
    expect(commands[0]).toContain("mjpeg")
    expect(commands[1]!.join(" ")).toContain("-f v4l2")
  })

  test("macOS uses AVFoundation and never rpicam", () => {
    const commands = cameraCommands(camera, { platform: "darwin", has: tools("rpicam-vid"), ffmpeg: "ffmpeg" })
    expect(commands).toHaveLength(1)
    expect(commands[0]!.join(" ")).toContain("-f avfoundation")
  })

  test("Windows addresses DirectShow cameras by name", () => {
    const [command] = cameraCommands(camera, { platform: "win32", ffmpeg: "ffmpeg.exe", windowsCamera: () => "Integrated Camera" })
    expect(command).toContain("video=Integrated Camera")
  })

  test("an override wins, and nothing installed says how to fix it", () => {
    expect(cameraCommands(camera, { override: " my-cam --mjpeg - ", has: tools() })).toEqual([["my-cam", "--mjpeg", "-"]])
    expect(cameraCommands(camera, { platform: "win32", has: tools(), ffmpeg: undefined })).toEqual([])
    expect(noCameraTool("win32")).toContain("winget install")
  })
})

describe("DirectShow device listing", () => {
  test("reads ffmpeg 5+ tagged lines, video only", () => {
    const listing = [
      '[dshow @ 0000020] "Integrated Camera" (video)',
      '[dshow @ 0000020]   Alternative name "@device_pnp_\\\\?\\usb#vid_0bda"',
      '[dshow @ 0000020] "Microphone Array" (audio)',
    ].join("\n")
    expect(parseDshowCameras(listing)).toEqual(["Integrated Camera"])
  })

  test("reads the older sectioned format", () => {
    const listing = [
      "[dshow @ 01] DirectShow video devices (some may be both video and audio devices)",
      '[dshow @ 01]  "USB2.0 HD UVC WebCam"',
      '[dshow @ 01]     Alternative name "@device_pnp_x"',
      "[dshow @ 01] DirectShow audio devices",
      '[dshow @ 01]  "Microphone"',
    ].join("\n")
    expect(parseDshowCameras(listing)).toEqual(["USB2.0 HD UVC WebCam"])
  })
})
