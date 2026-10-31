// Image compression utilities using Canvas API

export type ImageFormat = 'jpeg' | 'png' | 'webp'

export interface CompressionSettings {
  format: ImageFormat
  quality: number // 1-100
}

// Convert image file to canvas
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) reject(new Error('Failed to get canvas context'))
        ctx!.drawImage(img, 0, 0)
        resolve(canvas)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// Compress image: Convert to JPEG first, then to target format
export async function compressImage(
  file: File,
  settings: CompressionSettings
): Promise<{ blob: Blob; size: number }> {
  const canvas = await fileToCanvas(file)

  // Step 1: Convert to JPEG (intermediate step for all formats)
  const jpegBlob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', settings.quality / 100)
  })

  // Step 2: If target format is JPEG, return it directly
  if (settings.format === 'jpeg') {
    return {
      blob: jpegBlob,
      size: jpegBlob.size,
    }
  }

  // Step 3: Convert JPEG to target format (PNG or WebP)
  const mimeType =
    settings.format === 'png' ? 'image/png' : settings.format === 'webp' ? 'image/webp' : 'image/jpeg'

  const targetBlob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), mimeType, settings.quality / 100)
  })

  return {
    blob: targetBlob,
    size: targetBlob.size,
  }
}

// Format bytes to human readable size
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

// Get file extension from format
export function getFileExtension(format: ImageFormat): string {
  return format
}
