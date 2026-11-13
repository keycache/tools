import { useCallback, useEffect, useState } from 'react'
import { clearGemmaCache, getGemmaCacheInfo, type GemmaCacheInfo } from './cache'
import { detectCapability, type Capability } from './capability'

const cacheListeners = new Set<() => void>()

/** Call after anything that changes the Transformers cache (load, clear) so all views refresh. */
export function notifyGemmaCacheChanged(): void {
  cacheListeners.forEach((fn) => fn())
}

export interface GemmaCacheState extends GemmaCacheInfo {
  refresh: () => void
  clear: () => Promise<void>
}

export function useGemmaCache(): GemmaCacheState {
  const [info, setInfo] = useState<GemmaCacheInfo>({ bytes: 0, modelBytes: 0, files: 0 })
  const refresh = useCallback(() => {
    getGemmaCacheInfo()
      .then(setInfo)
      .catch(() => setInfo({ bytes: 0, modelBytes: 0, files: 0 }))
  }, [])
  useEffect(() => {
    refresh()
    cacheListeners.add(refresh)
    return () => void cacheListeners.delete(refresh)
  }, [refresh])
  const clear = useCallback(async () => {
    await clearGemmaCache()
    notifyGemmaCacheChanged()
  }, [])
  return { ...info, refresh, clear }
}

/**
 * Runs the WebGPU / storage check once `enabled` (i.e. the Chat tab is first opened), and again when the cached
 * byte count changes. Requesting a GPU adapter is cheap but not free, so other tabs never trigger it.
 */
export function useGemmaCapability(enabled: boolean, cachedBytes: number): Capability | null {
  const [capability, setCapability] = useState<Capability | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void detectCapability({ cachedBytes }).then((c) => {
      if (!cancelled) setCapability(c)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, cachedBytes])
  return capability
}
