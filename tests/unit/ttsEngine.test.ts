// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { describeCacheFailures } from '@/lib/transformers/errors'
import type { GpuLike } from '@/lib/transformers/capability'
import { ORT_RUNTIME_URLS } from '@/lib/transformers/runtime'
import { parseWav, resample, trimTo } from '@/lib/tts/audio'
import { ttsReadyBytesFor } from '@/lib/tts/cache'
import { detectTtsCapability } from '@/lib/tts/capability'
import { DEFAULT_VOICE_URL, TTS_REVISION, isTtsFileFor, pinTtsRevision, ttsDtypeMap, ttsTotalBytes } from '@/lib/tts/constants'
import { encodeWav } from '@/lib/cactus/media'

const repo = (rev: string, path: string) => `https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/${rev}/${path}`

/** Builds a WAV file: `format` 1 = PCM int, 3 = float; `extensible` wraps it as WAVE_FORMAT_EXTENSIBLE. */
function wav(samples: number[][], { rate = 24000, bits = 16, format = 1, extensible = false } = {}): ArrayBuffer {
  const channels = samples.length
  const frames = samples[0].length
  const bytes = bits / 8
  const fmtSize = extensible ? 40 : 16
  const dataSize = frames * channels * bytes
  const buf = new ArrayBuffer(12 + 8 + fmtSize + 8 + dataSize)
  const v = new DataView(buf)
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, fmtSize, true)
  v.setUint16(20, extensible ? 0xfffe : format, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * channels * bytes, true); v.setUint16(32, channels * bytes, true); v.setUint16(34, bits, true)
  if (extensible) v.setUint16(20 + 24, format, true)
  const data = 20 + fmtSize
  str(data, 'data'); v.setUint32(data + 4, dataSize, true)
  let p = data + 8
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, p += bytes) {
      const x = samples[c][i]
      if (format === 3) v.setFloat32(p, x, true)
      else if (bits === 16) v.setInt16(p, Math.round(x * 32767), true)
      else if (bits === 24) { const n = Math.round(x * 8388607); v.setUint8(p, n & 0xff); v.setUint8(p + 1, (n >> 8) & 0xff); v.setUint8(p + 2, (n >> 16) & 0xff) }
      else if (bits === 32) v.setInt32(p, Math.round(x * 2147483647), true)
      else v.setUint8(p, 128 + Math.round(x * 127))
    }
  }
  return buf
}

describe('tts constants', () => {
  it('totals match the repo at the pinned revision (S0) plus the bundled runtime', () => {
    expect(ttsTotalBytes('q4f16')).toBe(1_530_150_243)
    expect(ttsTotalBytes('q4')).toBe(1_579_032_606)
    expect(ttsTotalBytes('q4f16') - ttsTotalBytes('q4')).toBe(304_966_796 - 353_849_159)
    expect(ORT_RUNTIME_BYTES).toBe(30_004_278)
  })

  it('only the language model is quantised', () => {
    expect(ttsDtypeMap('q4')).toEqual({ embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: 'q4', model: 'q4', conditional_decoder: 'fp32' })
  })

  it('matches exactly the files a dtype loads', () => {
    for (const f of ['config.json', 'tokenizer.json', 'default_voice.wav', 'onnx/embed_tokens.onnx', 'onnx/speech_encoder.onnx_data', 'onnx/conditional_decoder.onnx_data', 'onnx/language_model_q4f16.onnx_data']) {
      expect(isTtsFileFor(repo(TTS_REVISION, f), 'q4f16'), f).toBe(true)
    }
    expect(isTtsFileFor(repo(TTS_REVISION, 'onnx/language_model_q4.onnx_data'), 'q4f16')).toBe(false)
    expect(isTtsFileFor(repo(TTS_REVISION, 'onnx/language_model.onnx_data'), 'q4f16')).toBe(false)
    expect(isTtsFileFor(repo(TTS_REVISION, 'onnx/language_model_fp16.onnx'), 'q4')).toBe(false)
    expect(isTtsFileFor(repo('main', 'config.json'), 'q4')).toBe(false)
    expect(isTtsFileFor(pinTtsRevision(repo('main', 'config.json')), 'q4')).toBe(true)
    expect(DEFAULT_VOICE_URL).toBe(repo(TTS_REVISION, 'default_voice.wav'))
  })

  it('ready bytes ignore other dtypes and stale runtimes, but count the current runtime', () => {
    const e = (url: string, size: number) => ({ url, size, contentType: null })
    const entries = [
      e(repo(TTS_REVISION, 'config.json'), 1),
      e(repo(TTS_REVISION, 'onnx/language_model_q4f16.onnx_data'), 10),
      e(repo(TTS_REVISION, 'onnx/language_model_q4.onnx_data'), 100),
      e(ORT_RUNTIME_URLS.wasm, 1000),
      e('http://localhost/tools/assets/ort-wasm-simd-threaded.asyncify-OLD.wasm', 10000),
    ]
    expect(ttsReadyBytesFor(entries, 'q4f16')).toBe(1011)
    expect(ttsReadyBytesFor(entries, 'q4')).toBe(1101)
  })
})

describe('tts capability', () => {
  const gpu = (features: string[]): GpuLike => ({ requestAdapter: async () => ({ features: new Set(features) }) })

  it('picks the dtype from shader-f16 and uses TTS sizes', async () => {
    expect(await detectTtsCapability({ gpu: gpu(['shader-f16']), storage: null })).toMatchObject({ dtype: 'q4f16', totalBytes: ttsTotalBytes('q4f16'), downloadBytes: ttsTotalBytes('q4f16') })
    expect(await detectTtsCapability({ gpu: gpu([]), storage: null, readyBytes: { q4: ttsTotalBytes('q4') } })).toMatchObject({ dtype: 'q4', downloadBytes: 0 })
  })

  it('names Speak when WebGPU is missing', async () => {
    expect((await detectTtsCapability({ gpu: null, storage: null })).unsupported).toMatch(/^Speak needs WebGPU/)
    expect((await detectTtsCapability({ gpu: null, storage: null, secureContext: false })).unsupported).toMatch(/^Speak needs WebGPU.*HTTPS/)
  })

  it('cache warnings name the model', () => {
    expect(describeCacheFailures([{ error: new Error('io') }], 'Speak')).toMatch(/Speak will download again/)
  })
})

describe('parseWav', () => {
  const ramp = [0, 0.5, -0.5, 0.25]
  it.each([
    ['16-bit PCM', { bits: 16 }, 1e-4],
    ['24-bit PCM', { bits: 24 }, 1e-6],
    ['32-bit PCM', { bits: 32 }, 1e-8],
    ['32-bit float', { bits: 32, format: 3 }, 0],
    ['extensible float', { bits: 32, format: 3, extensible: true }, 0],
  ])('%s', (_, opts, tol) => {
    const { pcm, sampleRate } = parseWav(wav([ramp], opts))
    expect(sampleRate).toBe(24000)
    ramp.forEach((x, i) => expect(Math.abs(pcm[i] - x)).toBeLessThanOrEqual(tol + 1e-7))
  })

  it('mixes channels to mono', () => {
    const { pcm } = parseWav(wav([[1, 0], [0, 0]], { format: 3, bits: 32 }))
    expect([...pcm]).toEqual([0.5, 0])
  })

  it('reads what encodeWav writes', async () => {
    const { pcm, sampleRate } = parseWav(await encodeWav(new Float32Array([0, 0.5, -0.5]), 24000).arrayBuffer())
    expect(sampleRate).toBe(24000)
    expect(pcm[1]).toBeCloseTo(0.5, 3)
  })

  it('rejects non-WAV and unsupported encodings', () => {
    expect(() => parseWav(new ArrayBuffer(16))).toThrow(/Not a WAV/)
    expect(() => parseWav(wav([[0, 0]], { bits: 8 }))).toThrow(/Unsupported/)
  })

  it('parses the real default voice (if downloaded locally)', () => {
    let buf: Buffer
    try {
      buf = readFileSync('.data/models/onnx-community/chatterbox-ONNX/default_voice.wav')
    } catch {
      return
    }
    const { pcm, sampleRate } = parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    expect(sampleRate).toBe(24000)
    expect(pcm.length / sampleRate).toBeCloseTo(7.44, 2)
  })
})

describe('resample / trimTo', () => {
  it('changes the length by the rate ratio and keeps the endpoints', () => {
    const out = resample(new Float32Array([0, 1, 0, -1]), 16000, 24000)
    expect(out.length).toBe(6)
    expect(out[0]).toBe(0)
    expect(resample(new Float32Array([1, 2]), 24000, 24000)).toEqual(new Float32Array([1, 2]))
  })

  it('trims to the limit without copying', () => {
    const pcm = new Float32Array(30)
    expect(trimTo(pcm, 10, 2).length).toBe(20)
    expect(trimTo(pcm, 10, 5)).toBe(pcm)
  })
})
