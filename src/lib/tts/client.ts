import { useSyncExternalStore } from 'react'
import { SAMPLE_RATE, type TtsDevice, type TtsDtype } from './constants'
import { notifyTtsCacheChanged } from './hooks'
import type { TtsErrorCode, TtsRequest, TtsResponse } from './protocol'
import type { AudioChunk, ChunkStats, SynthChunk, SynthStats } from './types'

export type TtsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SynthDone {
  stopped: boolean
  stats: SynthStats
}

export class TtsError extends Error {
  readonly code: TtsErrorCode
  constructor(code: TtsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface TtsState {
  status: TtsStatus
  progress?: { loaded: number; total: number }
  error?: string
  errorCode?: TtsErrorCode
  /** Loaded, but not (fully) saved to browser storage — it will download again next visit. */
  warning?: string
  /** The running synthesis: chunks finished so far out of `total`. */
  job: { id: number; done: number; total: number } | null
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onChunk?: (chunk: AudioChunk, stats: ChunkStats) => void }
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Owns the Speak worker for the lifetime of the page (like the Gemma client), so the model survives tab switches.
 * One job (synthesize / encodeVoice) runs at a time; responses carry the request id they belong to.
 */
class TtsClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private loadPromise: Promise<void> | null = null
  private state: TtsState = { status: 'idle', job: null }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getState = () => this.state

  private set(patch: Partial<TtsState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module', name: 'tts' })
      this.worker.onmessage = (e: MessageEvent<TtsResponse>) => this.onMessage(e.data)
      this.worker.onerror = (e) => this.fail(new TtsError('unknown', e.message || 'The Speak worker crashed.'))
    }
    return this.worker
  }

  private onMessage(msg: TtsResponse) {
    const p = this.pending.get(msg.id)
    switch (msg.type) {
      case 'progress':
        this.set({ progress: { loaded: msg.loaded, total: msg.total } })
        return
      case 'chunk':
        p?.onChunk?.({ pcm: msg.pcm, sampleRate: SAMPLE_RATE, index: msg.index, total: msg.total }, msg.stats)
        if (this.state.job?.id === msg.id) this.set({ job: { ...this.state.job, done: msg.index + 1 } })
        return
      case 'ready':
        if (msg.cacheWarning) this.set({ warning: msg.cacheWarning })
        this.pending.delete(msg.id)
        p?.resolve(undefined)
        return
      case 'voice':
      case 'unloaded':
        this.pending.delete(msg.id)
        p?.resolve(undefined)
        return
      case 'done':
        this.pending.delete(msg.id)
        p?.resolve({ stopped: msg.stopped, stats: msg.stats } satisfies SynthDone)
        return
      case 'lost':
        this.fail(new TtsError('device-lost', msg.message))
        return
      case 'error':
        this.pending.delete(msg.id)
        p?.reject(new TtsError(msg.code, msg.message))
        return
    }
  }

  /** Worker crashed or lost its GPU: reject everything and start from a fresh worker next time. */
  private fail(err: TtsError) {
    this.pending.forEach((p) => p.reject(err))
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
    this.loadPromise = null
    this.set({ status: 'error', error: err.message, errorCode: err.code, job: null })
  }

  private call<T>(msg: DistributiveOmit<TtsRequest, 'id'>, extra: Pick<Pending, 'onChunk'> = {}, transfer: Transferable[] = []): { id: number; done: Promise<T> } {
    const id = this.nextId++
    const done = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, ...extra })
      this.getWorker().postMessage({ ...msg, id }, transfer)
    })
    return { id, done }
  }

  /** Downloads (or reads from storage) and initialises the model + default voice. Safe to call repeatedly. */
  load(device: TtsDevice, dtype: TtsDtype): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve()
    if (!this.loadPromise) {
      void requestPersistentStorage()
      this.set({ status: 'loading', progress: undefined, error: undefined, errorCode: undefined, warning: undefined })
      this.loadPromise = this.call<void>({ type: 'load', device, dtype })
        .done.then(() => {
          this.set({ status: 'ready', progress: undefined })
          notifyTtsCacheChanged()
        })
        .catch((err: TtsError) => {
          this.loadPromise = null
          if (err.code === 'device-lost') {
            this.worker?.terminate()
            this.worker = null
          }
          this.set({ status: 'error', error: err.message, errorCode: err.code })
          notifyTtsCacheChanged()
          throw err
        })
    }
    return this.loadPromise
  }

  /** Encodes a 24 kHz mono reference clip as `voiceId` (the PCM buffer is transferred to the worker). */
  async encodeVoice(voiceId: string, pcm: Float32Array): Promise<void> {
    this.assertReady()
    await this.guard(this.call<void>({ type: 'encodeVoice', voiceId, pcm }, {}, [pcm.buffer]).done)
  }

  /** Makes a built-in voice available as `voiceId` (fetched + stored on first use, then encoded once per worker). */
  async encodeBuiltin(voiceId: string, url: string): Promise<void> {
    this.assertReady()
    await this.guard(this.call<void>({ type: 'encodeBuiltin', voiceId, url }).done)
    notifyTtsCacheChanged()
  }

  /** Generates `chunks` in order; `onChunk` receives each one as soon as it's ready. Resolves when done or stopped. */
  async synthesize(chunks: SynthChunk[], onChunk: (chunk: AudioChunk, stats: ChunkStats) => void): Promise<SynthDone> {
    this.assertReady()
    if (this.state.job) throw new TtsError('busy', 'Speech is already being generated.')
    const { id, done } = this.call<SynthDone>({ type: 'synthesize', chunks }, { onChunk })
    this.set({ job: { id, done: 0, total: chunks.length } })
    try {
      return await this.guard(done)
    } finally {
      if (this.getState().job?.id === id) this.set({ job: null })
    }
  }

  stop() {
    if (this.state.job) this.getWorker().postMessage({ id: this.nextId++, type: 'stop' } satisfies TtsRequest)
  }

  private assertReady() {
    if (this.state.status !== 'ready') throw new TtsError('not-loaded', 'Load the model first.')
  }

  /** A device-lost error mid-job leaves the model unusable: drop the worker so the next load starts fresh. */
  private async guard<T>(p: Promise<T>): Promise<T> {
    try {
      return await p
    } catch (err) {
      if (err instanceof TtsError && err.code === 'device-lost') {
        this.worker?.terminate()
        this.worker = null
        this.loadPromise = null
        this.set({ status: 'error', error: err.message, errorCode: err.code })
      }
      throw err
    }
  }
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // Best effort: without persistence the browser may evict the cache under storage pressure.
  }
}

export const tts = new TtsClient()

export function useTts(): TtsState {
  return useSyncExternalStore(tts.subscribe, tts.getState)
}
