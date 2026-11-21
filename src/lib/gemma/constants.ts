/**
 * Gemma 4 E2B (Chat tab) constants. Sizes are exact byte counts from the Hugging Face repo at GEMMA_REVISION;
 * update them together with the revision. See docs/SPECIFICATIONS.md §1.
 */
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { pinRevision } from '@/lib/transformers/revision'

export { ORT_RUNTIME_BYTES }

export const GEMMA_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX'
/** Pinned repo commit so cached files, sizes and behaviour stay consistent. */
export const GEMMA_REVISION = '6f21c99d7e18237f8d2ce92aadfdbfeba877f63a'
export const TRANSFORMERS_VERSION = '4.3.2'

export type GemmaDtype = 'q4f16' | 'q4'
export type GemmaDevice = 'webgpu' | 'wasm'

export interface GemmaComponentSizes {
  decoder: number
  embeddings: number
  vision: number
  audio: number
}

export const GEMMA_SIZES: Record<GemmaDtype, GemmaComponentSizes> = {
  q4f16: { decoder: 1_520_374_223, embeddings: 1_590_695_413, vision: 99_378_564, audio: 171_518_558 },
  q4: { decoder: 1_864_750_511, embeddings: 1_762_661_398, vision: 112_305_736, audio: 190_344_813 },
}

/** config.json, generation_config.json, processor/preprocessor configs, chat_template.jinja, tokenizer(.json/_config). */
export const GEMMA_CONFIG_BYTES = 5_549 + 238 + 43 + 1_689 + 16_317 + 19_439_251 + 18_590

/**
 * Transformers.js 4.3.2 loads every session of Gemma4ForConditionalGeneration (text, vision **and** audio) together;
 * there is no public option to defer the audio encoder (only a text-only mode that also drops vision). So the
 * audio encoder is part of the first download. See docs/SPECIFICATIONS.md §1.1.
 */
export const GEMMA_LOADS_AUDIO = true

/** Bytes needed to run Gemma: runtime + config + all loaded sessions. */
export function gemmaTotalBytes(dtype: GemmaDtype, { withAudio = GEMMA_LOADS_AUDIO } = {}): number {
  const s = GEMMA_SIZES[dtype]
  return ORT_RUNTIME_BYTES + GEMMA_CONFIG_BYTES + s.decoder + s.embeddings + s.vision + (withAudio ? s.audio : 0)
}

/**
 * Prompt + reply token budget per turn. The model supports 128k, but prefill cost and KV-cache memory grow with
 * context, so the browser chat keeps a much smaller window (oldest turns are dropped first).
 */
export const GEMMA_CONTEXT_TOKENS = 32768

/**
 * Pins Gemma's `resolve/main/` URLs to GEMMA_REVISION in the cache (Transformers.js 4.3.2 looks up
 * `tokenizer_config.json` without the revision — see `pinRevision`).
 */
export const pinGemmaRevision = pinRevision(GEMMA_MODEL_ID, GEMMA_REVISION)

/** True for files of the Gemma repo at the pinned revision (cache keys are normalised to it). */
export function isGemmaFileUrl(url: string): boolean {
  return url.includes(`/${GEMMA_MODEL_ID}/resolve/${GEMMA_REVISION}/`)
}

/**
 * True for the Gemma repo files that `dtype` actually loads: configs/tokenizer (outside `onnx/`) and that dtype's
 * session files (`onnx/<name>_<dtype>.onnx[_data]`).
 */
export function isGemmaFileFor(url: string, dtype: GemmaDtype): boolean {
  if (!isGemmaFileUrl(url)) return false
  const path = url.slice(url.indexOf(`/resolve/${GEMMA_REVISION}/`) + `/resolve/${GEMMA_REVISION}/`.length)
  return !path.startsWith('onnx/') || new RegExp(`_${dtype}\\.onnx(?:_data)?$`).test(path)
}
