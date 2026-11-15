import type { env as TransformersEnv } from '@huggingface/transformers'

/**
 * Returns a function that subscribes once to the WebGPU device ONNX Runtime created, and calls `onLost` when it is
 * lost (driver reset, GPU OOM, tab killed by the GPU process) — also while idle, so the UI can offer a reload
 * instead of failing on the next request. `destroyed` is our own dispose and is ignored. Call after a WebGPU load.
 */
export function createDeviceWatch(env: typeof TransformersEnv, onLost: (message: string) => void): () => Promise<void> {
  let watching = false
  return async () => {
    if (watching) return
    watching = true
    const webgpu = (env.backends.onnx as { webgpu?: { device?: Promise<GPUDevice> | GPUDevice } }).webgpu
    const device = await Promise.race([Promise.resolve(webgpu?.device), new Promise<undefined>((r) => setTimeout(r, 2000))]).catch(() => undefined)
    if (!device) {
      watching = false
      return
    }
    void device.lost.then((info) => {
      watching = false
      if (info.reason === 'destroyed') return
      onLost(`The GPU stopped responding${info.message ? ` (${info.message})` : ''}. Close other GPU-heavy tabs, then reload the model.`)
    })
  }
}
