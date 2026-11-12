import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ASSETS, ENGINE_ASSETS, clearAssetCache, getCachedAssets, type AssetId, type ModelId, type Progress } from './assets'
import type { AudioOptions, CompleteRequest } from './engine'
import type { WorkerRequest, WorkerResponse, WorkerResult } from './protocol'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ModelState {
  status: ModelStatus
  progress?: Progress
  error?: string
}

export interface Timed<T> {
  result: T
  ms: number
}

type Pending = {
  resolve: (v: Timed<unknown>) => void
  reject: (e: Error) => void
  onProgress?: (p: Progress) => void
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const IDLE: ModelState = { status: 'idle' }

class CactusClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private states: Record<ModelId, ModelState> = { needle: IDLE, whistle: IDLE, mirage: IDLE }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = (model: ModelId): ModelState => this.states[model]

  private setState(model: ModelId, state: ModelState) {
    this.states = { ...this.states, [model]: state }
    this.listeners.forEach((fn) => fn())
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./cactus.worker.ts', import.meta.url), { type: 'module', name: 'cactus' })
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        const p = this.pending.get(msg.id)
        if (!p) return
        if (msg.type === 'progress') return p.onProgress?.(msg.progress)
        this.pending.delete(msg.id)
        if (msg.type === 'ok') p.resolve({ result: msg.result, ms: msg.ms })
        else p.reject(new Error(msg.message))
      }
      this.worker.onerror = (e) => {
        const err = new Error(e.message || 'Inference worker crashed')
        this.pending.forEach((p) => p.reject(err))
        this.pending.clear()
      }
    }
    return this.worker
  }

  private call<K extends WorkerRequest['type']>(
    msg: DistributiveOmit<Extract<WorkerRequest, { type: K }>, 'id'>,
    onProgress?: (p: Progress) => void,
  ): Promise<Timed<WorkerResult[K]>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, onProgress })
      this.getWorker().postMessage({ ...msg, id })
    })
  }

  /** Downloads (or reads from cache) and loads a model. Safe to call repeatedly. */
  async load(model: ModelId): Promise<void> {
    const current = this.states[model]
    if (current.status === 'ready') return
    if (current.status === 'loading') {
      return new Promise((resolve, reject) => {
        const unsub = this.subscribe(() => {
          const s = this.states[model]
          if (s.status === 'loading') return
          unsub()
          if (s.status === 'ready') resolve()
          else reject(new Error(s.error))
        })
      })
    }
    void requestPersistentStorage()
    this.setState(model, { status: 'loading' })
    try {
      await this.call<'load'>({ type: 'load', model }, (progress) => this.setState(model, { status: 'loading', progress }))
      this.setState(model, { status: 'ready' })
      notifyCacheChanged()
    } catch (err) {
      this.setState(model, { status: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  // Inputs are structured-cloned (not transferred) so callers can re-run on the same audio/image.
  complete(req: CompleteRequest) {
    return this.call<'complete'>({ type: 'complete', req })
  }

  transcribe(pcm: Float32Array, opts: AudioOptions) {
    return this.call<'transcribe'>({ type: 'transcribe', pcm, opts })
  }

  describe(rgb: Uint8Array, width: number, height: number, options: Record<string, unknown> = {}, language?: string | null) {
    return this.call<'describe'>({ type: 'describe', rgb, width, height, options, language })
  }
}

export const cactus = new CactusClient()

export function useModel(model: ModelId) {
  const state = useSyncExternalStore(cactus.subscribe, () => cactus.getState(model))
  const load = useCallback(() => cactus.load(model).catch(() => {}), [model])
  return { ...state, load }
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // Best effort: without persistence the browser may evict the cache under storage pressure.
  }
}

const cacheListeners = new Set<() => void>()
function notifyCacheChanged() {
  cacheListeners.forEach((fn) => fn())
}

export interface CacheInfo {
  cached: Set<AssetId>
  /** Bytes of model files currently in browser storage. */
  bytes: number
  refresh: () => void
  clear: () => Promise<void>
}

export function useCacheInfo(): CacheInfo {
  const [cached, setCached] = useState<Set<AssetId>>(new Set())
  const refresh = useCallback(() => {
    getCachedAssets()
      .then(setCached)
      .catch(() => setCached(new Set()))
  }, [])
  useEffect(() => {
    refresh()
    cacheListeners.add(refresh)
    return () => void cacheListeners.delete(refresh)
  }, [refresh])
  const clear = useCallback(async () => {
    await clearAssetCache()
    notifyCacheChanged()
  }, [])
  const bytes = [...cached].reduce((sum, id) => sum + ASSETS[id].bytes, 0)
  return { cached, bytes, refresh, clear }
}

/** Download size for a model, including the engine if it isn't cached yet. */
export function downloadSize(model: ModelId, cached: Set<AssetId>): number {
  return [...ENGINE_ASSETS, model].filter((id) => !cached.has(id)).reduce((sum, id) => sum + ASSETS[id].bytes, 0)
}
