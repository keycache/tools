/**
 * Gemma 4 E2B (Chat tab) constants. Sizes are exact byte counts from the Hugging Face repo at GEMMA_REVISION;
 * update them together with the revision. See docs/SPECIFICATIONS.md §1.
 */
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

/** ONNX Runtime Web "asyncify" build that Transformers.js uses for WebGPU/WASM, served from this site. */
export const ORT_RUNTIME_BYTES = 26_861_777 + 53_057

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
export const GEMMA_CONTEXT_TOKENS = 8192

/**
 * Transformers.js 4.3.2 checks `tokenizer_config.json` via `get_file_metadata(model, file, {})` without the
 * `revision` option, i.e. at `resolve/main/`. That misses our pinned-revision cache entry and goes to the network on
 * every load — which breaks loading offline. Mapping Gemma's `resolve/main/` URLs to the pinned revision makes that
 * lookup a cache hit.
 */
export function pinGemmaRevision(url: string): string {
  return url.replace(`/${GEMMA_MODEL_ID}/resolve/main/`, `/${GEMMA_MODEL_ID}/resolve/${GEMMA_REVISION}/`)
}
