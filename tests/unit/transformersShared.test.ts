// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OpfsModelCache, keyName, listOpfsEntries, removeOpfsEntries, type DirLike } from '@/lib/transformers/opfsCache'
import { pinRevision } from '@/lib/transformers/revision'
import { ORT_RUNTIME_BYTES, ORT_WEB_VERSION, isOrtRuntimeUrl } from '@/lib/transformers/constants'
import { GEMMA_REVISION, isGemmaFileFor, pinGemmaRevision } from '@/lib/gemma/constants'
import { readyBytesFor } from '@/lib/gemma/cache'
import { detectCapability, type GpuLike } from '@/lib/gemma/capability'
import { gemmaTotalBytes } from '@/lib/gemma/constants'

/** Minimal in-memory OPFS directory (createWritable path only). */
function memoryDir() {
  const files = new Map<string, Uint8Array[]>()
  const dir: DirLike = {
    getFileHandle: async (name, opts) => {
      if (!files.has(name) && !opts?.create) throw new DOMException('missing', 'NotFoundError')
      return {
        getFile: async () => new File((files.get(name) ?? []) as BlobPart[], name),
        createWritable: async () => {
          const parts: Uint8Array[] = []
          files.set(name, parts)
          return new WritableStream<Uint8Array>({ write: (c) => void parts.push(c.slice()) }) as never
        },
      }
    },
    removeEntry: async (name) => {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError')
    },
    async *values() {
      for (const name of files.keys()) yield { kind: 'file', name }
    },
  }
  return { dir, files }
}

const TTS_ID = 'onnx-community/chatterbox-ONNX'
const TTS_REV = '3cab09af388d3f02bba43443fce88c1f4525ac43'
const hf = (id: string, rev: string, file: string) => `https://huggingface.co/${id}/resolve/${rev}/${file}`

describe('shared OPFS cache', () => {
  it('keeps two model directories separate', async () => {
    const gemma = memoryDir()
    const tts = memoryDir()
    const a = new OpfsModelCache(async () => gemma.dir)
    const b = new OpfsModelCache(async () => tts.dir, pinRevision(TTS_ID, TTS_REV))
    await a.put('https://x/gemma.bin', new Response(new Uint8Array(3)))
    await b.put(hf(TTS_ID, 'main', 'tokenizer_config.json'), new Response(new Uint8Array(5)))

    expect((await listOpfsEntries(async () => gemma.dir)).map((e) => e.url)).toEqual(['https://x/gemma.bin'])
    expect((await listOpfsEntries(async () => tts.dir)).map((e) => [e.url, e.size])).toEqual([[hf(TTS_ID, TTS_REV, 'tokenizer_config.json'), 5]])
    expect(await a.match(hf(TTS_ID, TTS_REV, 'tokenizer_config.json'))).toBeUndefined()
    // resolve/main lookups hit the pinned entry
    expect(await (await b.match(hf(TTS_ID, 'main', 'tokenizer_config.json')))?.arrayBuffer()).toHaveProperty('byteLength', 5)
  })

  it('removes only matching entries (both files)', async () => {
    const { dir, files } = memoryDir()
    const cache = new OpfsModelCache(async () => dir)
    await cache.put('https://site/tools/assets/ort-wasm-simd-threaded.asyncify-OLD.wasm', new Response(new Uint8Array(7)))
    await cache.put('https://huggingface.co/m/resolve/r/model.onnx', new Response(new Uint8Array(2)))

    const removed = await removeOpfsEntries(async () => dir, (e) => isOrtRuntimeUrl(e.url))
    expect(removed.map((e) => e.size)).toEqual([7])
    const old = await keyName('https://site/tools/assets/ort-wasm-simd-threaded.asyncify-OLD.wasm')
    expect([...files.keys()].some((n) => n.startsWith(old))).toBe(false)
    expect((await listOpfsEntries(async () => dir)).map((e) => e.size)).toEqual([2])
  })
})

describe('pinRevision', () => {
  it('pins only its own model', () => {
    const pin = pinRevision(TTS_ID, TTS_REV)
    expect(pin(hf(TTS_ID, 'main', 'config.json'))).toBe(hf(TTS_ID, TTS_REV, 'config.json'))
    expect(pin(hf('onnx-community/gemma-4-E2B-it-ONNX', 'main', 'config.json'))).toBe(hf('onnx-community/gemma-4-E2B-it-ONNX', 'main', 'config.json'))
    expect(pinGemmaRevision(hf('onnx-community/gemma-4-E2B-it-ONNX', 'main', 'x.json'))).toBe(hf('onnx-community/gemma-4-E2B-it-ONNX', GEMMA_REVISION, 'x.json'))
  })
})

describe('ORT runtime', () => {
  it('matches runtime files of any build', () => {
    expect(isOrtRuntimeUrl('https://site/tools/assets/ort-wasm-simd-threaded.asyncify-AbC123.wasm')).toBe(true)
    expect(isOrtRuntimeUrl('https://site/tools/assets/ort-wasm-simd-threaded.asyncify-AbC123.mjs')).toBe(true)
    expect(isOrtRuntimeUrl('https://huggingface.co/m/resolve/r/onnx/model.onnx')).toBe(false)
  })

  it('pins the installed onnxruntime-web build and its runtime size', () => {
    const pkg = JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')) as { version: string }
    expect(pkg.version).toBe(ORT_WEB_VERSION)
    const size = (f: string) => readFileSync(`node_modules/onnxruntime-web/dist/${f}`).byteLength
    expect(size('ort-wasm-simd-threaded.asyncify.wasm') + size('ort-wasm-simd-threaded.asyncify.mjs')).toBe(ORT_RUNTIME_BYTES)
  })
})

describe('gemma ready bytes', () => {
  const G = 'onnx-community/gemma-4-E2B-it-ONNX'
  const entry = (url: string, size: number) => ({ url, size, contentType: null })

  it('counts only the files the dtype loads, at the pinned revision', () => {
    expect(isGemmaFileFor(hf(G, GEMMA_REVISION, 'onnx/decoder_model_merged_q4f16.onnx_data'), 'q4f16')).toBe(true)
    expect(isGemmaFileFor(hf(G, GEMMA_REVISION, 'onnx/decoder_model_merged_q4f16.onnx_data'), 'q4')).toBe(false)
    expect(isGemmaFileFor(hf(G, GEMMA_REVISION, 'onnx/decoder_model_merged_q4.onnx'), 'q4')).toBe(true)
    expect(isGemmaFileFor(hf(G, GEMMA_REVISION, 'tokenizer.json'), 'q4')).toBe(true)
    expect(isGemmaFileFor(hf(G, 'oldrev', 'tokenizer.json'), 'q4')).toBe(false)

    const entries = [
      entry(hf(G, GEMMA_REVISION, 'config.json'), 10),
      entry(hf(G, GEMMA_REVISION, 'onnx/embed_tokens_q4f16.onnx_data'), 100),
      entry(hf(G, GEMMA_REVISION, 'onnx/embed_tokens_q4.onnx_data'), 1000),
      entry('http://localhost:3000/tools/assets/ort-wasm-simd-threaded.asyncify-OLD.wasm', 5000),
    ]
    expect(readyBytesFor(entries, 'q4f16')).toBe(110)
    expect(readyBytesFor(entries, 'q4')).toBe(1010)
  })

  it('a stale runtime no longer makes Gemma look stored', async () => {
    const gpu: GpuLike = { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) }
    const total = gemmaTotalBytes('q4f16')
    const everythingButRuntime = total - ORT_RUNTIME_BYTES
    const c = await detectCapability({ gpu, storage: null, cachedBytes: total, readyBytes: { q4f16: everythingButRuntime } })
    expect(c.downloadBytes).toBe(ORT_RUNTIME_BYTES)
  })
})
