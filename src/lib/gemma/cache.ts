import { GEMMA_MODEL_ID } from './constants'
import { clearOpfsEntries, isOpfsSupported, listOpfsEntries } from './opfsCache'

/**
 * Cache Storage names Transformers.js uses by default. We store models in OPFS instead (opfsCache.ts), but older
 * builds/sessions may have left small entries here, so they're still counted and cleared.
 */
export const TRANSFORMERS_CACHE = 'transformers-cache'
export const TRANSFORMERS_CACHES = [TRANSFORMERS_CACHE, 'experimental_transformers-hash-cache']

export interface GemmaCacheInfo {
  /** Everything stored for Gemma (model files + ONNX runtime wasm). */
  bytes: number
  /** Only files belonging to the Gemma repo. */
  modelBytes: number
  files: number
}

const EMPTY: GemmaCacheInfo = { bytes: 0, modelBytes: 0, files: 0 }
const isGemmaUrl = (url: string) => url.includes(`/${GEMMA_MODEL_ID}/resolve/`)

async function entrySize(res: Response): Promise<number> {
  const header = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(header) && header > 0) return header
  // Cache API blobs are disk-backed, so reading .size doesn't load the file into memory.
  return (await res.blob()).size
}

async function legacyCacheInfo(): Promise<GemmaCacheInfo> {
  if (typeof caches === 'undefined') return EMPTY
  if (!(await caches.has(TRANSFORMERS_CACHE).catch(() => false))) return EMPTY
  const cache = await caches.open(TRANSFORMERS_CACHE)
  const info = { ...EMPTY }
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    if (!res) continue
    const size = await entrySize(res)
    info.bytes += size
    info.files++
    if (isGemmaUrl(req.url)) info.modelBytes += size
  }
  return info
}

async function opfsInfo(): Promise<GemmaCacheInfo> {
  if (!isOpfsSupported()) return EMPTY
  const info = { ...EMPTY }
  for (const e of await listOpfsEntries()) {
    info.bytes += e.size
    info.files++
    if (isGemmaUrl(e.url)) info.modelBytes += e.size
  }
  return info
}

/** Sizes of what is stored for Gemma (OPFS + any legacy Cache Storage entries). */
export async function getGemmaCacheInfo(): Promise<GemmaCacheInfo> {
  const [a, b] = await Promise.all([opfsInfo().catch(() => EMPTY), legacyCacheInfo().catch(() => EMPTY)])
  return { bytes: a.bytes + b.bytes, modelBytes: a.modelBytes + b.modelBytes, files: a.files + b.files }
}

export async function clearGemmaCache(): Promise<void> {
  await clearOpfsEntries()
  if (typeof caches === 'undefined') return
  await Promise.all(TRANSFORMERS_CACHES.map((name) => caches.delete(name)))
}
