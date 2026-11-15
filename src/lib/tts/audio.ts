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
