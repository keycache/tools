import { ASSETS, ENGINE_ASSETS, loadAsset, pruneOldCaches, type AssetId, type ModelId, type Progress } from './assets'
import { CactusEngine, type CactusModule } from './engine'
import type { WorkerRequest, WorkerResponse } from './protocol'

type CreateCactus = (opts: { wasmBinary: ArrayBuffer }) => Promise<CactusModule>

// The app tsconfig uses the DOM lib; adding the WebWorker lib would clash, so type just what we use.
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

const scope = self as unknown as WorkerScope
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(msg, transfer)

let enginePromise: Promise<CactusEngine> | null = null
const modelPromises = new Map<ModelId, Promise<void>>()

/** Loads assets in order, reporting one combined progress figure. */
async function fetchAll(ids: AssetId[], onProgress: (p: Progress) => void): Promise<Uint8Array[]> {
  const total = ids.reduce((sum, id) => sum + ASSETS[id].bytes, 0)
  let done = 0
  let fromCache = true
  const out: Uint8Array[] = []
  for (const id of ids) {
    const bytes = await loadAsset(id, (p) => {
      fromCache &&= p.fromCache
      onProgress({ loaded: done + p.loaded, total, fromCache })
    })
    done += bytes.byteLength
    out.push(bytes)
  }
  return out
}

async function instantiate(js: Uint8Array, wasm: Uint8Array): Promise<CactusEngine> {
  // cactus.js is a UMD/CommonJS Emscripten glue script. Import it as an ES module
  // from a blob so it can come from Cache Storage instead of a network <script>.
  const source = new TextDecoder().decode(js) + '\nexport default createCactus;\n'
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default: CreateCactus }
    const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer
    return new CactusEngine(await mod.default({ wasmBinary }))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadModel(model: ModelId, onProgress: (p: Progress) => void): Promise<void> {
  let pending = modelPromises.get(model)
  if (!pending) {
    // The first model also pulls the engine (glue + wasm) in the same progress bar.
    // enginePromise is assigned synchronously so concurrent loads share it.
    let assets: Promise<Uint8Array[]>
    if (!enginePromise) {
      assets = fetchAll([...ENGINE_ASSETS, model], onProgress)
      enginePromise = assets.then(([js, wasm]) => instantiate(js, wasm))
      enginePromise.catch(() => (enginePromise = null))
    } else {
      assets = fetchAll([model], onProgress)
    }
    const engineReady = enginePromise
    pending = assets.then(async (files) => {
      ;(await engineReady).load(files[files.length - 1])
    })
    modelPromises.set(model, pending)
    pending.catch(() => modelPromises.delete(model))
  }
  return pending
}

async function engine(): Promise<CactusEngine> {
  if (!enginePromise) throw new Error('No model loaded yet')
  return enginePromise
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'load':
      await loadModel(msg.model, (progress) => post({ id: msg.id, type: 'progress', model: msg.model, progress }))
      return { models: (await engine()).models() }
    case 'complete':
      return (await engine()).complete(msg.req)
    case 'transcribe':
      return (await engine()).transcribe(msg.pcm, msg.opts)
    case 'describe':
      return (await engine()).describe(msg.rgb, msg.width, msg.height, msg.options, msg.language)
  }
}

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const start = performance.now()
  try {
    const result = await handle(e.data)
    post({ id: e.data.id, type: 'ok', result, ms: performance.now() - start })
  } catch (err) {
    post({ id: e.data.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

void pruneOldCaches().catch(() => {})
