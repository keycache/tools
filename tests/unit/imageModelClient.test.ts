import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageModelClient } from '@/lib/image-ai/client'
import type { ImageRequest, ImageResponse } from '@/lib/image-ai/protocol'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: ImageResponse }) => void) | null = null
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  requests: ImageRequest[] = []
  terminated = false
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: ImageRequest) { this.requests.push(message) }
  terminate() { this.terminated = true }
  reply(data: ImageResponse) { this.onmessage?.({ data }) }
}

const asset = { file: `watermark-${'a'.repeat(64)}.onnx`, sha256: 'a'.repeat(64), bytes: 42 }
beforeEach(() => {
  TestWorker.instances = []
  vi.stubGlobal('Worker', TestWorker)
})
afterEach(() => vi.unstubAllGlobals())

describe('image model worker lifecycle', () => {
  it('does not create a worker until explicitly loaded, then handles progress and results', async () => {
    const client = new ImageModelClient('watermark')
    expect(TestWorker.instances).toHaveLength(0)
    const loading = client.load(asset, 'wasm')
    const worker = TestWorker.instances[0]
    const id = worker.requests[0].id
    worker.reply({ id, type: 'progress', message: 'Downloading...' })
    expect(client.getState().progress).toBe('Downloading...')
    worker.reply({ id, type: 'ready', warning: 'Session only.' })
    await loading
    const processing = client.process(new Blob(), 3, 2)
    expect(worker.requests[1]).toMatchObject({ type: 'process', passes: 3 })
    const result = { blob: new Blob(), width: 256, height: 144, seconds: 1 }
    worker.reply({ id: worker.requests[1].id, type: 'result', result })
    expect(await processing).toEqual(result)
    expect(client.getState()).toMatchObject({ status: 'ready', warning: 'Session only.' })
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancels pending work, rejects it explicitly, and ignores stale worker messages', async () => {
    const client = new ImageModelClient('upscale')
    const pending = client.load(asset, 'webgpu')
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const oldWorker = TestWorker.instances[0]
    client.dispose()
    await rejected
    const next = client.load(asset, 'wasm')
    oldWorker.reply({ id: 0, type: 'error', message: 'stale GPU loss' })
    expect(client.getState().status).toBe('loading')
    const worker = TestWorker.instances[1]
    worker.reply({ id: worker.requests[0].id, type: 'ready' })
    await next
    expect(client.getState().status).toBe('ready')
    client.dispose()
  })

  it('surfaces GPU loss even while idle and permits a fresh load', async () => {
    const client = new ImageModelClient('watermark')
    const loading = client.load(asset, 'webgpu')
    const worker = TestWorker.instances[0]
    worker.reply({ id: worker.requests[0].id, type: 'ready' })
    await loading
    worker.reply({ id: 0, type: 'error', message: 'GPU lost' })
    expect(client.getState()).toMatchObject({ status: 'error', error: 'GPU lost' })
    expect(worker.terminated).toBe(true)
    const retry = client.load(asset, 'wasm')
    const replacement = TestWorker.instances[1]
    replacement.reply({ id: replacement.requests[0].id, type: 'ready' })
    await retry
    client.dispose()
  })
})
