import { AutoProcessor, Gemma4ForConditionalGeneration, InterruptableStoppingCriteria, RawImage, TextStreamer, env } from '@huggingface/transformers'
import { GEMMA_CONTEXT_TOKENS, GEMMA_MODEL_ID, GEMMA_REVISION, pinGemmaRevision, type GemmaDevice, type GemmaDtype } from './constants'
import { OpfsModelCache } from './opfsCache'
import { classifyError, describeCacheFailures, collectAudio, collectImages, limitAudio, parseOutput, toTemplateMessages, trimTurns } from './conversation'
import type { ChatTurn, GemmaRequest, GemmaResponse, GenSettings } from './protocol'
import { configureTransformers } from './runtime'

// The app's tsconfig uses the DOM lib; type only the worker globals we use.
interface WorkerScope {
  postMessage(message: GemmaResponse): void
  onmessage: ((e: MessageEvent<GemmaRequest>) => void) | null
}
const scope = self as unknown as WorkerScope
const post = (msg: GemmaResponse) => scope.postMessage(msg)

const cache = new OpfsModelCache(undefined, pinGemmaRevision)
configureTransformers(env, cache)

/**
 * Reports a lost GPU device (driver reset, GPU OOM, tab killed by the GPU process) even while idle, so the UI can
 * offer a reload instead of failing on the next message. `destroyed` is our own dispose and is ignored.
 */
let watching = false
async function watchDevice(): Promise<void> {
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
    model = null
    processor = null
    loading = null
    post({ id: 0, type: 'lost', message: `The GPU stopped responding${info.message ? ` (${info.message})` : ''}. Close other GPU-heavy tabs, then reload the model.` })
  })
}

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
type Model = Awaited<ReturnType<typeof Gemma4ForConditionalGeneration.from_pretrained>>

let processor: Processor | null = null
let model: Model | null = null
let loading: Promise<void> | null = null
let current: { id: number; criteria: InterruptableStoppingCriteria } | null = null

const STREAM_FLUSH_MS = 50
const PROGRESS_FLUSH_MS = 150

function load(id: number, device: GemmaDevice, dtype: GemmaDtype): Promise<void> {
  if (model && processor) return Promise.resolve()
  if (!loading) {
    let lastProgress = 0
    const progress_callback = (info: { status: string; loaded?: number; total?: number }) => {
      if (info.status !== 'progress_total') return
      const now = performance.now()
      if (now - lastProgress < PROGRESS_FLUSH_MS && (info.loaded ?? 0) < (info.total ?? 1)) return
      lastProgress = now
      post({ id, type: 'progress', loaded: info.loaded ?? 0, total: info.total ?? 0 })
    }
    loading = (async () => {
      processor = await AutoProcessor.from_pretrained(GEMMA_MODEL_ID, { revision: GEMMA_REVISION, progress_callback })
      model = await Gemma4ForConditionalGeneration.from_pretrained(GEMMA_MODEL_ID, {
        revision: GEMMA_REVISION,
        dtype,
        device,
        progress_callback,
      })
    })()
    // Concurrent loads share this promise; a failure clears it so Retry starts fresh.
    loading.catch(() => {
      loading = null
      processor = null
      model = null
    })
  }
  return loading
}

async function generate(id: number, turns: ChatTurn[], settings: GenSettings): Promise<void> {
  if (!model || !processor) throw Object.assign(new Error('Model is not loaded.'), { code: 'not-loaded' })
  const started = performance.now()
  const tokenizer = processor.tokenizer!
  const budget = GEMMA_CONTEXT_TOKENS - settings.maxNewTokens
  const limited = limitAudio(turns)
  const { kept, dropped } = trimTurns(limited.turns, (t) => tokenizer.encode(t).length, budget)

  const prompt = processor.apply_chat_template(toTemplateMessages(kept) as never, {
    add_generation_prompt: true,
    enable_thinking: settings.thinking,
  } as never) as string
  // Same order as the image placeholders in the prompt (see toTemplateMessages).
  const images = await Promise.all(collectImages(kept).map((blob) => RawImage.fromBlob(blob)))
  const audio = collectAudio(kept)
  const inputs = await processor(prompt, images.length ? images : null, audio ? [audio] : null, { add_special_tokens: false })
  const promptTokens = (inputs.input_ids as { dims: number[] }).dims.at(-1) ?? 0

  let raw = ''
  let newTokens = 0
  let firstTokenAt = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    flushTimer = null
    const parsed = parseOutput(raw)
    post({ id, type: 'stream', answer: parsed.answer, thinking: parsed.thinking })
  }

  // Special tokens are kept so the thinking-channel markers survive; parseOutput strips the rest.
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (text: string) => {
      raw += text
      flushTimer ??= setTimeout(flush, STREAM_FLUSH_MS)
    },
    token_callback_function: () => {
      newTokens++
      if (!firstTokenAt) firstTokenAt = performance.now()
    },
  })

  const criteria = new InterruptableStoppingCriteria()
  current = { id, criteria }
  try {
    const sampling = settings.temperature > 0
    await model.generate({
      ...inputs,
      max_new_tokens: settings.maxNewTokens,
      do_sample: sampling,
      ...(sampling ? { temperature: settings.temperature, top_p: settings.topP, top_k: 64 } : {}),
      streamer,
      stopping_criteria: criteria,
    } as never)
  } finally {
    current = null
    if (flushTimer) clearTimeout(flushTimer)
  }

  const ms = performance.now() - started
  const parsed = parseOutput(raw)
  const decodeMs = firstTokenAt ? performance.now() - firstTokenAt : 0
  post({
    id,
    type: 'done',
    answer: parsed.answer,
    thinking: parsed.thinking,
    stopped: criteria.interrupted,
    stats: {
      promptTokens,
      newTokens,
      ms,
      firstTokenMs: firstTokenAt ? firstTokenAt - started : ms,
      tokensPerSec: decodeMs > 0 && newTokens > 1 ? ((newTokens - 1) / decodeMs) * 1000 : 0,
      trimmedTurns: dropped,
      droppedAudio: limited.dropped,
    },
  })
}

scope.onmessage = async (e: MessageEvent<GemmaRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        await load(msg.id, msg.device, msg.dtype)
        if (msg.device === 'webgpu') void watchDevice()
        post({ id: msg.id, type: 'ready', cacheWarning: describeCacheFailures(cache.failures) })
        return
      case 'generate':
        if (current) {
          post({ id: msg.id, type: 'error', code: 'busy', message: 'A reply is already being generated.' })
          return
        }
        await generate(msg.id, msg.turns, msg.settings)
        return
      case 'stop':
        current?.criteria.interrupt()
        return
      case 'unload':
        current?.criteria.interrupt()
        await model?.dispose()
        model = null
        processor = null
        loading = null
        post({ id: msg.id, type: 'unloaded' })
        return
    }
  } catch (err) {
    const coded = (err as { code?: string }).code
    const { code, message } = coded === 'not-loaded' ? { code: 'not-loaded' as const, message: (err as Error).message } : classifyError(err)
    post({ id: msg.id, type: 'error', code, message })
  }
}
