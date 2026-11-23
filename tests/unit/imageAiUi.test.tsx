import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageAiTool } from '@/components/image-ai/ImageAiTool'
import type { ImageRequest, ImageResponse } from '@/lib/image-ai/protocol'

class UiWorker {
  static instances: UiWorker[] = []
  onmessage: ((event: { data: ImageResponse }) => void) | null = null
  requests: ImageRequest[] = []
  terminated = false
  constructor() { UiWorker.instances.push(this) }
  postMessage(request: ImageRequest) { this.requests.push(request) }
  terminate() { this.terminated = true }
  reply(data: ImageResponse) { this.onmessage?.({ data }) }
}

let host: HTMLDivElement
let root: Root
const sha256 = 'a'.repeat(64)
const asset = { file: `watermark-${sha256}.onnx`, sha256, bytes: 42 }

beforeEach(() => {
  UiWorker.instances = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Worker', UiWorker)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: { watermark: asset, upscale: asset } }))))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 96, height: 64, close: vi.fn() })))
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:test-image' }
    static revokeObjectURL() {}
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function selectImage(file = new File(['test'], 'photo.png', { type: 'image/png' })) {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

async function pasteFiles(files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files } })
  await act(async () => { document.dispatchEvent(event) })
  return event
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}

describe('separate image tool interfaces', () => {
  it.each(['watermark', 'upscale'] as const)('accepts and replaces clipboard images in %s without intercepting text or pastes while busy or unmounted', async (tool) => {
    await act(async () => root.render(<ImageAiTool tool={tool} />))
    const text = new File(['text'], 'note.txt', { type: 'text/plain' })
    expect((await pasteFiles([text])).defaultPrevented).toBe(false)
    expect(createImageBitmap).not.toHaveBeenCalled()

    const image = new File(['first'], 'clipboard.png', { type: 'image/png' })
    expect((await pasteFiles([text, image])).defaultPrevented).toBe(true)
    expect(createImageBitmap).toHaveBeenLastCalledWith(image)
    expect(host.querySelector('img[alt="Original image"]')).not.toBeNull()
    expect(UiWorker.instances).toHaveLength(0)

    await act(async () => button('Download and load model').click())
    const worker = UiWorker.instances[0]
    const replacement = new File(['second'], 'replacement.png', { type: 'image/png' })
    expect((await pasteFiles([replacement])).defaultPrevented).toBe(false)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    await act(async () => worker.reply({ id: worker.requests[0].id, type: 'ready' }))
    await act(async () => button(tool === 'watermark' ? 'Remove watermark' : 'Upscale image').click())
    expect(worker.requests[1]).toMatchObject({ type: 'process', image })
    expect((await pasteFiles([replacement])).defaultPrevented).toBe(false)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    await act(async () => worker.reply({
      id: worker.requests[1].id, type: 'result',
      result: { blob: new Blob(['png']), width: 192, height: 128, seconds: 1 },
    }))
    expect(host.querySelector('a[download]')).not.toBeNull()

    expect((await pasteFiles([replacement])).defaultPrevented).toBe(true)
    expect(createImageBitmap).toHaveBeenLastCalledWith(replacement)
    expect(host.querySelector('a[download]')).toBeNull()

    await act(async () => root.render(<p>Other tool</p>))
    expect((await pasteFiles([image])).defaultPrevented).toBe(false)
    expect(createImageBitmap).toHaveBeenCalledTimes(2)
  })

  it('only reads the small manifest until download is explicitly requested, then processes the chosen passes', async () => {
    await act(async () => root.render(<ImageAiTool tool="watermark" />))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('models/manifest.json')
    expect(UiWorker.instances).toHaveLength(0)
    await selectImage(new File(['test'], 'not-an-image.txt', { type: 'text/plain' }))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('image')
    await selectImage()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Output: 256 x 171 PNG')
    expect(button('Remove watermark').disabled).toBe(true)
    await act(async () => button('Download and load model').click())
    const worker = UiWorker.instances[0]
    expect(worker.requests[0]).toMatchObject({ type: 'load', tool: 'watermark' })
    await act(async () => worker.reply({ id: worker.requests[0].id, type: 'ready' }))
    const passes = host.querySelector('#watermark-passes') as HTMLSelectElement
    await act(async () => {
      passes.value = '3'
      passes.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(worker.requests).toHaveLength(1)
    await act(async () => button('Remove watermark').click())
    expect(worker.requests[1]).toMatchObject({ type: 'process', passes: 3 })
    await act(async () => worker.reply({
      id: worker.requests[1].id, type: 'result',
      result: { blob: new Blob(['png']), width: 256, height: 171, seconds: 1 },
    }))
    expect(host.querySelector('a[download]')?.getAttribute('download')).toBe('photo-cleaned-3pass.png')
    await act(async () => {
      passes.value = '2'
      passes.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.querySelector('a[download]')).toBeNull()
  })

  it('offers independent upscaling controls and cancels a load by terminating its worker', async () => {
    await act(async () => root.render(<ImageAiTool tool="upscale" />))
    await selectImage()
    expect(host.querySelector('#watermark-passes')).toBeNull()
    const scale = host.querySelector('#upscale-factor') as HTMLSelectElement
    await act(async () => {
      scale.value = '3'
      scale.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.textContent).toContain('Output: 288 x 192 PNG')
    await act(async () => button('Download and load model').click())
    const worker = UiWorker.instances[0]
    expect(worker.requests[0]).toMatchObject({ type: 'load', tool: 'upscale' })
    await act(async () => button('Cancel').click())
    expect(worker.terminated).toBe(true)
    expect(button('Upscale image').disabled).toBe(true)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
