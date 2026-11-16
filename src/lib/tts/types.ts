/**
 * Model-agnostic text-to-speech types: the worker protocol and UI only depend on these, so another engine (e.g.
 * Kokoro) can be added behind the same interface. See docs/SPECIFICATIONS.md §S3.2.
 */
export interface TtsModelInfo {
  id: string
  name: string
  revision: string
  sampleRate: number
  languages: string[]
  capabilities: { voiceCloning: boolean; exaggeration: boolean; maxCharsPerChunk: number }
}

/** One generate call's input. */
export interface SynthChunk {
  text: string
  exaggeration: number
  /** Speaker-cache id of the voice (conversations switch voices between chunks). */
  voiceId: string
}

/** One generated piece of audio, in text order. */
export interface AudioChunk {
  pcm: Float32Array
  sampleRate: number
  index: number
  total: number
}

export interface ChunkStats {
  chars: number
  /** Speech tokens generated (≈ 25 per second of audio). */
  speechTokens: number
  /** True when generation stopped at the token cap — the audio is probably cut off (even after a re-split). */
  hitCap: boolean
  /** The first attempt hit the token cap, so the chunk was regenerated as two halves and joined. */
  resplit: boolean
  ms: number
  audioSeconds: number
}

export interface SynthStats {
  chunks: number
  ms: number
  /** Request → first chunk ready. */
  firstAudioMs: number
  audioSeconds: number
  /** Generation time ÷ audio length (< 1 = faster than playback). */
  rtf: number
}
