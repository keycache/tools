import { describe, expect, it } from 'vitest'
import { parseModelManifest } from '@/lib/image-ai/models'
import { MAX_UPSCALE_PIXELS, rgbaToTensor, tensorToRgba, upscaleSize, upscaleTiled, watermarkSize, type RgbTensor } from '@/lib/image-ai/processing'

function nearest2x(image: RgbTensor): RgbTensor {
  const width = image.width * 2, height = image.height * 2
  const data = new Float32Array(width * height * 3)
  for (let c = 0; c < 3; c++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data[c * width * height + y * width + x] = image.data[c * image.width * image.height + Math.floor(y / 2) * image.width + Math.floor(x / 2)]
  }
  return { data, width, height }
}

describe('image AI processing', () => {
  it('fits watermark results into 256 without cropping, including extreme ratios', () => {
    expect(watermarkSize(1920, 1080)).toEqual({ width: 256, height: 144 })
    expect(watermarkSize(1080, 1920)).toEqual({ width: 144, height: 256 })
    expect(watermarkSize(97, 65)).toEqual({ width: 256, height: 172 })
    expect(watermarkSize(1, 1000)).toEqual({ width: 1, height: 256 })
  })

  it('calculates exact scales and enforces the intermediate, not just final, memory threshold', () => {
    expect(upscaleSize(7, 5, 2)).toEqual({ width: 14, height: 10 })
    expect(upscaleSize(7, 5, 3)).toEqual({ width: 21, height: 15 })
    expect(upscaleSize(7, 5, 4)).toEqual({ width: 28, height: 20 })
    expect(upscaleSize(512, 512, 4).width ** 2).toBe(MAX_UPSCALE_PIXELS)
    expect(() => upscaleSize(513, 512, 4)).toThrow('safety limit')
    expect(() => upscaleSize(600, 600, 3)).toThrow('safety limit')
    expect(() => upscaleSize(5000, 1, 2)).toThrow('safety limit')
  })

  it('flattens transparency onto white and converts RGB channels in the correct order', () => {
    const tensor = rgbaToTensor(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1)
    expect([...tensor.data]).toEqual([1, 1, 0, 1, 0, 1])
    expect([...tensorToRgba(tensor)]).toEqual([255, 0, 0, 255, 255, 255, 255, 255])
    tensor.data[0] = NaN
    expect(() => tensorToRgba(tensor)).toThrow('invalid pixel')
  })

  it.each([[37, 25], [1, 1], [16, 16]])('pads and crops contextual tiles without seams or shifts for %ix%i', async (width, height) => {
    const data = Float32Array.from({ length: width * height * 3 }, (_, i) => (i % 251) / 250)
    const image = { data, width, height }
    let completed = 0
    const actual = await upscaleTiled(image, async (patch) => {
      expect(patch.width % 8).toBe(0)
      expect(patch.height % 8).toBe(0)
      return nearest2x(patch)
    }, (done, total) => { completed = done; expect(done).toBeLessThanOrEqual(total) }, 16, 8)
    expect(actual).toEqual(nearest2x(image))
    expect(completed).toBe(Math.ceil(width / 16) * Math.ceil(height / 16))
  })

  it('rejects wrong model shapes instead of filling the result with invalid pixels', async () => {
    await expect(upscaleTiled({ data: new Float32Array(3), width: 1, height: 1 }, async (image) => image, () => {})).rejects.toThrow('output shape')
  })
})

describe('model manifest validation', () => {
  const sha256 = 'a'.repeat(64)
  const asset = { file: `watermark-${sha256}.onnx`, sha256, bytes: 42 }
  it('accepts content-addressed assets and rejects traversal, bad hashes, and invalid sizes', () => {
    expect(parseModelManifest({ models: { watermark: asset, upscale: asset } }).watermark).toEqual(asset)
    for (const invalid of [{ ...asset, file: '../model.onnx' }, { ...asset, sha256: 'b'.repeat(64) }, { ...asset, bytes: 0 }, { ...asset, bytes: 1.5 }]) {
      expect(() => parseModelManifest({ models: { watermark: invalid, upscale: asset } })).toThrow('Invalid')
    }
  })
})
