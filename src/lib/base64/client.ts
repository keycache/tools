import type { Base64Command, Base64Request, Base64Response, Base64Result } from './protocol'

export class Base64Client {
  private worker: Worker | null = null
  private nextId = 0
  private pending: {
    id: number
    resolve: (result: Base64Result) => void
    reject: (error: Error) => void
    progress?: (percent: number) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  run(command: Base64Command, progress?: (percent: number) => void): Promise<Base64Result> {
    if (this.pending) return Promise.reject(new Error('Wait for the current operation to finish.'))
    if (!this.worker) {
      const worker = new Worker(new URL('./base64.worker.ts', import.meta.url), { type: 'module', name: 'base64' })
      this.worker = worker
      worker.onmessage = ({ data }: MessageEvent<Base64Response>) => {
        if (this.worker !== worker || data.id !== this.pending?.id) return
        if (data.type === 'progress') this.pending.progress?.(data.percent)
        else if (data.type === 'error') this.fail(new Error(data.message))
        else {
          const pending = this.pending
          this.pending = null
          clearTimeout(pending.timer)
          pending.resolve(data.result)
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        if (this.worker === worker) this.fail(new Error(event.message || 'The Base64 worker crashed. Please try again.'))
      }
      worker.onmessageerror = () => {
        if (this.worker === worker) this.fail(new Error('Could not read the Base64 worker response.'))
      }
    }
    const worker = this.worker
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Processing exceeded 30 seconds. Try a smaller file.')), 30_000)
      this.pending = { id, resolve, reject, progress, timer }
      try { worker.postMessage({ id, command } satisfies Base64Request) } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private fail(error: Error) {
    this.worker?.terminate()
    this.worker = null
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(error)
      this.pending = null
    }
  }

  cancel = () => this.fail(new DOMException('Operation cancelled.', 'AbortError'))
}
