import { detectWebGpuCapability, type DetectOptions } from '@/lib/transformers/capability'
import { gemmaTotalBytes } from './constants'

export { STORAGE_HEADROOM, type Capability, type DetectOptions, type GpuAdapterLike, type GpuLike, type StorageLike } from '@/lib/transformers/capability'

/** WebGPU / storage check for Gemma (see src/lib/transformers/capability.ts). */
export function detectCapability(opts: DetectOptions = {}) {
  return detectWebGpuCapability({ feature: 'Chat', totalBytes: gemmaTotalBytes }, opts)
}
