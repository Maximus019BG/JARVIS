/** Bytes in a canonical RIFF/WAVE header, before any sample data. */
export const WAV_HEADER_BYTES = 44

/**
 * A 16-bit little-endian mono wav around raw PCM.
 *
 * Two callers want this for different reasons — the earcons synthesize tones, and dictation
 * keeps the captured audio so a failed streaming transcription can still be salvaged as one
 * file — and a wav header written twice is a wav header wrong once.
 */
export function encodeWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + pcm.length)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, "RIFF")
  view.setUint32(4, 36 + pcm.length, true)
  ascii(8, "WAVEfmt ")
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // format: uncompressed PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, "data")
  view.setUint32(40, pcm.length, true)
  bytes.set(pcm, WAV_HEADER_BYTES)
  return bytes
}

/** Float samples in `[-1, 1]` as the little-endian 16-bit PCM `encodeWav` wants. */
export function floatToPcm(samples: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling: a value over 1 would wrap around into a loud crunch rather than
    // clipping, which is the difference between "too loud" and "broken".
    view.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true)
  }
  return bytes
}
