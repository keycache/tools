import { GEMMA_MODEL_ID } from './constants'

/** Cache Storage names used by Transformers.js 4.x (`env.cacheKey` and its experimental hash cache). */
export const TRANSFORMERS_CACHE = 'transformers-cache'
export const TRANSFORMERS_CACHES = [TRANSFORMERS_CACHE, 'experimental_transformers-hash-cache']

export interface GemmaCacheInfo {
  /** Everything Transformers.js has cached (model files + ONNX runtime wasm). */
  bytes: number
  /** Only files belonging to the Gemma repo. */
  modelBytes: number
  files: number
}

const EMPTY: GemmaCacheInfo = { bytes: 0, modelBytes: 0, files: 0 }

async function entrySize(res: Response): Promise<number> {
  const header = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(header) && header > 0) return header
  // Cache API blobs are disk-backed, so reading .size doesn't load the file into memory.
  return (await res.blob()).size
}

/** Sizes of what Transformers.js has stored. Read-only: never creates a cache. */
export async function getGemmaCacheInfo(): Promise<GemmaCacheInfo> {
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
    if (req.url.includes(`/${GEMMA_MODEL_ID}/resolve/`)) info.modelBytes += size
  }
  return info
}

export async function clearGemmaCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  await Promise.all(TRANSFORMERS_CACHES.map((name) => caches.delete(name)))
}
