import type { env as TransformersEnv } from '@huggingface/transformers'
import { configureTransformers as configureShared } from '@/lib/transformers/runtime'
import { pinGemmaRevision } from './constants'
import { OpfsModelCache, gemmaDir } from './opfsCache'

export { ORT_RUNTIME_URLS } from '@/lib/transformers/runtime'

/** Applies our Transformers.js settings with Gemma's OPFS cache. Call once in the Gemma worker before loading anything. */
export function configureTransformers(env: typeof TransformersEnv, cache: { match: unknown; put: unknown } = new OpfsModelCache(gemmaDir, pinGemmaRevision)): void {
  configureShared(env, cache)
}
