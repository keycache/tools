/**
 * Cactus engine + model files served from `public/models/cactus/`.
 *
 * Files are fetched only on demand, stored in Cache Storage, and read back from
 * there first on every later load. Bump ASSET_VERSION whenever any file in
 * `public/models/cactus/` changes: it is part of the cache name and the URL
 * query, so stale copies (browser HTTP cache and Cache Storage) are dropped.
 */
export const ASSET_VERSION = '2026-11-11'
export const CACHE_PREFIX = 'cactus-models-'
export const CACHE_NAME = `${CACHE_PREFIX}${ASSET_VERSION}`

export type ModelId = 'needle' | 'whistle' | 'mirage'
export type AssetId = 'engine-js' | 'engine-wasm' | ModelId

export interface AssetInfo {
  id: AssetId
  file: string
  /** Exact byte size; used for progress when the server sends no Content-Length (e.g. gzip). */
  bytes: number
}

export const ASSETS: Record<AssetId, AssetInfo> = {
  'engine-js': { id: 'engine-js', file: 'cactus.js', bytes: 62_247 },
  'engine-wasm': { id: 'engine-wasm', file: 'cactus.wasm', bytes: 1_241_811 },
  needle: { id: 'needle', file: 'needle3.cact', bytes: 35_335_380 },
  whistle: { id: 'whistle', file: 'whistle.cact', bytes: 16_919_407 },
  mirage: { id: 'mirage', file: 'mirage.cact', bytes: 21_611_043 },
}

export const ENGINE_ASSETS: AssetId[] = ['engine-js', 'engine-wasm']

export function assetUrl(id: AssetId, base: string = import.meta.env.BASE_URL): string {
  const root = base.endsWith('/') ? base : `${base}/`
  return new URL(`${root}models/cactus/${ASSETS[id].file}?v=${ASSET_VERSION}`, self.location.href).href
}

export interface Progress {
  loaded: number
  total: number
  fromCache: boolean
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(CACHE_NAME)
  } catch {
    // Cache Storage can be blocked (insecure origin, private mode, storage policy).
    return null
  }
}

/** Removes caches written by older ASSET_VERSIONs. */
export async function pruneOldCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)))
}

async function readWithProgress(res: Response, expected: number, onProgress: (loaded: number) => void) {
  const header = Number(res.headers.get('Content-Length'))
  const size = Math.max(expected, Number.isFinite(header) ? header : 0)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onProgress(buf.byteLength)
    return buf
  }
  let out = new Uint8Array(size)
  let loaded = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (loaded + value.byteLength > out.byteLength) {
      const grown = new Uint8Array(Math.max(out.byteLength * 2, loaded + value.byteLength))
      grown.set(out.subarray(0, loaded))
      out = grown
    }
    out.set(value, loaded)
    loaded += value.byteLength
    onProgress(loaded)
  }
  return loaded === out.byteLength ? out : out.slice(0, loaded)
}

/**
 * Returns the bytes for an asset: Cache Storage first, otherwise the site
 * (and then stores the response for next time).
 */
export async function loadAsset(id: AssetId, onProgress?: (p: Progress) => void): Promise<Uint8Array> {
  const info = ASSETS[id]
  const url = assetUrl(id)
  const cache = await openCache()

  const hit = await cache?.match(url)
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer())
    if (bytes.byteLength === info.bytes) {
      onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, fromCache: true })
      return bytes
    }
    // Truncated or mismatched entry: drop it and fall through to the network.
    await cache?.delete(url)
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${info.file} (HTTP ${res.status})`)
  const bytes = await readWithProgress(res, info.bytes, (loaded) =>
    onProgress?.({ loaded, total: Math.max(info.bytes, loaded), fromCache: false }),
  )

  if (cache) {
    try {
      const type = id === 'engine-js' ? 'text/javascript' : id === 'engine-wasm' ? 'application/wasm' : 'application/octet-stream'
      await cache.put(url, new Response(bytes.slice(), { headers: { 'Content-Type': type, 'Content-Length': String(bytes.byteLength) } }))
    } catch (err) {
      // Quota exceeded etc. – the model still works for this session.
      console.warn(`Could not cache ${info.file}:`, err)
    }
  }
  return bytes
}

/** Which assets are currently stored in Cache Storage. Read-only: never creates the cache. */
export async function getCachedAssets(): Promise<Set<AssetId>> {
  const found = new Set<AssetId>()
  if (typeof caches === 'undefined' || !(await caches.has(CACHE_NAME).catch(() => false))) return found
  const cache = await openCache()
  if (!cache) return found
  await Promise.all(
    (Object.keys(ASSETS) as AssetId[]).map(async (id) => {
      if (await cache.match(assetUrl(id))) found.add(id)
    }),
  )
  return found
}

export async function clearAssetCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)))
}

export function isCacheSupported(): boolean {
  return typeof caches !== 'undefined'
}
