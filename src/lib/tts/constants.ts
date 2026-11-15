/**
 * Speak (Chatterbox TTS) constants. Sizes are exact byte counts from the Hugging Face repo at TTS_REVISION; update
 * them together with the revision. See docs/SPECIFICATIONS.md §S1.
 */
import type { ModelDtype } from '@/lib/transformers/capability'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { pinRevision } from '@/lib/transformers/revision'

export const TTS_MODEL_ID = 'onnx-community/chatterbox-ONNX'
/** Pinned repo commit so cached files, sizes and behaviour stay consistent. */
export const TTS_REVISION = '3cab09af388d3f02bba43443fce88c1f4525ac43'

export type TtsDtype = ModelDtype
export type TtsDevice = 'webgpu'

/** Output and reference-audio sample rate. */
export const SAMPLE_RATE = 24_000
/** Speech tokens per generate call (~25 tokens/s of audio → ≈ 10 s). The library default (~20) is far too short. */
export const MAX_NEW_TOKENS = 256
/** S0: ~1.65 speech tokens per character, so ~150 chars hit MAX_NEW_TOKENS; stay well below. */
export const MAX_CHUNK_CHARS = 120
export const MAX_INPUT_CHARS = 10_000
export const MAX_REFERENCE_SECONDS = 10
export const DEFAULT_EXAGGERATION = 0.5
export const EXAGGERATION_RANGE = [0, 1.5] as const
export const DEFAULT_VOICE_ID = 'default'

/**
 * Per-file dtypes (keyed by ONNX file name, as Transformers.js expects). Only the language model has quantised
 * variants in the repo; the other three sessions are fp32 only. `model` repeats the language model's dtype because
 * Transformers.js 4.3.2's progress-total pass (`get_model_files`) looks dtypes up by session key (`model`) rather than
 * file name — without it, it probes the fp32 `language_model.onnx` (a wasted request; a failed one offline).
 */
export function ttsDtypeMap(dtype: TtsDtype): Record<string, string> {
  return { embed_tokens: 'fp32', speech_encoder: 'fp32', language_model: dtype, model: dtype, conditional_decoder: 'fp32' }
}

export interface TtsComponentSizes {
  languageModel: number
  speechEncoder: number
  conditionalDecoder: number
  embedTokens: number
}

/** `.onnx` + `.onnx_data` per session. */
export const TTS_SIZES: Record<TtsDtype, TtsComponentSizes> = {
  q4f16: { languageModel: 229_388 + 304_737_408, speechEncoder: 1_184_608 + 591_274_880, conditionalDecoder: 6_350_448 + 533_970_816, embedTokens: 13_286 + 61_640_704 },
  q4: { languageModel: 227_911 + 353_621_248, speechEncoder: 1_184_608 + 591_274_880, conditionalDecoder: 6_350_448 + 533_970_816, embedTokens: 13_286 + 61_640_704 },
}

/** config.json, generation_config.json, preprocessor_config.json, tokenizer.json, tokenizer_config.json. */
export const TTS_CONFIG_BYTES = 1_097 + 93 + 130 + 28_543 + 244
/** default_voice.wav: 32-bit float, mono, 24 kHz, 7.44 s. */
export const DEFAULT_VOICE_BYTES = 714_320

/** Bytes needed to run Speak: runtime + config + all four sessions + the default voice. */
export function ttsTotalBytes(dtype: TtsDtype): number {
  const s = TTS_SIZES[dtype]
  return ORT_RUNTIME_BYTES + TTS_CONFIG_BYTES + DEFAULT_VOICE_BYTES + s.languageModel + s.speechEncoder + s.conditionalDecoder + s.embedTokens
}

export const pinTtsRevision = pinRevision(TTS_MODEL_ID, TTS_REVISION)

export function ttsFileUrl(path: string): string {
  return `https://huggingface.co/${TTS_MODEL_ID}/resolve/${TTS_REVISION}/${path}`
}

export const DEFAULT_VOICE_URL = ttsFileUrl('default_voice.wav')

/**
 * True for the repo files a `dtype` load reads: configs/tokenizer/default voice (outside `onnx/`), the fp32 sessions
 * and that dtype's language model.
 */
export function isTtsFileFor(url: string, dtype: TtsDtype): boolean {
  const prefix = `/${TTS_MODEL_ID}/resolve/${TTS_REVISION}/`
  const at = url.indexOf(prefix)
  if (at < 0) return false
  const path = url.slice(at + prefix.length)
  if (!path.startsWith('onnx/')) return true
  return new RegExp(`^onnx/(?:(?:embed_tokens|speech_encoder|conditional_decoder)|language_model_${dtype})\\.onnx(?:_data)?$`).test(path)
}
