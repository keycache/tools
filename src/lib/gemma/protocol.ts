import type { GemmaDevice, GemmaDtype } from './constants'

/** A turn as sent to the worker (Phase 1: text only). */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface GenSettings {
  /** 0 = greedy decoding (the model card's default for deterministic answers). */
  temperature: number
  topP: number
  maxNewTokens: number
  thinking: boolean
}

export interface GenStats {
  promptTokens: number
  newTokens: number
  /** Wall time of the whole generate call. */
  ms: number
  /** Time from request to first generated token. */
  firstTokenMs: number
  tokensPerSec: number
  /** Older turns left out of the prompt to fit the context budget. */
  trimmedTurns: number
}

export type GemmaErrorCode = 'unsupported' | 'quota' | 'network' | 'device-lost' | 'busy' | 'not-loaded' | 'unknown'

export type GemmaRequest =
  | { id: number; type: 'load'; device: GemmaDevice; dtype: GemmaDtype }
  | { id: number; type: 'generate'; turns: ChatTurn[]; settings: GenSettings }
  | { id: number; type: 'stop' }
  | { id: number; type: 'unload' }

export type GemmaResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'ready' }
  /** Cumulative parsed output so far (not a delta), sent at most every ~50 ms. */
  | { id: number; type: 'stream'; answer: string; thinking: string }
  | { id: number; type: 'done'; answer: string; thinking: string; stopped: boolean; stats: GenStats }
  | { id: number; type: 'unloaded' }
  | { id: number; type: 'error'; code: GemmaErrorCode; message: string }
