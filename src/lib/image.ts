import type { RenderPlan } from '@/lib/aspect'

export type ImageFormat = 'image/png' | 'image/jpeg' | 'image/webp'

export const FORMAT_EXT: Record<ImageFormat, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function renderToBlob(
  img: HTMLImageElement,
  plan: RenderPlan,
  format: ImageFormat,
  quality: number,
  background: string | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas not supported'))

  // Null keeps transparency (PNG/WebP).
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, plan.width, plan.height)
  }
  ctx.drawImage(
    img,
    plan.source.x,
    plan.source.y,
    plan.source.w,
    plan.source.h,
    plan.dest.x,
    plan.dest.y,
    plan.dest.w,
    plan.dest.h,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      format,
      quality,
    )
  })
}
