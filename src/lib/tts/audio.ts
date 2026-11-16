/** Pure audio helpers for Speak. Workers have no AudioContext, so WAV files are parsed by hand. */

export interface DecodedAudio {
  /** Mono, [-1, 1]. */
  pcm: Float32Array
  sampleRate: number
}

/** Parses a RIFF/WAVE file: PCM 16/24/32-bit integer or 32-bit float, any channel count (mixed to mono). */
export function parseWav(buffer: ArrayBuffer): DecodedAudio {
  const view = new DataView(buffer)
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
  if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.')

  let format = 0, channels = 0, sampleRate = 0, bits = 0
  let data: { offset: number; size: number } | null = null
  for (let offset = 12; offset + 8 <= buffer.byteLength; ) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, buffer.byteLength - body) }
    }
    offset = body + size + (size % 2)
  }
  if (!data || !channels || !sampleRate) throw new Error('WAV file has no audio data.')
  if (!(format === 1 && (bits === 16 || bits === 24 || bits === 32)) && !(format === 3 && bits === 32)) {
    throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit).`)
  }

  const bytes = bits / 8
  const frames = Math.floor(data.size / (bytes * channels))
  const pcm = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const p = data.offset + (i * channels + c) * bytes
      if (format === 3) sum += view.getFloat32(p, true)
      else if (bits === 16) sum += view.getInt16(p, true) / 32768
      else if (bits === 24) sum += (((view.getUint8(p + 2) << 24) | (view.getUint8(p + 1) << 16) | (view.getUint8(p) << 8)) >> 8) / 8388608
      else sum += view.getInt32(p, true) / 2147483648
    }
    pcm[i] = sum / channels
  }
  return { pcm, sampleRate }
}

/** Linear-interpolation resampling (good enough for speech conditioning; not for music). */
export function resample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to || pcm.length === 0) return pcm
  const length = Math.max(1, Math.round((pcm.length * to) / from))
  const out = new Float32Array(length)
  const step = from / to
  for (let i = 0; i < length; i++) {
    const p = i * step
    const l = Math.min(Math.floor(p), pcm.length - 1)
    const r = Math.min(l + 1, pcm.length - 1)
    out[i] = pcm[l] + (pcm[r] - pcm[l]) * (p - l)
  }
  return out
}

/** At most `seconds` of audio (a view, not a copy). */
export function trimTo(pcm: Float32Array, sampleRate: number, seconds: number): Float32Array {
  const max = Math.floor(sampleRate * seconds)
  return pcm.length > max ? pcm.subarray(0, max) : pcm
}

/** −1 dBFS: headroom for 16-bit conversion and lossy re-encoding. */
export const PEAK_CEILING = 10 ** (-1 / 20)

/**
 * Scales the clip down if its peak exceeds `ceiling` (Chatterbox output can exceed ±1 — S0 measured peaks up to
 * 1.19 — which would clip in the WAV). Returns the input unchanged when it's already within range.
 */
export function limitPeak(pcm: Float32Array, ceiling = PEAK_CEILING): Float32Array {
  let peak = 0
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i])
    if (a > peak) peak = a
  }
  if (peak <= ceiling) return pcm
  const gain = ceiling / peak
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain
  return out
}

/** `speech-20261115-142130.wav` (local time). */
export function speechFileName(date = new Date(), ext = 'wav'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `speech-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.${ext}`
}

/** True when the clip has no usable signal (peak below −40 dBFS), e.g. a muted microphone. */
export function isSilent(pcm: Float32Array, threshold = 0.01): boolean {
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) >= threshold) return false
  return true
}

/** Joins clips into one, inserting `pauseBefore` seconds of silence before each (ignored for the first). */
export function joinWithPauses(parts: { pcm: Float32Array; pauseBefore: number }[], sampleRate: number): Float32Array {
  const gaps = parts.map((p, i) => (i === 0 ? 0 : Math.round(p.pauseBefore * sampleRate)))
  const out = new Float32Array(parts.reduce((n, p, i) => n + gaps[i] + p.pcm.length, 0))
  let at = 0
  parts.forEach((p, i) => {
    at += gaps[i]
    out.set(p.pcm, at)
    at += p.pcm.length
  })
  return out
}

/** Float [-1, 1] → 16-bit PCM, quantised exactly like `encodeWav` (half the memory of Float32). */
export function toPcm16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/**
 * 16-bit mono WAV from parts with `pauseBefore` seconds of silence before each (none before the first), as byte views:
 * a 44-byte header, then the parts' own buffers and shared silence — no joined copy of the audio. For Blobs and zips.
 */
export function wavPieces(parts: { pcm16: Int16Array; pauseBefore: number }[], sampleRate: number): Uint8Array<ArrayBuffer>[] {
  const gaps = parts.map((p, i) => (i === 0 ? 0 : Math.round(p.pauseBefore * sampleRate)))
  const samples = parts.reduce((n, p, i) => n + gaps[i] + p.pcm16.length, 0)
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples * 2, true)
  const silence = new Map<number, Uint8Array<ArrayBuffer>>()
  const pieces: Uint8Array<ArrayBuffer>[] = [new Uint8Array(header)]
  parts.forEach((p, i) => {
    if (gaps[i] > 0) {
      if (!silence.has(gaps[i])) silence.set(gaps[i], new Uint8Array(gaps[i] * 2))
      pieces.push(silence.get(gaps[i]) as Uint8Array<ArrayBuffer>)
    }
    pieces.push(new Uint8Array(p.pcm16.buffer as ArrayBuffer, p.pcm16.byteOffset, p.pcm16.byteLength))
  })
  return pieces
}

/** {@link wavPieces} as a WAV Blob (the browser copies the pieces; nothing is joined in JS memory first). */
export function wavFromParts(parts: { pcm16: Int16Array; pauseBefore: number }[], sampleRate: number): Blob {
  return new Blob(wavPieces(parts, sampleRate), { type: 'audio/wav' })
}
