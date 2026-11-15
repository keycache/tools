import { isCurrentOrtRuntime, pruneStaleOrtRuntime } from '@/lib/transformers/runtime'
import { GEMMA_MODEL_ID, isGemmaFileFor, type GemmaDtype } from './constants'
import { clearOpfsEntries, gemmaDir, isOpfsSupported, listOpfsEntries, type EntryMeta } from './opfsCache'

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

/** Per dtype: bytes of the files a load would actually read from OPFS (see `readyBytesFor`). */
export type GemmaReadyBytes = Record<GemmaDtype, number>

const EMPTY: GemmaCacheInfo = { bytes: 0, modelBytes: 0, files: 0 }
export const EMPTY_READY: GemmaReadyBytes = { q4f16: 0, q4: 0 }
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

/**
 * OPFS entries, after deleting ORT runtime files of an older build: their hashed URLs are never requested again
 * once the site ships a new ONNX Runtime, so they'd only inflate the stored size.
 */
async function opfsEntries(): Promise<EntryMeta[]> {
  if (!isOpfsSupported()) return []
  await pruneStaleOrtRuntime(gemmaDir).catch(() => [])
  return listOpfsEntries()
}

function summarize(entries: EntryMeta[]): GemmaCacheInfo {
  const info = { ...EMPTY }
  for (const e of entries) {
    info.bytes += e.size
    info.files++
    if (isGemmaUrl(e.url)) info.modelBytes += e.size
  }
  return info
}

/**
 * Bytes stored for exactly the files a `dtype` load needs: that dtype's sessions, the configs/tokenizer at the pinned
 * revision and the current ORT runtime. Unlike a sum over everything, other dtypes, older revisions, stale runtimes
 * and legacy Cache Storage entries (never read — loads only use OPFS) don't make a model look "stored".
 */
export function readyBytesFor(entries: EntryMeta[], dtype: GemmaDtype): number {
  return entries.reduce((sum, e) => (isGemmaFileFor(e.url, dtype) || isCurrentOrtRuntime(e.url) ? sum + e.size : sum), 0)
}

export interface GemmaCacheDetails {
  info: GemmaCacheInfo
  ready: GemmaReadyBytes
}

/** Stored sizes (OPFS + legacy Cache Storage) and per-dtype ready bytes, from a single OPFS listing. */
export async function getGemmaCacheDetails(): Promise<GemmaCacheDetails> {
  const [entries, legacy] = await Promise.all([opfsEntries().catch((): EntryMeta[] => []), legacyCacheInfo().catch(() => EMPTY)])
  const opfs = summarize(entries)
  return {
    info: { bytes: opfs.bytes + legacy.bytes, modelBytes: opfs.modelBytes + legacy.modelBytes, files: opfs.files + legacy.files },
    ready: { q4f16: readyBytesFor(entries, 'q4f16'), q4: readyBytesFor(entries, 'q4') },
  }
}

/** Sizes of what is stored for Gemma (OPFS + any legacy Cache Storage entries). */
export async function getGemmaCacheInfo(): Promise<GemmaCacheInfo> {
  return (await getGemmaCacheDetails()).info
}

export async function clearGemmaCache(): Promise<void> {
  await clearOpfsEntries()
  if (typeof caches === 'undefined') return
  await Promise.all(TRANSFORMERS_CACHES.map((name) => caches.delete(name)))
}
