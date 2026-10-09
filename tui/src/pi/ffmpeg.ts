import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { dataDir } from "../config/paths.ts"

/**
 * A static ffmpeg for machines without one, fetched once into the data dir: the camera needs
 * it on macOS and Windows, and on a Pi for a USB webcam (a camera module uses rpicam-vid).
 * Fetched rather than bundled because `install.sh` compiles a single binary and there is no
 * node_modules beside it at runtime.
 *
 * ffmpeg-static's builds (GPL: osxexperts for macOS, johnvansickle for Linux, gyan.dev for
 * Windows), pinned to one release and checked against the sha256 GitHub publishes for each
 * asset, so a replaced asset fails closed instead of running.
 */
const RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"
const ASSETS: Record<string, { sha256: string; mb: number }> = {
  "darwin-arm64": { sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa", mb: 19 },
  "darwin-x64": { sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106", mb: 25 },
  "linux-arm64": { sha256: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0", mb: 26 },
  "linux-arm": { sha256: "64b115a12f0ab77c277e3c418aae8b40ef881e75e746a0e2d066a206b9bc5172", mb: 19 },
  "linux-x64": { sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa", mb: 29 },
  "win32-x64": { sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77", mb: 30 },
}

/** Two minutes: 30 MB on a slow link, short of hanging forever on a dead one. */
const DOWNLOAD_MS = 120_000

export const bundledFfmpeg = join(dataDir, "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")

/** The ffmpeg to run: the user's own on PATH first, then the one fetched here. */
export function ffmpegBinary(): string | undefined {
  return Bun.which("ffmpeg") ?? (existsSync(bundledFfmpeg) ? bundledFfmpeg : undefined)
}

/** The prebuilt for this machine, or undefined where there is none (FreeBSD, 32-bit Windows). */
export function ffmpegAsset(key = `${process.platform}-${process.arch}`) {
  const asset = ASSETS[key]
  return asset ? { key, ...asset } : undefined
}

let fetching: Promise<string> | undefined

/** Downloads, verifies and unpacks this machine's ffmpeg. Concurrent callers share one download. */
export function fetchFfmpeg(): Promise<string> {
  fetching ??= (async () => {
    const asset = ffmpegAsset()
    if (!asset) throw new Error(`there is no prebuilt ffmpeg for ${process.platform}-${process.arch}`)
    // A stalled download must end in an error the user sees, not a camera that never starts.
    const response = await fetch(`${RELEASE}/ffmpeg-${asset.key}.gz`, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
    if (!response.ok) throw new Error(`the ffmpeg download failed: ${response.status}`)
    const gz = new Uint8Array(await response.arrayBuffer())
    if (new Bun.CryptoHasher("sha256").update(gz).digest("hex") !== asset.sha256) {
      throw new Error("the downloaded ffmpeg does not match its published checksum, so it was not installed")
    }
    mkdirSync(dirname(bundledFfmpeg), { recursive: true })
    // Unpacked to a side file and renamed, so an interrupted fetch never leaves half a binary
    // that ffmpegBinary() would then hand out.
    const partial = `${bundledFfmpeg}.part`
    // gunzipSync, not a DecompressionStream: Bun 1.3's Bun.write never settles on a piped
    // decompression stream, and this is ~100ms for the whole binary anyway.
    await Bun.write(partial, Bun.gunzipSync(gz))
    chmodSync(partial, 0o755)
    renameSync(partial, bundledFfmpeg)
    return bundledFfmpeg
  })().finally(() => {
    fetching = undefined
  })
  return fetching
}
