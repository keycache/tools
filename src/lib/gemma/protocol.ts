import type { GemmaDevice, GemmaDtype } from './constants'

/** A turn as sent to the worker. Images are already downscaled (≤ 1024 px) by the UI. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  images?: Blob[]
  /** 16 kHz mono PCM, ≤ 30 s. Only the newest clip in a conversation reaches the model (see limitAudio). */
  audio?: Float32Array
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
  /** Older audio clips not sent (the processor accepts one clip per prompt). */
  droppedAudio: number
}

export type GemmaErrorCode = 'unsupported' | 'quota' | 'network' | 'device-lost' | 'busy' | 'not-loaded' | 'unknown'

export type GemmaRequest =
  | { id: number; type: 'load'; device: GemmaDevice; dtype: GemmaDtype }
  | { id: number; type: 'generate'; turns: ChatTurn[]; settings: GenSettings }
  | { id: number; type: 'stop' }
  | { id: number; type: 'unload' }

export type GemmaResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  /** `cacheWarning`: loaded, but some files couldn't be saved to browser storage (they'll download again). */
  | { id: number; type: 'ready'; cacheWarning?: string }
  /** Cumulative parsed output so far (not a delta), sent at most every ~50 ms. */
  | { id: number; type: 'stream'; answer: string; thinking: string }
  | { id: number; type: 'done'; answer: string; thinking: string; stopped: boolean; stats: GenStats }
  | { id: number; type: 'unloaded' }
  | { id: number; type: 'error'; code: GemmaErrorCode; message: string }
  /** Unsolicited: the GPU device was lost (driver reset, OOM, …). The loaded model is unusable. */
  | { id: 0; type: 'lost'; message: string }
