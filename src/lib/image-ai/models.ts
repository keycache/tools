import { isOpfsSupported, listOpfsEntries, opfsDir } from '@/lib/transformers/opfsCache'

export type ImageTool = 'watermark' | 'upscale'
export type ImageDevice = 'webgpu' | 'wasm'
export type ImageScale = 2 | 3 | 4

export interface ModelAsset {
  file: string
  bytes: number
  sha256: string
}

export const IMAGE_MODELS = {
  watermark: { name: 'FODUU Watermark Removal', megabytes: 63, source: 'https://huggingface.co/foduucom/Watermark_Removal' },
  upscale: { name: 'Swin2SR 2x', megabytes: 55, source: 'https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64' },
}

export const modelDirectory = (tool: ImageTool) => `image-ai-${tool}`
export const modelUrl = (asset: ModelAsset) => new URL(`${import.meta.env.BASE_URL}models/${asset.file}`, location.href).href

function isAsset(value: unknown): value is ModelAsset {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<ModelAsset>
  return typeof asset.file === 'string' && /^[a-z-]+-[a-f0-9]{64}\.onnx$/.test(asset.file)
    && typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256)
    && asset.file.endsWith(`-${asset.sha256}.onnx`)
    && typeof asset.bytes === 'number' && Number.isSafeInteger(asset.bytes) && asset.bytes > 0
}

export function parseModelManifest(value: unknown): Record<ImageTool, ModelAsset> {
  if (!value || typeof value !== 'object' || !('models' in value) || !value.models || typeof value.models !== 'object') {
    throw new Error('Invalid image model manifest. Rebuild the model assets.')
  }
  const models = value.models
  if (!('watermark' in models) || !isAsset(models.watermark) || !('upscale' in models) || !isAsset(models.upscale)) {
    throw new Error('Invalid image model assets. Rebuild the model assets.')
  }
  return { watermark: models.watermark, upscale: models.upscale }
}

export async function fetchModelManifest(signal?: AbortSignal): Promise<Record<ImageTool, ModelAsset>> {
  const response = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`Image model assets are unavailable (HTTP ${response.status}). Run npm run prepare:image-models, then rebuild or reload.`)
  return parseModelManifest(await response.json())
}

export async function cachedModelBytes(tool: ImageTool, asset: ModelAsset): Promise<number> {
  if (!isOpfsSupported()) return 0
  const entries = await listOpfsEntries(opfsDir(modelDirectory(tool)))
  return entries.filter((entry) => entry.url === modelUrl(asset) && entry.size === asset.bytes).reduce((sum, entry) => sum + entry.size, 0)
}

export async function deleteModelCache(tool: ImageTool): Promise<void> {
  if (!isOpfsSupported()) throw new Error('This browser does not support persistent model storage.')
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry(modelDirectory(tool), { recursive: true })
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
  }
}
