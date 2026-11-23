import type { ImageDevice, ImageScale, ImageTool, ModelAsset } from './models'
import type { ImageRequest, ImageResponse, ImageResult } from './protocol'

export interface ImageModelState {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'error'
  progress?: string
  error?: string
  warning?: string
}
type RequestWithoutId = ImageRequest extends infer R ? R extends ImageRequest ? Omit<R, 'id'> : never : never

export class ImageModelClient {
  private worker: Worker | null = null
  private nextId = 0
  private pending: { id: number; resolve: (message: ImageResponse) => void; reject: (error: Error) => void } | null = null
  private state: ImageModelState = { status: 'idle' }
  private listeners = new Set<() => void>()
  private readonly tool: ImageTool

  constructor(tool: ImageTool) { this.tool = tool }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getState = () => this.state
  private set(state: ImageModelState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }

  private call(request: RequestWithoutId): Promise<ImageResponse> {
    if (this.pending) return Promise.reject(new Error('Wait for the current operation to finish.'))
    if (!this.worker) {
      const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: `image-${this.tool}` })
      this.worker = worker
      worker.onmessage = ({ data }: MessageEvent<ImageResponse>) => {
        if (this.worker !== worker) return
        if (data.type === 'error') {
          if (data.id !== 0 && data.id !== this.pending?.id) return
          this.fail(data.message)
        } else if (data.id === this.pending?.id) {
          if (data.type === 'progress') this.set({ ...this.state, progress: data.message })
          else {
            const pending = this.pending
            this.pending = null
            pending.resolve(data)
          }
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        if (this.worker === worker) this.fail(event.message || 'The image worker crashed. Reload the model.')
      }
      worker.onmessageerror = () => { if (this.worker === worker) this.fail('Could not read the image worker response.') }
    }
    const worker = this.worker
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject }
      worker.postMessage({ ...request, id })
    })
  }

  private fail(message: string) {
    this.worker?.terminate()
    this.worker = null
    this.pending?.reject(new Error(message))
    this.pending = null
    this.set({ status: 'error', error: message })
  }

  async load(asset: ModelAsset, device: ImageDevice): Promise<void> {
    this.set({ status: 'loading', progress: 'Starting model download...' })
    try {
      const response = await this.call({ type: 'load', tool: this.tool, asset, device })
      if (response.type !== 'ready') throw new Error('Unexpected model loading response.')
      this.set({ status: 'ready', warning: response.warning })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      this.fail(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async process(image: Blob, passes: number, scale: ImageScale): Promise<ImageResult> {
    if (this.state.status !== 'ready') throw new Error('Load the model before processing an image.')
    const warning = this.state.warning
    this.set({ status: 'running', progress: 'Reading image...', warning })
    try {
      const response = await this.call({ type: 'process', image, passes, scale })
      if (response.type !== 'result') throw new Error('Unexpected image processing response.')
      this.set({ status: 'ready', warning })
      return response.result
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      this.fail(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  dispose = () => {
    this.worker?.terminate()
    this.worker = null
    this.pending?.reject(new DOMException('Operation cancelled.', 'AbortError'))
    this.pending = null
    this.set({ status: 'idle' })
  }
}
