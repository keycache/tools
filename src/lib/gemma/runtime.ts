import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type { env as TransformersEnv } from '@huggingface/transformers'
import { pinGemmaRevision } from './constants'
import { OpfsModelCache } from './opfsCache'

/**
 * ONNX Runtime Web files emitted by Vite and served from this site. Transformers.js otherwise downloads them
 * from cdn.jsdelivr.net at runtime; serving them ourselves keeps model weights as the only third-party request.
 */
export const ORT_RUNTIME_URLS = {
  mjs: toAbsolute(ortMjsUrl),
  wasm: toAbsolute(ortWasmUrl),
}

function toAbsolute(url: string): string {
  return new URL(url, self.location.href).href
}

/** Applies our Transformers.js settings. Call once in the Gemma worker before loading anything. */
export function configureTransformers(env: typeof TransformersEnv, cache: { match: unknown; put: unknown } = new OpfsModelCache(undefined, pinGemmaRevision)): void {
  env.allowLocalModels = false
  env.allowRemoteModels = true
  // Model files go to OPFS (see opfsCache.ts): Cache Storage rejects the 1.5 GB+ Gemma files.
  env.useBrowserCache = false
  env.useCustomCache = true
  env.customCache = cache as typeof env.customCache
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
  if (onnx.wasm) onnx.wasm.wasmPaths = { ...ORT_RUNTIME_URLS }
}
