import type { ImageScale } from './models'

export interface Size { width: number; height: number }
export interface RgbTensor extends Size { data: Float32Array<ArrayBuffer> }
export type InferImage = (image: RgbTensor) => Promise<RgbTensor>
export const MAX_UPSCALE_PIXELS = 4_194_304
export const MAX_INPUT_PIXELS = 16_777_216

export function watermarkSize(width: number, height: number): Size {
  const longest = Math.max(width, height)
  return { width: Math.max(1, Math.round(256 * width / longest)), height: Math.max(1, Math.round(256 * height / longest)) }
}

export function upscaleSize(width: number, height: number, scale: ImageScale): Size {
  if (![2, 3, 4].includes(scale)) throw new Error('Scale must be 2, 3, or 4.')
  const intermediate = scale === 2 ? 2 : 4
  if (width * height * intermediate ** 2 > MAX_UPSCALE_PIXELS || Math.max(width, height) * intermediate > 8192) {
    throw new Error('This image and scale exceed the browser safety limit (4 megapixels or 8192 pixels per edge during processing). Use a smaller image or scale.')
  }
  return { width: width * scale, height: height * scale }
}

export function rgbaToTensor(rgba: Uint8ClampedArray, width: number, height: number): RgbTensor {
  const plane = width * height
  const data = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    const alpha = rgba[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) data[c * plane + i] = (rgba[i * 4 + c] * alpha + 255 * (1 - alpha)) / 255
  }
  return { data, width, height }
}

export function tensorToRgba(tensor: RgbTensor): Uint8ClampedArray<ArrayBuffer> {
  const plane = tensor.width * tensor.height
  if (tensor.data.length !== plane * 3) throw new Error('Unexpected image tensor size.')
  const rgba = new Uint8ClampedArray(plane * 4)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const value = tensor.data[c * plane + i]
      if (!Number.isFinite(value)) throw new Error('The model produced invalid pixel values.')
      rgba[i * 4 + c] = Math.round(Math.max(0, Math.min(1, value)) * 255)
    }
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

function symmetricIndex(index: number, length: number): number {
  const wrapped = index % (length * 2)
  return wrapped < length ? wrapped : length * 2 - wrapped - 1
}

export async function upscaleTiled(image: RgbTensor, infer: InferImage, progress: (done: number, total: number) => void, tileSize = 128, overlap = 16): Promise<RgbTensor> {
  const { width, height } = image
  const result = { width: width * 2, height: height * 2, data: new Float32Array(width * height * 12) }
  const total = Math.ceil(width / tileSize) * Math.ceil(height / tileSize)
  let done = 0
  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      const bottom = Math.min(top + tileSize, height), right = Math.min(left + tileSize, width)
      const y0 = Math.max(0, top - overlap), x0 = Math.max(0, left - overlap)
      const ph = Math.min(height, bottom + overlap) - y0, pw = Math.min(width, right + overlap) - x0
      // Swin2SR adds a full window even when a dimension is already divisible by 8.
      const h = ph + 8 - ph % 8, w = pw + 8 - pw % 8
      const data = new Float32Array(w * h * 3)
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) data[c * w * h + y * w + x] = image.data[c * width * height + (y0 + symmetricIndex(y, ph)) * width + x0 + symmetricIndex(x, pw)]
        }
      }
      const output = await infer({ data, width: w, height: h })
      if (output.width !== w * 2 || output.height !== h * 2 || output.data.length !== w * h * 12) throw new Error('Unexpected upscaler output shape.')
      for (let c = 0; c < 3; c++) {
        for (let y = top * 2; y < bottom * 2; y++) {
          const start = c * output.width * output.height + (y - y0 * 2) * output.width + (left - x0) * 2
          result.data.set(output.data.subarray(start, start + (right - left) * 2), c * result.width * result.height + y * result.width + left * 2)
        }
      }
      progress(++done, total)
    }
  }
  return result
}
