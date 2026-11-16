import { AutoConfig, AutoProcessor, ChatterboxModel, InterruptableStoppingCriteria, Tensor, env } from '@huggingface/transformers'
import { createDeviceWatch } from '@/lib/transformers/device'
import { classifyError, describeCacheFailures } from '@/lib/transformers/errors'
import { OpfsModelCache } from '@/lib/transformers/opfsCache'
import { configureTransformers } from '@/lib/transformers/runtime'
import { parseWav, resample, trimTo } from './audio'
import { splitInHalf } from './chunk'
import { ttsDir } from './cache'
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_URL,
  MAX_NEW_TOKENS,
  MAX_REFERENCE_SECONDS,
  SAMPLE_RATE,
  TTS_MODEL_ID,
  TTS_REVISION,
  pinTtsRevision,
  ttsDtypeMap,
  type TtsDevice,
  type TtsDtype,
} from './constants'
import type { TtsErrorCode, TtsRequest, TtsResponse } from './protocol'
import type { ChunkStats, SynthChunk } from './types'

// The app's tsconfig uses the DOM lib; type only the worker globals we use.
interface WorkerScope {
  postMessage(message: TtsResponse, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<TtsRequest>) => void) | null
}
const scope = self as unknown as WorkerScope
const post = (msg: TtsResponse, transfer?: Transferable[]) => scope.postMessage(msg, transfer)

const cache = new OpfsModelCache(ttsDir, pinTtsRevision)
configureTransformers(env, cache)

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
// from_pretrained is typed as returning PreTrainedModel; the instance is a ChatterboxModel.
type Model = ChatterboxModel
/** encode_speech output: audio_features, audio_tokens, speaker_embeddings, speaker_features. */
type Speaker = Record<string, Tensor>

let processor: Processor | null = null
let model: Model | null = null
let loading: Promise<void> | null = null
const speakers = new Map<string, Speaker>()
/** The one running job (synthesize or encodeVoice); synthesize can be interrupted. */
let current: { id: number; criteria?: InterruptableStoppingCriteria } | null = null

const PROGRESS_FLUSH_MS = 150
/** Silence between the two halves of a re-split chunk (a sentence-internal pause). */
const RESPLIT_GAP_SECONDS = 0.1

const watchDevice = createDeviceWatch(env, (message) => {
  model = null
  processor = null
  loading = null
  speakers.clear()
  post({ id: 0, type: 'lost', message })
})

function coded(code: 'not-loaded' | 'no-voice' | 'busy', message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Reads a repo file through the model cache (so it works offline), downloading and storing it on a miss. */
async function fetchCached(url: string): Promise<ArrayBuffer> {
  const hit = await cache.match(url)
  if (hit) return hit.arrayBuffer()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = await res.arrayBuffer()
  // A failed write is recorded in cache.failures and reported with `ready`; the voice still works this session.
  await cache.put(url, new Response(buf, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'audio/wav' } })).catch(() => {})
  return buf
}

async function encode(voiceId: string, pcm: Float32Array): Promise<void> {
  if (!model) throw coded('not-loaded', 'Load the model first.')
  const clip = trimTo(pcm, SAMPLE_RATE, MAX_REFERENCE_SECONDS)
  const speaker = (await model.encode_speech(new Tensor('float32', clip, [1, clip.length]))) as unknown as Speaker
  speakers.set(voiceId, speaker)
}

function load(id: number, device: TtsDevice, dtype: TtsDtype): Promise<void> {
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
      processor = await AutoProcessor.from_pretrained(TTS_MODEL_ID, { revision: TTS_REVISION, progress_callback })
      // The repo's config.json has no `architectures`, so Transformers.js 4.3.2's progress-total pass can't resolve
      // the model type and probes a non-existent onnx/model.onnx(_data) — a wasted request on every load (and a
      // failed one offline). Naming the class lets it list the real session files instead.
      const config = await AutoConfig.from_pretrained(TTS_MODEL_ID, { revision: TTS_REVISION })
      Object.assign(config, { architectures: ['ChatterboxModel'] })
      model = (await ChatterboxModel.from_pretrained(TTS_MODEL_ID, {
        config,
        revision: TTS_REVISION,
        dtype: ttsDtypeMap(dtype) as never,
        device,
        progress_callback,
      })) as ChatterboxModel
      const voice = parseWav(await fetchCached(DEFAULT_VOICE_URL))
      await encode(DEFAULT_VOICE_ID, resample(voice.pcm, voice.sampleRate, SAMPLE_RATE))
    })()
    // Concurrent loads share this promise; a failure clears it so Retry starts fresh.
    loading.catch(() => {
      loading = null
      processor = null
      model = null
      speakers.clear()
    })
  }
  return loading
}

async function synthesize(id: number, chunks: SynthChunk[]): Promise<void> {
  const mdl = model
  const proc = processor
  if (!mdl || !proc) throw coded('not-loaded', 'Load the model first.')
  // Check every voice up front, so a missing one fails before any audio (the client re-encodes and retries).
  const voices = chunks.map(({ voiceId }) => {
    const speaker = speakers.get(voiceId)
    if (!speaker) throw coded('no-voice', `Voice "${voiceId}" isn't loaded.`)
    return speaker
  })
  const criteria = new InterruptableStoppingCriteria()
  current = { id, criteria }
  const started = performance.now()
  let firstAudioMs = 0
  let audioSeconds = 0
  let done = 0
  try {
    // One generate call: the waveform and how many speech tokens it took (null if Stop interrupted it).
    const generateOne = async (text: string, exaggeration: number, speaker: Speaker): Promise<{ pcm: Float32Array; tokens: number } | null> => {
      const inputs = await proc(text)
      let calls = 0
      // generate() calls put() once for the prompt, then once per generated token.
      const streamer = { put: () => void calls++, end: () => {} }
      const waveform = (await mdl.generate({
        ...inputs,
        ...speaker,
        exaggeration,
        max_new_tokens: MAX_NEW_TOKENS,
        stopping_criteria: criteria,
        streamer,
      } as never)) as unknown as Tensor
      // Interrupted mid-chunk: the decoder ran on partial tokens — drop that audio.
      if (criteria.interrupted) return null
      return { pcm: new Float32Array(waveform.data as Float32Array), tokens: Math.max(0, calls - 1) }
    }

    for (let index = 0; index < chunks.length && !criteria.interrupted; index++) {
      const t = performance.now()
      const { text, exaggeration } = chunks[index]
      const speaker = voices[index]
      let result = await generateOne(text, exaggeration, speaker)
      if (!result) break
      let hitCap = result.tokens >= MAX_NEW_TOKENS
      let resplit = false
      // Hit the token cap: the speech is probably cut off. Regenerate it once as two halves and join them.
      const halves = hitCap ? splitInHalf(text) : null
      if (halves) {
        const a = await generateOne(halves[0], exaggeration, speaker)
        const b = a && (await generateOne(halves[1], exaggeration, speaker))
        if (!a || !b) break
        const gap = Math.round(RESPLIT_GAP_SECONDS * SAMPLE_RATE)
        const pcm = new Float32Array(a.pcm.length + gap + b.pcm.length)
        pcm.set(a.pcm)
        pcm.set(b.pcm, a.pcm.length + gap)
        result = { pcm, tokens: a.tokens + b.tokens }
        hitCap = a.tokens >= MAX_NEW_TOKENS || b.tokens >= MAX_NEW_TOKENS
        resplit = true
      }
      const { pcm, tokens } = result
      const seconds = pcm.length / SAMPLE_RATE
      const stats: ChunkStats = { chars: text.length, speechTokens: tokens, hitCap, resplit, ms: Math.round(performance.now() - t), audioSeconds: seconds }
      if (!firstAudioMs) firstAudioMs = Math.round(performance.now() - started)
      audioSeconds += seconds
      done++
      post({ id, type: 'chunk', index, total: chunks.length, pcm, stats }, [pcm.buffer])
    }
  } finally {
    current = null
  }
  const ms = Math.round(performance.now() - started)
  post({ id, type: 'done', stopped: criteria.interrupted, stats: { chunks: done, ms, firstAudioMs, audioSeconds, rtf: audioSeconds > 0 ? ms / 1000 / audioSeconds : 0 } })
}

scope.onmessage = async (e: MessageEvent<TtsRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        await load(msg.id, msg.device, msg.dtype)
        if (msg.device === 'webgpu') void watchDevice()
        post({ id: msg.id, type: 'ready', cacheWarning: describeCacheFailures(cache.failures, 'Speak') })
        return
      case 'encodeVoice': {
        if (current) throw coded('busy', 'Speech is being generated — stop it first.')
        current = { id: msg.id }
        const t = performance.now()
        try {
          await encode(msg.voiceId, msg.pcm)
        } finally {
          current = null
        }
        post({ id: msg.id, type: 'voice', voiceId: msg.voiceId, ms: Math.round(performance.now() - t) })
        return
      }
      case 'encodeBuiltin': {
        const t = performance.now()
        if (!speakers.has(msg.voiceId)) {
          if (current) throw coded('busy', 'Speech is being generated — stop it first.')
          current = { id: msg.id }
          try {
            const clip = parseWav(await fetchCached(msg.url))
            await encode(msg.voiceId, resample(clip.pcm, clip.sampleRate, SAMPLE_RATE))
          } finally {
            current = null
          }
        }
        post({ id: msg.id, type: 'voice', voiceId: msg.voiceId, ms: Math.round(performance.now() - t) })
        return
      }
      case 'synthesize':
        if (current) throw coded('busy', 'Speech is already being generated.')
        await synthesize(msg.id, msg.chunks)
        return
      case 'stop':
        current?.criteria?.interrupt()
        return
      case 'unload':
        current?.criteria?.interrupt()
        await model?.dispose()
        model = null
        processor = null
        loading = null
        speakers.clear()
        post({ id: msg.id, type: 'unloaded' })
        return
    }
  } catch (err) {
    const own = (err as { code?: TtsErrorCode }).code
    const { code, message }: { code: TtsErrorCode; message: string } =
      own === 'not-loaded' || own === 'no-voice' || own === 'busy' ? { code: own, message: (err as Error).message } : classifyError(err)
    post({ id: msg.id, type: 'error', code, message })
  }
}
