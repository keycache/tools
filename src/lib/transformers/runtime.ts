import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type { env as TransformersEnv } from '@huggingface/transformers'
import { isOrtRuntimeUrl } from './constants'
import { removeOpfsEntries, type DirProvider, type EntryMeta } from './opfsCache'

/**
 * ONNX Runtime Web files emitted by Vite and served from this site. Transformers.js otherwise downloads them
 * from cdn.jsdelivr.net at runtime; serving them ourselves keeps model weights as the only third-party request.
 */
export const ORT_RUNTIME_URLS = {
  mjs: toAbsolute(ortMjsUrl),
  wasm: toAbsolute(ortWasmUrl),
}

function toAbsolute(url: string): string {
  // `location` is always set in the browser; the fallback only keeps Node-environment tests importable.
  return new URL(url, globalThis.location?.href ?? 'http://localhost/').href
}

/** True for the runtime files of the ORT build this site currently ships. */
export function isCurrentOrtRuntime(url: string): boolean {
  return url === ORT_RUNTIME_URLS.mjs || url === ORT_RUNTIME_URLS.wasm
}

/**
 * Runtime files from an older build. Vite hashes their names, so after an ORT update the old entry is never read
 * again but would still count as "stored".
 */
export function isStaleOrtRuntime(url: string): boolean {
  return isOrtRuntimeUrl(url) && !isCurrentOrtRuntime(url)
}

/** Deletes stale ORT runtime entries from a model cache directory. */
export function pruneStaleOrtRuntime(getDir: DirProvider): Promise<EntryMeta[]> {
  return removeOpfsEntries(getDir, (e) => isStaleOrtRuntime(e.url))
}

/**
 * Applies our Transformers.js settings. Call once in a model worker before loading anything.
 * @param cache The model cache (an `OpfsModelCache` for that model's directory); only `match`/`put` are used.
 */
export function configureTransformers(env: typeof TransformersEnv, cache: { match: unknown; put: unknown }): void {
  env.allowLocalModels = false
  env.allowRemoteModels = true
  // Model files go to OPFS (see opfsCache.ts): Cache Storage rejects GB-sized files.
  env.useBrowserCache = false
  env.useCustomCache = true
  env.customCache = cache as typeof env.customCache
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
  if (onnx.wasm) onnx.wasm.wasmPaths = { ...ORT_RUNTIME_URLS }
}
