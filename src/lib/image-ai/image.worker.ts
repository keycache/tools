import * as ort from 'onnxruntime-web/webgpu'
import { ORT_RUNTIME_URLS } from '@/lib/transformers/runtime'
import { describeCacheFailures } from '@/lib/transformers/errors'
import { isOpfsSupported, OpfsModelCache, opfsDir } from '@/lib/transformers/opfsCache'
import { IMAGE_MODELS, modelDirectory, modelUrl, type ImageTool, type ModelAsset } from './models'
import { MAX_INPUT_PIXELS, rgbaToTensor, tensorToRgba, upscaleSize, upscaleTiled, watermarkSize, type RgbTensor } from './processing'
import type { ImageRequest, ImageResponse, ImageResult } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ImageRequest>) => void) | null
  postMessage(message: ImageResponse): void
}
const scope: WorkerScope = self
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { ...ORT_RUNTIME_URLS }
let model: ort.InferenceSession | null = null
let tool: ImageTool | null = null
let busy = false
let generation = 0

const progress = (id: number, message: string) => scope.postMessage({ id, type: 'progress', message })

async function verify(buffer: ArrayBuffer, asset: ModelAsset): Promise<void> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (buffer.byteLength !== asset.bytes || hex !== asset.sha256) throw new Error('Model checksum mismatch. Delete the downloaded model and reload it.')
}

async function load(request: Extract<ImageRequest, { type: 'load' }>): Promise<void> {
  const { id, asset } = request
  if (model) throw new Error('Unload the current model before loading another.')
  const cache = isOpfsSupported() ? new OpfsModelCache(opfsDir(modelDirectory(request.tool))) : null
  const url = modelUrl(asset)
  progress(id, 'Checking downloaded model...')
  const hit = await cache?.match(url)
  let buffer: ArrayBuffer
  if (hit) {
    buffer = await hit.arrayBuffer()
    await verify(buffer, asset)
  } else {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}). Retry, or rebuild the model assets.`)
    if (!response.body) throw new Error('The model download has no response body.')
    const bytes = new Uint8Array(asset.bytes)
    const reader = response.body.getReader()
    let loaded = 0, last = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (loaded + value.length > bytes.length) throw new Error('Downloaded model is larger than expected.')
        bytes.set(value, loaded)
        loaded += value.length
        if (performance.now() - last > 100 || loaded === bytes.length) {
          progress(id, `Downloading model: ${(loaded / 1e6).toFixed(1)} / ${(bytes.length / 1e6).toFixed(1)} MB`)
          last = performance.now()
        }
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    buffer = bytes.buffer
    await verify(buffer, asset)
    if (cache) {
      try {
        await cache.put(url, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } }))
      } catch (error) {
        // OpfsModelCache records write errors; report that inference is session-only below.
        if (!cache.failures.length) throw error
      }
    }
  }
  progress(id, `Initializing ${request.device === 'webgpu' ? 'WebGPU' : 'CPU'} runtime (first load also downloads about 30 MB of runtime assets)...`)
  model = await ort.InferenceSession.create(buffer, { executionProviders: [request.device], graphOptimizationLevel: 'all' })
  tool = request.tool
  if (model.inputNames.length !== 1 || model.outputNames.length !== 1) throw new Error('Unexpected model inputs or outputs.')
  const currentGeneration = ++generation
  if (request.device === 'webgpu') {
    void Promise.resolve(ort.env.webgpu.device).then((device) => device.lost.then((info) => {
      if (generation !== currentGeneration || info.reason === 'destroyed') return
      model = null
      scope.postMessage({ id: 0, type: 'error', message: `The GPU stopped responding. Unload and reload the model, or select CPU. ${info.message}` })
    }))
  }
  const warning = cache
    ? describeCacheFailures(cache.failures, IMAGE_MODELS[request.tool].name)
    : 'Model storage is unavailable in this browser. The model is loaded for this session only.'
  scope.postMessage({ id, type: 'ready', warning })
}

function canvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height)
}

function context(surface: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = surface.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser does not support offscreen image processing.')
  return ctx
}

function read(surface: OffscreenCanvas): RgbTensor {
  return rgbaToTensor(context(surface).getImageData(0, 0, surface.width, surface.height).data, surface.width, surface.height)
}

function draw(image: RgbTensor): OffscreenCanvas {
  const result = canvas(image.width, image.height)
  context(result).putImageData(new ImageData(tensorToRgba(image), image.width, image.height), 0, 0)
  return result
}

function resize(source: OffscreenCanvas | ImageBitmap, width: number, height: number): OffscreenCanvas {
  const result = canvas(width, height)
  const ctx = context(result)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return result
}

async function infer(image: RgbTensor): Promise<RgbTensor> {
  if (!model) throw new Error('Load the model before processing an image.')
  const input = new ort.Tensor('float32', image.data, [1, 3, image.height, image.width])
  let outputs: ort.InferenceSession.ReturnType | undefined
  try {
    outputs = await model.run({ [model.inputNames[0]]: input })
    const output = outputs[model.outputNames[0]]
    if (output.type !== 'float32' || !(output.data instanceof Float32Array) || output.dims.length !== 4 || output.dims[0] !== 1 || output.dims[1] !== 3) throw new Error('Unexpected model image output.')
    return { data: new Float32Array(output.data), width: output.dims[3], height: output.dims[2] }
  } finally {
    input.dispose()
    if (outputs) Object.values(outputs).forEach((tensor) => tensor.dispose())
  }
}

async function processImage(request: Extract<ImageRequest, { type: 'process' }>): Promise<ImageResult> {
  if (!model || !tool) throw new Error('Load the model before processing an image.')
  if (!Number.isInteger(request.passes) || request.passes < 1 || request.passes > 5) throw new Error('Passes must be between 1 and 5.')
  const start = performance.now()
  const bitmap = await createImageBitmap(request.image)
  let result: OffscreenCanvas
  try {
    const { width, height } = bitmap
    if (width * height > MAX_INPUT_PIXELS) throw new Error('Input images are limited to 16 megapixels. Resize the image first.')
    if (tool === 'watermark') {
      result = resize(bitmap, 256, 256)
      for (let pass = 1; pass <= request.passes; pass++) {
        progress(request.id, `Removing watermark: pass ${pass}/${request.passes}`)
        const output = await infer(read(result))
        if (output.width !== 256 || output.height !== 256) throw new Error('Unexpected watermark model dimensions.')
        result = draw(output)
      }
      const size = watermarkSize(width, height)
      result = resize(result, size.width, size.height)
    } else {
      const size = upscaleSize(width, height, request.scale)
      result = resize(bitmap, width, height)
      const passes = request.scale === 2 ? 1 : 2
      for (let pass = 1; pass <= passes; pass++) {
        const output = await upscaleTiled(read(result), infer, (done, total) => progress(request.id, `Upscaling: pass ${pass}/${passes}, tile ${done}/${total}`))
        result = draw(output)
      }
      if (result.width !== size.width || result.height !== size.height) result = resize(result, size.width, size.height)
    }
  } finally {
    bitmap.close()
  }
  const blob = await result.convertToBlob({ type: 'image/png' })
  return { blob, width: result.width, height: result.height, seconds: (performance.now() - start) / 1000 }
}

scope.onmessage = async ({ data }) => {
  if (busy) {
    scope.postMessage({ id: data.id, type: 'error', message: 'Image processing is already busy.' })
    return
  }
  busy = true
  try {
    if (data.type === 'load') await load(data)
    else scope.postMessage({ id: data.id, type: 'result', result: await processImage(data) })
  } catch (error) {
    scope.postMessage({ id: data.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    busy = false
  }
}
