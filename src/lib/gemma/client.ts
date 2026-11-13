import { useSyncExternalStore } from 'react'
import type { GemmaDevice, GemmaDtype } from './constants'
import { notifyGemmaCacheChanged } from './hooks'
import type { ChatTurn, GemmaErrorCode, GemmaRequest, GemmaResponse, GenSettings, GenStats } from './protocol'

export type GemmaStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface GemmaDone {
  answer: string
  thinking: string
  stopped: boolean
  stats: GenStats
}

export class GemmaError extends Error {
  readonly code: GemmaErrorCode
  constructor(code: GemmaErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface GemmaState {
  status: GemmaStatus
  progress?: { loaded: number; total: number }
  error?: string
  errorCode?: GemmaErrorCode
  /** The in-flight generation, updated as text streams in. */
  stream: { id: number; answer: string; thinking: string } | null
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Owns the Gemma worker for the lifetime of the page (like the Cactus client), so the model survives tab switches.
 * Only one generation runs at a time; responses carry the request id they belong to.
 */
class GemmaClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private loadPromise: Promise<void> | null = null
  private state: GemmaState = { status: 'idle', stream: null }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getState = () => this.state

  private set(patch: Partial<GemmaState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./gemma.worker.ts', import.meta.url), { type: 'module', name: 'gemma' })
      this.worker.onmessage = (e: MessageEvent<GemmaResponse>) => this.onMessage(e.data)
      this.worker.onerror = (e) => this.fail(new GemmaError('unknown', e.message || 'The Gemma worker crashed.'))
    }
    return this.worker
  }

  private onMessage(msg: GemmaResponse) {
    const p = this.pending.get(msg.id)
    switch (msg.type) {
      case 'progress':
        this.set({ progress: { loaded: msg.loaded, total: msg.total } })
        return
      case 'stream':
        this.set({ stream: { id: msg.id, answer: msg.answer, thinking: msg.thinking } })
        return
      case 'ready':
      case 'unloaded':
        this.pending.delete(msg.id)
        p?.resolve(undefined)
        return
      case 'done':
        this.pending.delete(msg.id)
        p?.resolve({ answer: msg.answer, thinking: msg.thinking, stopped: msg.stopped, stats: msg.stats } satisfies GemmaDone)
        return
      case 'error':
        this.pending.delete(msg.id)
        p?.reject(new GemmaError(msg.code, msg.message))
        return
    }
  }

  /** Worker crashed: reject everything and start from a fresh worker next time. */
  private fail(err: GemmaError) {
    this.pending.forEach((p) => p.reject(err))
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
    this.loadPromise = null
    this.set({ status: 'error', error: err.message, errorCode: err.code, stream: null })
  }

  private call<T>(msg: DistributiveOmit<GemmaRequest, 'id'>): { id: number; done: Promise<T> } {
    const id = this.nextId++
    const done = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject })
      this.getWorker().postMessage({ ...msg, id })
    })
    return { id, done }
  }

  /** Downloads (or reads from cache) and initialises the model. Safe to call repeatedly. */
  load(device: GemmaDevice, dtype: GemmaDtype): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve()
    if (!this.loadPromise) {
      void requestPersistentStorage()
      this.set({ status: 'loading', progress: undefined, error: undefined, errorCode: undefined })
      this.loadPromise = this.call<void>({ type: 'load', device, dtype })
        .done.then(() => {
          this.set({ status: 'ready', progress: undefined })
          notifyGemmaCacheChanged()
        })
        .catch((err: GemmaError) => {
          this.loadPromise = null
          // A device-lost/crashed worker can't be reused.
          if (err.code === 'device-lost') {
            this.worker?.terminate()
            this.worker = null
          }
          this.set({ status: 'error', error: err.message, errorCode: err.code })
          notifyGemmaCacheChanged()
          throw err
        })
    }
    return this.loadPromise
  }

  /** Streams a reply into `state.stream`; resolves with the final text (also when stopped). */
  async generate(turns: ChatTurn[], settings: GenSettings): Promise<GemmaDone> {
    if (this.state.status !== 'ready') throw new GemmaError('not-loaded', 'Load the model first.')
    if (this.state.stream) throw new GemmaError('busy', 'A reply is already being generated.')
    const { id, done } = this.call<GemmaDone>({ type: 'generate', turns, settings })
    this.set({ stream: { id, answer: '', thinking: '' } })
    try {
      return await done
    } catch (err) {
      if (err instanceof GemmaError && err.code === 'device-lost') {
        this.worker?.terminate()
        this.worker = null
        this.loadPromise = null
        this.set({ status: 'error', error: err.message, errorCode: err.code })
      }
      throw err
    } finally {
      // Re-read: the store has changed since the guard above.
      if (this.getState().stream?.id === id) this.set({ stream: null })
    }
  }

  stop() {
    if (this.state.stream) this.getWorker().postMessage({ id: this.nextId++, type: 'stop' } satisfies GemmaRequest)
  }
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // Best effort: without persistence the browser may evict the cache under storage pressure.
  }
}

export const gemma = new GemmaClient()

export function useGemma(): GemmaState {
  return useSyncExternalStore(gemma.subscribe, gemma.getState)
}
