import { gemmaTotalBytes, type GemmaDevice, type GemmaDtype } from './constants'

// Minimal WebGPU / StorageManager shapes: the DOM lib in this TS setup doesn't include WebGPU types.
export interface GpuAdapterLike {
  features: { has(feature: string): boolean }
}
export interface GpuLike {
  requestAdapter(options?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<GpuAdapterLike | null>
}
export interface StorageLike {
  estimate(): Promise<{ quota?: number; usage?: number }>
  persisted?(): Promise<boolean>
}

export interface Capability {
  webgpu: boolean
  shaderF16: boolean
  device: GemmaDevice | null
  dtype: GemmaDtype | null
  /** Everything needed for the chosen dtype (runtime + config + core sessions, no audio). */
  totalBytes: number
  /** totalBytes minus what is already in the browser cache. */
  downloadBytes: number
  storage: { quota: number; usage: number; persisted: boolean } | null
  /** Set when this browser/device can't run Gemma at all. */
  unsupported?: string
  /** Set when it could run, but there isn't enough storage to download it. */
  blocked?: string
}

/** Headroom over the raw download so the browser doesn't evict other data / fail mid-write. */
export const STORAGE_HEADROOM = 1.1

export interface DetectOptions {
  gpu?: GpuLike | null
  storage?: StorageLike | null
  /** Bytes of Gemma files already cached (see cache.ts). */
  cachedBytes?: number
  secureContext?: boolean
}

export async function detectCapability(opts: DetectOptions = {}): Promise<Capability> {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: GpuLike })
  const gpu = 'gpu' in opts ? opts.gpu : nav?.gpu
  const storageApi = 'storage' in opts ? opts.storage : (nav?.storage as StorageLike | undefined)
  const secure = opts.secureContext ?? (typeof isSecureContext === 'undefined' ? true : isSecureContext)

  let adapter: GpuAdapterLike | null = null
  if (gpu) {
    try {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    } catch {
      adapter = null
    }
  }
  const webgpu = !!adapter
  const shaderF16 = !!adapter?.features.has('shader-f16')
  const dtype: GemmaDtype | null = webgpu ? (shaderF16 ? 'q4f16' : 'q4') : null
  const totalBytes = dtype ? gemmaTotalBytes(dtype) : 0
  const downloadBytes = Math.max(0, totalBytes - (opts.cachedBytes ?? 0))

  let storage: Capability['storage'] = null
  if (storageApi) {
    try {
      const est = await storageApi.estimate()
      const persisted = storageApi.persisted ? await storageApi.persisted() : false
      storage = { quota: est.quota ?? 0, usage: est.usage ?? 0, persisted }
    } catch {
      storage = null
    }
  }

  const result: Capability = { webgpu, shaderF16, device: webgpu ? 'webgpu' : null, dtype, totalBytes, downloadBytes, storage }

  if (!webgpu) {
    result.unsupported = !secure
      ? 'Chat needs WebGPU, which browsers only enable on HTTPS or localhost.'
      : gpu
        ? 'WebGPU is available but no suitable GPU adapter was found. Try Chrome or Edge on a device with a GPU.'
        : 'Chat needs WebGPU: Chrome or Edge 113+, or Safari 26+, on a desktop or laptop.'
    return result
  }

  if (storage && storage.quota > 0 && downloadBytes > 0) {
    const free = storage.quota - storage.usage
    if (free < downloadBytes * STORAGE_HEADROOM) {
      result.blocked = `Not enough browser storage: needs about ${gb(downloadBytes * STORAGE_HEADROOM)} free, ${gb(Math.max(0, free))} available. Free up disk space or clear other site data.`
    }
  }
  return result
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
