import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSETS, CACHE_NAME, CACHE_PREFIX, assetUrl, clearAssetCache, getCachedAssets, loadAsset, pruneOldCaches } from '@/lib/cactus/assets'
import { boxRect, fitWithin, isAudioFile, mixToMono, polygonPoints, rgbaToRgb } from '@/lib/cactus/media'

/** Minimal in-memory Cache Storage. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, res: Response) => void store.set(url, res),
      delete: async (url: string) => store.delete(url),
    }
  }
  return {
    stores,
    api: {
      open,
      has: async (name: string) => stores.has(name),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
  }
}

function bytesOf(size: number, fill = 7) {
  return new Uint8Array(size).fill(fill)
}

describe('asset cache', () => {
  let cache: ReturnType<typeof fakeCaches>
  const fetchMock = vi.fn()

  beforeEach(() => {
    cache = fakeCaches()
    vi.stubGlobal('caches', cache.api)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('builds versioned URLs under the app base path', () => {
    expect(assetUrl('needle', '/tools/')).toMatch(/\/tools\/models\/cactus\/needle3\.cact\?v=/)
  })

  it('downloads from the site on a miss, then serves from cache', async () => {
    const size = ASSETS['engine-js'].bytes
    fetchMock.mockResolvedValue(new Response(bytesOf(size)))
    const progress: boolean[] = []

    const first = await loadAsset('engine-js', (p) => progress.push(p.fromCache))
    expect(first.byteLength).toBe(size)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progress.every((c) => c === false)).toBe(true)

    const second = await loadAsset('engine-js', (p) => progress.push(p.fromCache))
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progress.at(-1)).toBe(true)
    expect(await getCachedAssets()).toEqual(new Set(['engine-js']))
  })

  it('re-downloads a truncated cache entry', async () => {
    const size = ASSETS['engine-js'].bytes
    const store = await cache.api.open(CACHE_NAME)
    await store.put(assetUrl('engine-js'), new Response(bytesOf(10)))
    fetchMock.mockResolvedValue(new Response(bytesOf(size)))
    expect((await loadAsset('engine-js')).byteLength).toBe(size)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws on HTTP errors and caches nothing', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))
    await expect(loadAsset('engine-js')).rejects.toThrow(/HTTP 404/)
    expect(await getCachedAssets()).toEqual(new Set())
  })

  it('works without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined)
    fetchMock.mockResolvedValue(new Response(bytesOf(ASSETS['engine-js'].bytes)))
    await expect(loadAsset('engine-js')).resolves.toHaveLength(ASSETS['engine-js'].bytes)
    expect(await getCachedAssets()).toEqual(new Set())
  })

  it('prunes old versions and clears everything on request', async () => {
    await cache.api.open(`${CACHE_PREFIX}old`)
    await cache.api.open(CACHE_NAME)
    await cache.api.open('unrelated')
    await pruneOldCaches()
    expect(await cache.api.keys()).toEqual([CACHE_NAME, 'unrelated'])
    await clearAssetCache()
    expect(await cache.api.keys()).toEqual(['unrelated'])
    expect(await getCachedAssets()).toEqual(new Set())
    expect(await cache.api.keys()).toEqual(['unrelated'])
  })
})

describe('media helpers', () => {
  it('mixes channels down to mono', () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5])
    expect(mixToMono([])).toHaveLength(0)
  })

  it('drops alpha from RGBA', () => {
    expect(Array.from(rgbaToRgb(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0])))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('fits images within a max side without upscaling', () => {
    expect(fitWithin(4000, 2000, 1024)).toEqual({ width: 1024, height: 512 })
    expect(fitWithin(300, 200, 1024)).toEqual({ width: 300, height: 200 })
  })

  it('converts Mirage geometry', () => {
    expect(polygonPoints([1, 2, 3, 4, 5])).toBe('1,2 3,4')
    expect(polygonPoints([100, 500], 0.5, 2)).toBe('50,1000')
    expect(boxRect([10, 20, 110, 70])).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  it('recognises audio files, including .wav with a missing MIME type', () => {
    expect(isAudioFile({ name: 'clip.wav', type: '' })).toBe(true)
    expect(isAudioFile({ name: 'CLIP.WAV', type: 'application/octet-stream' })).toBe(true)
    expect(isAudioFile({ name: 'voice', type: 'audio/x-wav' })).toBe(true)
    expect(isAudioFile({ name: 'talk.mp4', type: 'video/mp4' })).toBe(true)
    expect(isAudioFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false)
  })
})
