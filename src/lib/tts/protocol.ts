import type { TtsDevice, TtsDtype } from './constants'
import type { ChunkStats, SynthChunk, SynthStats } from './types'

export type TtsErrorCode = 'unsupported' | 'quota' | 'network' | 'device-lost' | 'busy' | 'not-loaded' | 'no-voice' | 'unknown'

export type TtsRequest =
  | { id: number; type: 'load'; device: TtsDevice; dtype: TtsDtype }
  /** 24 kHz mono PCM (transferred); longer than MAX_REFERENCE_SECONDS is trimmed. Replaces an existing voice id. */
  | { id: number; type: 'encodeVoice'; voiceId: string; pcm: Float32Array }
  /** A built-in clip (site asset): read from / stored in Speak's OPFS cache, encoded once per worker as `voiceId`. */
  | { id: number; type: 'encodeBuiltin'; voiceId: string; url: string }
  /** Chunks are generated in order (each with its own exaggeration), one `chunk` response each. */
  | { id: number; type: 'synthesize'; chunks: SynthChunk[]; voiceId: string }
  /** Interrupts the in-flight synthesize; its partial chunk is dropped. */
  | { id: number; type: 'stop' }
  | { id: number; type: 'unload' }

export type TtsResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  /** `cacheWarning`: loaded, but some files couldn't be saved to browser storage (they'll download again). */
  | { id: number; type: 'ready'; cacheWarning?: string }
  | { id: number; type: 'voice'; voiceId: string; ms: number }
  /** PCM is transferred (24 kHz mono). */
  | { id: number; type: 'chunk'; index: number; total: number; pcm: Float32Array; stats: ChunkStats }
  | { id: number; type: 'done'; stopped: boolean; stats: SynthStats }
  | { id: number; type: 'unloaded' }
  | { id: number; type: 'error'; code: TtsErrorCode; message: string }
  /** Unsolicited: the GPU device was lost (driver reset, OOM, …). The loaded model is unusable. */
  | { id: 0; type: 'lost'; message: string }
