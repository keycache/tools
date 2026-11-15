/**
 * ONNX Runtime Web build used by every Transformers.js model, pinned with an npm `overrides` entry in package.json
 * (Transformers.js 4.3.2 pins 1.31.0-dev, whose session set-up takes 80+ s for the Chatterbox decoder; fixed in 1.32 —
 * see docs/LEARNINGS.md). Import-free so UI code can use the sizes without pulling in the runtime URLs.
 */
export const ORT_WEB_VERSION = '1.32.0-dev.20261110-53934832d'

/** "asyncify" `.wasm` + `.mjs` that Transformers.js uses for WebGPU/WASM, served from this site. */
export const ORT_RUNTIME_BYTES = 29_950_319 + 53_959

/** Matches the ORT runtime files (any build/hash), as stored in a model cache. */
export function isOrtRuntimeUrl(url: string): boolean {
  return /\/ort-wasm-simd-threaded[^/]*\.(?:wasm|mjs)(?:[?#]|$)/.test(url)
}
