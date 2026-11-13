export const SAMPLE_RATE = 16_000
/** Longer images are downscaled; Mirage reports coordinates on a 0–1000 scale, so this doesn't affect output geometry. */
export const MAX_IMAGE_SIDE = 1024

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0].slice()
  const out = new Float32Array(channels[0].length)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i]
  for (let i = 0; i < out.length; i++) out[i] /= channels.length
  return out
}

export const AUDIO_ACCEPT = '.wav,.wave,audio/wav,audio/x-wav,audio/*,video/*'
const AUDIO_EXTENSIONS = /\.(wav|wave|mp3|m4a|aac|ogg|oga|opus|flac|webm|mp4|mov)$/i

/** Some OSes report .wav with an empty or odd MIME type, so fall back to the extension. */
export function isAudioFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXTENSIONS.test(file.name)
}

/** Decodes any browser-supported audio (wav, mp3, m4a, webm/opus, …) to 16 kHz mono float PCM. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer()
  // decodeAudioData resamples to the context's rate, so a 16 kHz context does the resampling for us.
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const buffer = await ctx.decodeAudioData(data)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return mixToMono(channels)
}

export interface Recorder {
  stop: () => Promise<Blob>
  cancel: () => void
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const release = () => stream.getTracks().forEach((t) => t.stop())
  recorder.start()
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: recorder.mimeType }))
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = release
      if (recorder.state !== 'inactive') recorder.stop()
      else release()
    },
  }
}

/** Drops the alpha channel from canvas ImageData. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixels = rgba.length / 4
  const out = new Uint8Array(pixels * 3)
  for (let i = 0, j = 0; i < pixels; i++, j += 3) {
    out[j] = rgba[i * 4]
    out[j + 1] = rgba[i * 4 + 1]
    out[j + 2] = rgba[i * 4 + 2]
  }
  return out
}

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface RgbImage {
  rgb: Uint8Array
  width: number
  height: number
}

export async function imageToRgb(file: Blob, maxSide = MAX_IMAGE_SIDE): Promise<RgbImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D is not available')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return { rgb: rgbaToRgb(ctx.getImageData(0, 0, width, height).data), width, height }
  } finally {
    bitmap.close()
  }
}

/** Mirage polygons are flat [x0, y0, x1, y1, …] lists on a 0–1000 scale; `sx`/`sy` rescale each axis. */
export function polygonPoints(flat: number[], sx = 1, sy = 1): string {
  const pts: string[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push(`${flat[i] * sx},${flat[i + 1] * sy}`)
  return pts.join(' ')
}

/** Mirage boxes are [x1, y1, x2, y2] on a 0–1000 scale. */
export function boxRect(bbox: number[]): { x: number; y: number; width: number; height: number } {
  const [x1, y1, x2, y2] = bbox
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
