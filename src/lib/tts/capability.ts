import { detectWebGpuCapability, type DetectOptions } from '@/lib/transformers/capability'
import { ttsTotalBytes } from './constants'

/** WebGPU / storage check for Speak. No CPU fallback: S0 measured the decoder at 5–6× slower than real time on WASM. */
export function detectTtsCapability(opts: DetectOptions = {}) {
  return detectWebGpuCapability({ feature: 'Speak', totalBytes: ttsTotalBytes }, opts)
}
