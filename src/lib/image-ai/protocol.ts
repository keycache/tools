import type { ImageDevice, ImageScale, ImageTool, ModelAsset } from './models'

export type ImageRequest =
  | { id: number; type: 'load'; tool: ImageTool; asset: ModelAsset; device: ImageDevice }
  | { id: number; type: 'process'; image: Blob; passes: number; scale: ImageScale }

export interface ImageResult { blob: Blob; width: number; height: number; seconds: number }
export type ImageResponse =
  | { id: number; type: 'progress'; message: string }
  | { id: number; type: 'ready'; warning?: string }
  | { id: number; type: 'result'; result: ImageResult }
  | { id: number; type: 'error'; message: string }
