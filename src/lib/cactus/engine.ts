/**
 * Thin typed wrapper over the Emscripten-compiled Cactus C ABI (see
 * public/models/cactus/cactus.h). Works on any module produced by
 * `createCactus()`, in a Web Worker or in Node (tests).
 */

export const CACTUS_TEXT = 1
export const CACTUS_SPEECH = 2
export const CACTUS_VISION = 4

export interface CactusModule {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
  _cactus_load(ptr: number, size: bigint): number
  _cactus_models(): number
  _cactus_last_error(): number
  _cactus_init(system: number, tools: number, toolIndexPath: number): number
  _cactus_complete(input: number, pcm: number, samples: number, maxNewTokens: number, out: number, cap: number): number
  _cactus_set_audio(language: number, keywords: number, wordTimestamps: number): void
  _cactus_reset(): void
  _cactus_transcribe(
    pcm: number,
    samples: number,
    language: number,
    keywords: number,
    wordTimestamps: number,
    out: number,
    cap: number,
  ): number
  _cactus_describe(
    rgb: number,
    width: number,
    height: number,
    options: number,
    language: number,
    keywords: number,
    out: number,
    cap: number,
  ): number
}

export interface ToolSchema {
  name: string
  description?: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  triggers?: string[]
}

export interface FunctionCall {
  name: string
  arguments: Record<string, unknown>
}

export interface CompleteResult {
  type?: string
  success?: boolean
  error?: string | null
  function_calls: FunctionCall[]
  suppressed_calls?: FunctionCall[]
  reasoning?: string
  confidence?: number | null
  prefill_tps?: number
  decode_tps?: number
  audio_text?: string
  audio_language?: string
  [key: string]: unknown
}

export interface Word {
  word: string
  start: number
  end: number
  probability: number
}

export interface TranscribeResult {
  text: string
  language: string
  words?: Word[]
  ttft_ms?: number
  decode_tps?: number
}

export interface AudioOptions {
  language?: string | null
  /** Phrases to bias decoding towards (names, jargon). */
  keywords?: string[]
  wordTimestamps?: boolean
}

export interface CompleteRequest {
  system?: string
  tools: ToolSchema[]
  text?: string
  /** 16 kHz mono PCM; when set, Whistle transcribes it and Needle answers the transcript. */
  pcm?: Float32Array
  audio?: AudioOptions
  maxNewTokens?: number
}

export type DescribeResult = Record<string, unknown>

const OUT_CAPACITY = 8 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class CactusEngine {
  private out = 0
  private readonly m: CactusModule

  constructor(module: CactusModule) {
    this.m = module
  }

  /** Bitmask of loaded model kinds (CACTUS_TEXT | CACTUS_SPEECH | CACTUS_VISION). */
  models(): number {
    return this.m._cactus_models()
  }

  /** Loads a `.cact` archive. The engine copies what it needs, so the input buffer can be dropped afterwards. */
  load(bytes: Uint8Array): number {
    this.withBytes(bytes, (ptr) => this.check(this.m._cactus_load(ptr, BigInt(bytes.byteLength)), 'cactus_load'))
    return this.models()
  }

  /**
   * One stateless Needle turn: tool calls / extraction from text, or from speech
   * when `pcm` is given (requires Whistle to be loaded too).
   */
  complete(req: CompleteRequest): CompleteResult {
    const { m } = this
    const strings = this.strings([req.system ?? '', JSON.stringify(req.tools), req.text ?? null, req.audio?.language ?? null, joinKeywords(req.audio?.keywords)])
    try {
      const [system, tools, text, language, keywords] = strings.ptrs
      this.check(m._cactus_init(system, tools, 0), 'cactus_init')
      m._cactus_reset()
      const max = req.maxNewTokens ?? 512
      let rc: number
      if (req.pcm) {
        m._cactus_set_audio(language, keywords, req.audio?.wordTimestamps ? 1 : 0)
        rc = this.withPcm(req.pcm, (pcm) => m._cactus_complete(0, pcm, req.pcm!.length, max, this.buffer(), OUT_CAPACITY))
      } else {
        rc = m._cactus_complete(text, 0, 0, max, this.buffer(), OUT_CAPACITY)
      }
      this.check(rc, 'cactus_complete', true)
      return this.readJson<CompleteResult>()
    } finally {
      strings.free()
    }
  }

  transcribe(pcm: Float32Array, opts: AudioOptions = {}): TranscribeResult {
    const strings = this.strings([opts.language ?? null, joinKeywords(opts.keywords)])
    try {
      const [language, keywords] = strings.ptrs
      const rc = this.withPcm(pcm, (ptr) =>
        this.m._cactus_transcribe(ptr, pcm.length, language, keywords, opts.wordTimestamps ? 1 : 0, this.buffer(), OUT_CAPACITY),
      )
      this.check(rc, 'cactus_transcribe')
      return this.readJson<TranscribeResult>()
    } finally {
      strings.free()
    }
  }

  /** Mirage: `rgb` is packed 8-bit RGB, `width * height * 3` bytes. */
  describe(rgb: Uint8Array, width: number, height: number, options: Record<string, unknown> = {}, language?: string | null): DescribeResult {
    if (rgb.byteLength !== width * height * 3) throw new Error('RGB data length must be width * height * 3')
    const strings = this.strings([JSON.stringify(options), language ?? null])
    try {
      const [opts, lang] = strings.ptrs
      const rc = this.withBytes(rgb, (ptr) => this.m._cactus_describe(ptr, width, height, opts, lang, 0, this.buffer(), OUT_CAPACITY))
      this.check(rc, 'cactus_describe')
      return this.readJson<DescribeResult>()
    } finally {
      strings.free()
    }
  }

  private buffer(): number {
    if (!this.out) this.out = this.m._malloc(OUT_CAPACITY)
    return this.out
  }

  private check(rc: number, fn: string, bufferHasDetail = false) {
    if (rc >= 0) return
    const detail = this.readCString(this.m._cactus_last_error()) || (bufferHasDetail && this.out ? this.readCString(this.out) : '')
    throw new Error(detail || `${fn} failed (code ${rc})`)
  }

  private readJson<T>(): T {
    const raw = this.readCString(this.out)
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error(`Engine returned invalid JSON: ${raw.slice(0, 200)}`)
    }
  }

  private readCString(ptr: number): string {
    if (!ptr) return ''
    const heap = this.m.HEAPU8
    let end = ptr
    while (heap[end] !== 0) end++
    return decoder.decode(heap.subarray(ptr, end))
  }

  /** Allocates NUL-terminated UTF-8 strings; `null` maps to a NULL pointer. */
  private strings(values: (string | null)[]) {
    const ptrs = values.map((v) => {
      if (v == null) return 0
      const bytes = encoder.encode(v)
      const ptr = this.m._malloc(bytes.byteLength + 1)
      // Read HEAPU8 after malloc: memory growth replaces the underlying buffer.
      this.m.HEAPU8.set(bytes, ptr)
      this.m.HEAPU8[ptr + bytes.byteLength] = 0
      return ptr
    })
    return { ptrs, free: () => ptrs.forEach((p) => p && this.m._free(p)) }
  }

  private withBytes<T>(bytes: Uint8Array, fn: (ptr: number) => T): T {
    const ptr = this.m._malloc(Math.max(1, bytes.byteLength))
    try {
      this.m.HEAPU8.set(bytes, ptr)
      return fn(ptr)
    } finally {
      this.m._free(ptr)
    }
  }

  private withPcm<T>(pcm: Float32Array, fn: (ptr: number) => T): T {
    return this.withBytes(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), fn)
  }
}

function joinKeywords(keywords?: string[]): string | null {
  const list = (keywords ?? []).map((k) => k.trim()).filter(Boolean)
  return list.length ? list.join('\n') : null
}

/** Mirrors the Python SDK: Needle resolves relative dates ("tomorrow") against a `date:` fact. */
export function withDateFact(system: string, now: Date = new Date()): string {
  if (/(?<![A-Za-z])date:/.test(system)) return system
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = now.toLocaleDateString('en-US', { weekday: 'short' })
  const fact = `date: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${day} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  if (!system.trim()) return fact
  if (system.trimStart().startsWith('{')) return system
  return `${fact}; ${system}`
}
