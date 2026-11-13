import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_HEADROOM, detectCapability, type GpuLike } from '@/lib/gemma/capability'
import { GEMMA_SIZES, ORT_RUNTIME_BYTES, gemmaTotalBytes } from '@/lib/gemma/constants'
import { TRANSFORMERS_CACHE, clearGemmaCache, getGemmaCacheInfo } from '@/lib/gemma/cache'
import { ORT_RUNTIME_URLS, configureTransformers } from '@/lib/gemma/runtime'
import { formatBytes } from '@/lib/cactus/media'

const gpu = (features: string[] | null): GpuLike => ({
  requestAdapter: async () => (features ? { features: new Set(features) } : null),
})
const storage = (quota: number, usage: number, persisted = false) => ({
  estimate: async () => ({ quota, usage }),
  persisted: async () => persisted,
})
const GB = 1024 ** 3

describe('detectCapability', () => {
  it('reports unsupported without WebGPU', async () => {
    const c = await detectCapability({ gpu: null, storage: null })
    expect(c).toMatchObject({ webgpu: false, device: null, dtype: null })
    expect(c.unsupported).toMatch(/WebGPU/)
  })

  it('explains the HTTPS requirement on insecure origins', async () => {
    const c = await detectCapability({ gpu: null, storage: null, secureContext: false })
    expect(c.unsupported).toMatch(/HTTPS/)
  })

  it('reports a missing adapter separately from missing WebGPU', async () => {
    const c = await detectCapability({ gpu: gpu(null), storage: null })
    expect(c.unsupported).toMatch(/no suitable GPU adapter/)
  })

  it('treats a throwing requestAdapter as unsupported', async () => {
    const c = await detectCapability({ gpu: { requestAdapter: async () => Promise.reject(new Error('x')) }, storage: null })
    expect(c.webgpu).toBe(false)
  })

  it('picks q4f16 with shader-f16, q4 without', async () => {
    const f16 = await detectCapability({ gpu: gpu(['shader-f16']), storage: null })
    expect(f16).toMatchObject({ webgpu: true, shaderF16: true, device: 'webgpu', dtype: 'q4f16', totalBytes: gemmaTotalBytes('q4f16') })
    const q4 = await detectCapability({ gpu: gpu([]), storage: null })
    expect(q4).toMatchObject({ shaderF16: false, dtype: 'q4', totalBytes: gemmaTotalBytes('q4') })
    expect(f16.unsupported).toBeUndefined()
  })

  it('subtracts already-cached bytes from the download', async () => {
    const c = await detectCapability({ gpu: gpu(['shader-f16']), storage: null, cachedBytes: 1 * GB })
    expect(c.downloadBytes).toBe(gemmaTotalBytes('q4f16') - 1 * GB)
    const done = await detectCapability({ gpu: gpu(['shader-f16']), storage: null, cachedBytes: 99 * GB })
    expect(done.downloadBytes).toBe(0)
  })

  it('blocks the download when storage is too small (with headroom)', async () => {
    const need = gemmaTotalBytes('q4f16')
    const tight = await detectCapability({ gpu: gpu(['shader-f16']), storage: storage(need, 0) })
    expect(tight.blocked).toMatch(/Not enough browser storage/)
    const roomy = await detectCapability({ gpu: gpu(['shader-f16']), storage: storage(Math.ceil(need * STORAGE_HEADROOM) + 1, 0, true) })
    expect(roomy.blocked).toBeUndefined()
    expect(roomy.storage).toMatchObject({ persisted: true })
  })

  it("doesn't block when everything is already cached", async () => {
    const c = await detectCapability({ gpu: gpu(['shader-f16']), storage: storage(1, 1), cachedBytes: 99 * GB })
    expect(c.blocked).toBeUndefined()
  })
})

describe('gemma sizes', () => {
  it('includes the audio encoder by default (Transformers.js loads every session together)', () => {
    expect(gemmaTotalBytes('q4f16') - gemmaTotalBytes('q4f16', { withAudio: false })).toBe(GEMMA_SIZES.q4f16.audio)
    expect(gemmaTotalBytes('q4f16')).toBeGreaterThan(3 * 1000 ** 3)
    expect(gemmaTotalBytes('q4f16')).toBeGreaterThan(ORT_RUNTIME_BYTES)
  })
})

/** In-memory Cache Storage with Request-like keys. */
function fakeCaches(entries: Record<string, { body: Uint8Array; length?: boolean }> | null) {
  const names = new Set(entries ? [TRANSFORMERS_CACHE] : [])
  const store = Object.entries(entries ?? {})
  const api = {
    has: vi.fn(async (n: string) => names.has(n)),
    open: vi.fn(async () => ({
      keys: async () => store.map(([url]) => ({ url })),
      match: async (req: { url: string }) => {
        const hit = store.find(([u]) => u === req.url)?.[1]
        if (!hit) return undefined
        return new Response(hit.body.slice(), { headers: hit.length === false ? {} : { 'Content-Length': String(hit.body.byteLength) } })
      },
    })),
    delete: vi.fn(async (n: string) => names.delete(n)),
  }
  return api
}

describe('gemma cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns zeros without creating a cache', async () => {
    const api = fakeCaches(null)
    vi.stubGlobal('caches', api)
    expect(await getGemmaCacheInfo()).toEqual({ bytes: 0, modelBytes: 0, files: 0 })
    expect(api.open).not.toHaveBeenCalled()
  })

  it('sums all entries and separates Gemma repo files', async () => {
    vi.stubGlobal(
      'caches',
      fakeCaches({
        'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/abc/config.json': { body: new Uint8Array(100) },
        'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/abc/onnx/x.onnx_data': { body: new Uint8Array(400), length: false },
        'http://localhost/tools/assets/ort-wasm-simd-threaded.asyncify-x.wasm': { body: new Uint8Array(50) },
      }),
    )
    expect(await getGemmaCacheInfo()).toEqual({ bytes: 550, modelBytes: 500, files: 3 })
  })

  it('clears both Transformers.js caches', async () => {
    const api = fakeCaches({})
    vi.stubGlobal('caches', api)
    await clearGemmaCache()
    expect(api.delete).toHaveBeenCalledWith('transformers-cache')
    expect(api.delete).toHaveBeenCalledWith('experimental_transformers-hash-cache')
  })
})

describe('transformers runtime config', () => {
  it('points ONNX Runtime at our bundled asyncify files', () => {
    expect(ORT_RUNTIME_URLS.wasm).toMatch(/ort-wasm-simd-threaded\.asyncify[^/]*\.wasm$/)
    expect(ORT_RUNTIME_URLS.mjs).toMatch(/ort-wasm-simd-threaded\.asyncify[^/]*\.mjs$/)
    expect(ORT_RUNTIME_URLS.wasm).not.toMatch(/jsdelivr/)

    const env = { allowLocalModels: true, allowRemoteModels: false, useBrowserCache: true, useCustomCache: false, customCache: null, backends: { onnx: { wasm: {} } } }
    const cache = { match: async () => undefined, put: async () => {} }
    configureTransformers(env as never, cache)
    expect(env).toMatchObject({ allowLocalModels: false, allowRemoteModels: true, useBrowserCache: false, useCustomCache: true })
    expect(env.customCache).toBe(cache)
    expect(env.backends.onnx.wasm).toEqual({ wasmPaths: ORT_RUNTIME_URLS })
  })
})

describe('formatBytes', () => {
  it('scales up to GB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(16_919_407)).toBe('16.1 MB')
    expect(formatBytes(3.25 * GB)).toBe('3.25 GB')
  })
})
