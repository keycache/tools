import { useCallback, useEffect, useState } from 'react'
import type { Capability } from '@/lib/transformers/capability'
import { EMPTY_TTS_CACHE, clearTtsCache, getTtsCacheDetails, type TtsCacheInfo, type TtsReadyBytes } from './cache'
import { detectTtsCapability } from './capability'

const cacheListeners = new Set<() => void>()

/** Call after anything that changes Speak's stored files (load, clear) so all views refresh. */
export function notifyTtsCacheChanged(): void {
  cacheListeners.forEach((fn) => fn())
}

export interface TtsCacheState extends TtsCacheInfo {
  ready: TtsReadyBytes
  refresh: () => void
  clear: () => Promise<void>
}

export function useTtsCache(): TtsCacheState {
  const [details, setDetails] = useState(EMPTY_TTS_CACHE)
  const refresh = useCallback(() => {
    getTtsCacheDetails()
      .then(setDetails)
      .catch(() => setDetails(EMPTY_TTS_CACHE))
  }, [])
  useEffect(() => {
    refresh()
    cacheListeners.add(refresh)
    return () => void cacheListeners.delete(refresh)
  }, [refresh])
  const clear = useCallback(async () => {
    await clearTtsCache()
    notifyTtsCacheChanged()
  }, [])
  return { ...details.info, ready: details.ready, refresh, clear }
}

/** Runs the WebGPU / storage check once `enabled` (the Speak tab was opened), and again when stored files change. */
export function useTtsCapability(enabled: boolean, ready: TtsReadyBytes): Capability | null {
  const [capability, setCapability] = useState<Capability | null>(null)
  const { q4f16, q4 } = ready
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void detectTtsCapability({ readyBytes: { q4f16, q4 } }).then((c) => {
      if (!cancelled) setCapability(c)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, q4f16, q4])
  return capability
}
