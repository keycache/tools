import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, Download, Square, VolumeX } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { DeviceSummary, ErrorNote, Stats } from '@/components/edge-ai/shared'
import type { CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { useHiddenWhile } from '@/components/edge-ai/useHiddenWhile'
import { useOnline } from '@/components/edge-ai/useOnline'
import { VoicePicker, type ReferenceClip, type VoiceMode } from '@/components/edge-ai/VoicePicker'
import { encodeWav } from '@/lib/cactus/media'
import type { Capability } from '@/lib/transformers/capability'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { isSilent, joinWithPauses, limitPeak, speechFileName, trimTo } from '@/lib/tts/audio'
import { PAUSE_SECONDS, splitIntoChunks } from '@/lib/tts/chunk'
import { TtsError, tts, useTts, type TtsState } from '@/lib/tts/client'
import {
  DEFAULT_EXAGGERATION,
  DEFAULT_VOICE_BYTES,
  DEFAULT_VOICE_ID,
  EXAGGERATION_RANGE,
  MAX_INPUT_CHARS,
  MAX_REFERENCE_SECONDS,
  SAMPLE_RATE,
  TTS_MODEL_ID,
  ttsTotalBytes,
} from '@/lib/tts/constants'
import { useTtsCapability, type TtsCacheState } from '@/lib/tts/hooks'
import { SpeechPlayer, playbackStartDelay, type PlannedChunk } from '@/lib/tts/playback'
import type { ChunkStats, SynthStats } from '@/lib/tts/types'

interface Props {
  /** Whether the Speak tab is visible (drives auto-load from storage). */
  active: boolean
  /** Becomes true the first time the tab is opened; capability detection only runs from then on. */
  visited: boolean
  cache: TtsCacheState
}

interface Clip {
  id: number
  url: string
  fileName: string
  seconds: number
  synth: SynthStats
  /** Chunks the text was split into (the clip may hold fewer if stopped). */
  total: number
  speechTokens: number
  cutOff: number
  resplit: number
  /** Times playback had to wait for a chunk, and for how long in total. */
  stalls: number
  stallSeconds: number
  stopped: boolean
  backgrounded: boolean
  voice: VoiceMode
}

/** Generation in progress, for the output card. */
interface Live {
  done: number
  total: number
  /** Seconds until playback starts (estimate), null once playing. */
  startsIn: number | null
}

/** The user's reference voice: PCM kept so it can be re-encoded if the worker restarts (e.g. after GPU loss). */
interface CustomVoice {
  id: string
  pcm: Float32Array
  clip: ReferenceClip
  encoded: boolean
}

const MAX_CHARS = MAX_INPUT_CHARS

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function SpeakTab({ active, visited, cache }: Props) {
  const capability = useTtsCapability(visited, cache.ready)
  const state = useTts()
  const online = useOnline()
  const device = capability?.device
  const dtype = capability?.dtype
  const load = useCallback(() => {
    if (device === 'webgpu' && dtype) tts.load(device, dtype).catch(() => {})
  }, [device, dtype])

  const [text, setText] = useState('')
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION)
  const [clip, setClip] = useState<Clip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const clipId = useRef(0)
  const [live, setLive] = useState<Live | null>(null)
  /** Progressive playback of the current/last generation; stopped when a new one starts or the tab unmounts. */
  const player = useRef<SpeechPlayer | null>(null)
  const [livePlaying, setLivePlaying] = useState(false)
  useEffect(() => () => player.current?.stop(), [])

  const [voiceMode, setVoiceMode] = useState<VoiceMode>('default')
  const [voice, setVoice] = useState<CustomVoice | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const voiceSeq = useRef(0)
  /** Latest clip for async callbacks (an encode may finish after the clip was replaced or removed). */
  const voiceRef = useRef<CustomVoice | null>(null)
  useEffect(() => {
    voiceRef.current = voice
  }, [voice])

  const ready = state.status === 'ready'
  const busy = !!state.job
  const hiddenDuringJob = useHiddenWhile(busy)
  const chars = text.trim().length
  const tooLong = chars > MAX_CHARS
  const custom = voiceMode === 'custom'
  const canSpeak = ready && !busy && !preparing && chars > 0 && !tooLong && (!custom || !!voice)

  // Release the previous clip's blob URL when it's replaced or the tab unmounts.
  useEffect(() => {
    if (!clip) return
    return () => URL.revokeObjectURL(clip.url)
  }, [clip])

  useEffect(() => {
    if (!voice) return
    return () => URL.revokeObjectURL(voice.clip.url)
  }, [voice])

  const startedAt = useRef(0)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 100)
    return () => clearInterval(t)
  }, [busy])

  /** Encodes `v` in the worker (speaker cache keyed by id). Returns false if it failed or the clip was replaced. */
  async function prepareVoice(v: CustomVoice): Promise<boolean> {
    setPreparing(true)
    setVoiceError(null)
    try {
      // The PCM buffer is transferred to the worker, so send a copy and keep ours for re-encoding.
      await tts.encodeVoice(v.id, v.pcm.slice())
      if (voiceRef.current?.id !== v.id) return false
      setVoice({ ...v, encoded: true })
      return true
    } catch (err) {
      if (voiceRef.current?.id === v.id) setVoiceError(`Couldn't prepare this voice: ${errorText(err)}`)
      return false
    } finally {
      setPreparing(false)
    }
  }

  function addVoice(audio: CapturedAudio) {
    URL.revokeObjectURL(audio.url)
    if (isSilent(audio.pcm)) {
      setVoiceError('This clip is silent — check the microphone or pick another file.')
      return
    }
    const trimmed = audio.seconds > MAX_REFERENCE_SECONDS
    const pcm = trimTo(audio.pcm, SAMPLE_RATE, MAX_REFERENCE_SECONDS).slice()
    const v: CustomVoice = {
      id: `voice-${++voiceSeq.current}`,
      pcm,
      clip: { url: URL.createObjectURL(encodeWav(pcm, SAMPLE_RATE)), name: audio.name, seconds: pcm.length / SAMPLE_RATE, trimmed },
      encoded: false,
    }
    setVoiceError(null)
    setVoice(v)
    voiceRef.current = v
    setAnnouncement(`Voice clip added, ${v.clip.seconds.toFixed(1)} seconds${trimmed ? `, first ${MAX_REFERENCE_SECONDS} seconds used` : ''}.`)
    if (ready) void prepareVoice(v)
  }

  function removeVoice() {
    setVoice(null)
    voiceRef.current = null
    setVoiceError(null)
  }

  function stopPlayback() {
    player.current?.stop()
    player.current = null
    setLivePlaying(false)
  }

  function stopAll() {
    tts.stop()
    stopPlayback()
  }

  async function speak() {
    if (!canSpeak) return
    const chunks = splitIntoChunks(text)
    if (!chunks.length) return
    setError(null)
    // Created inside the click so the browser lets it play; the previous generation's playback stops.
    stopPlayback()
    const p = new SpeechPlayer(SAMPLE_RATE)
    p.unlock()
    player.current = p
    // The queue also drains mid-generation if playback catches up (a stall); only the last drain ends playback.
    let generated = false
    p.onEnded = () => {
      if (generated && player.current === p) setLivePlaying(false)
    }

    let voiceId = DEFAULT_VOICE_ID
    if (custom && voice) {
      if (!voice.encoded && !(await prepareVoice(voice))) return
      voiceId = voice.id
    }

    const plan: PlannedChunk[] = chunks.map((c, i) => ({ pause: i === 0 ? 0 : PAUSE_SECONDS[c.pause], chars: c.text.length }))
    const parts: { pcm: Float32Array; pauseBefore: number; stats: ChunkStats }[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    startedAt.current = performance.now()
    const since = () => (performance.now() - startedAt.current) / 1000
    setElapsed(0)
    setLive({ done: 0, total: chunks.length, startsIn: null })
    setAnnouncement(chunks.length > 1 ? `Generating speech in ${chunks.length} parts…` : 'Generating speech…')

    // Start playback once the buffered audio covers the projected remaining generation time (never mid-stall).
    const maybeStart = () => {
      clearTimeout(timer)
      if (p.isStarted || player.current !== p || !parts.length) return
      const wait = playbackStartDelay(plan) - since()
      if (wait <= 0) {
        p.start()
        setLivePlaying(true)
        setLive((l) => l && { ...l, startsIn: null })
        setAnnouncement('Playing.')
      } else {
        setLive((l) => l && { ...l, startsIn: wait })
        timer = setTimeout(maybeStart, Math.min(wait, 2) * 1000)
      }
    }

    const run = () =>
      tts.synthesize(
        chunks.map((c) => c.text),
        voiceId,
        exaggeration,
        (c, stats) => {
          const pcm = limitPeak(c.pcm)
          const seconds = pcm.length / SAMPLE_RATE
          plan[c.index].done = { seconds, readyAt: since(), genSeconds: stats.ms / 1000 }
          parts.push({ pcm, pauseBefore: plan[c.index].pause, stats })
          p.push(pcm, plan[c.index].pause)
          setLive((l) => l && { ...l, done: c.index + 1 })
          maybeStart()
        },
      )
    try {
      let done
      try {
        done = await run()
      } catch (err) {
        // The worker lost its speaker cache (restarted after a GPU loss / reload): encode the clip again, once.
        if (!(err instanceof TtsError && err.code === 'no-voice' && custom && voice && !parts.length && (await prepareVoice(voice)))) throw err
        done = await run()
      }
      clearTimeout(timer)
      generated = true
      if (done.stopped) stopPlayback()
      else if (!p.isStarted && player.current === p) {
        p.start()
        setLivePlaying(true)
      } else if (p.isStarted && p.buffered === 0) setLivePlaying(false)
      if (!parts.length) {
        setAnnouncement('Stopped.')
        return
      }
      const pcm = joinWithPauses(parts, SAMPLE_RATE)
      const seconds = pcm.length / SAMPLE_RATE
      setClip({
        id: ++clipId.current,
        url: URL.createObjectURL(encodeWav(pcm, SAMPLE_RATE)),
        fileName: speechFileName(),
        seconds,
        synth: done.stats,
        total: chunks.length,
        speechTokens: parts.reduce((n, x) => n + x.stats.speechTokens, 0),
        cutOff: parts.filter((x) => x.stats.hitCap).length,
        resplit: parts.filter((x) => x.stats.resplit).length,
        stalls: p.stalls,
        stallSeconds: p.stallSeconds,
        stopped: done.stopped,
        backgrounded: hiddenDuringJob.current,
        voice: voiceMode,
      })
      setAnnouncement(done.stopped ? `Stopped. Kept ${parts.length} of ${chunks.length} parts, ${seconds.toFixed(1)} seconds.` : `Audio ready, ${seconds.toFixed(1)} seconds.`)
    } catch (err) {
      clearTimeout(timer)
      stopPlayback()
      setError(errorText(err))
      setAnnouncement('')
    } finally {
      setLive(null)
    }
  }

  return (
    <>
      <ModelGate source={ttsSource(capability, state, load, online)} active={active} />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (busy || livePlaying)) {
            e.preventDefault()
            stopAll()
          }
        }}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex h-44 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="speak-text" className="text-sm font-medium">
              Text
            </label>
            <span id="speak-count" className={`text-xs tabular-nums ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
              {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          </div>
          <textarea
            id="speak-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void speak()
              }
            }}
            aria-describedby="speak-count speak-hint"
            aria-invalid={tooLong}
            placeholder={ready ? 'Type or paste text to hear it…' : 'Type or paste text — load Chatterbox above to hear it.'}
            className="min-h-0 w-full flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
          <VoicePicker
            mode={voiceMode}
            onModeChange={setVoiceMode}
            clip={voice?.clip ?? null}
            onAudio={addVoice}
            onRemove={removeVoice}
            status={!voice ? 'idle' : preparing ? 'preparing' : voice.encoded ? 'ready' : 'idle'}
            error={voiceError}
            disabled={busy || preparing}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Exaggeration</span>
            <input
              type="range"
              min={EXAGGERATION_RANGE[0]}
              max={EXAGGERATION_RANGE[1]}
              step={0.05}
              value={exaggeration}
              onChange={(e) => setExaggeration(Number(e.target.value))}
              className="w-32 accent-primary"
              aria-valuetext={`${exaggeration.toFixed(2)}${exaggeration === DEFAULT_EXAGGERATION ? ', default' : ''}`}
            />
            <span className="w-20 text-xs tabular-nums text-muted-foreground">
              {exaggeration.toFixed(2)}
              {exaggeration === DEFAULT_EXAGGERATION && ' · default'}
            </span>
          </label>
          <div className="ml-auto">
            {busy ? (
              <Button variant="destructive" onClick={stopAll} className="h-9 gap-2">
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button onClick={() => void speak()} disabled={!canSpeak} className="h-9 gap-2">
                <AudioLines className="size-4" /> Speak
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-5 text-xs text-muted-foreground" aria-hidden="true">
          {busy
            ? `Generating speech… ${elapsed.toFixed(1)} s (usually about 1.5× the length of the audio)${live && live.total > 1 ? ` · part ${Math.min(live.done + 1, live.total)} of ${live.total}` : ''}`
            : preparing
              ? 'Preparing your voice…'
              : custom && !voice && 'Add a voice clip on the right (or below) to speak in your voice.'}
        </div>
        <ErrorNote>{error}</ErrorNote>

        <section aria-label="Generated audio" className="flex h-32 flex-col justify-center gap-2 rounded-xl border px-4 py-3">
          {live ? (
            <LiveProgress live={live} playing={livePlaying} />
          ) : clip ? (
            <>
              <div className="flex items-center gap-3">
                <audio key={clip.id} controls src={clip.url} onPlay={stopPlayback} className="h-10 min-w-0 flex-1" />
                {livePlaying && (
                  <Button variant="outline" onClick={stopPlayback} className="h-9 gap-2" aria-label="Stop playback">
                    <VolumeX className="size-4" /> <span className="hidden sm:inline">Stop playback</span>
                  </Button>
                )}
                <a href={clip.url} download={clip.fileName} aria-label="Download WAV" className={buttonVariants({ variant: 'outline', className: 'h-9 gap-2' })}>
                  <Download className="size-4" /> <span className="hidden sm:inline">Download WAV</span>
                </a>
              </div>
              <Stats
                items={[
                  `${clip.seconds.toFixed(1)} s audio`,
                  clip.total > 1 && (clip.stopped ? `stopped — first ${clip.synth.chunks} of ${clip.total} parts` : `${clip.total} parts`),
                  `generated in ${(clip.synth.ms / 1000).toFixed(1)} s`,
                  `${clip.synth.rtf.toFixed(2)}× real time`,
                  `${clip.speechTokens} speech tokens`,
                  clip.voice === 'custom' ? 'your voice' : 'default voice',
                  clip.stalls > 0 && `playback waited ${clip.stalls}× (${clip.stallSeconds.toFixed(1)} s)`,
                  clip.resplit > 0 && `${clip.resplit} part${clip.resplit > 1 ? 's' : ''} re-split`,
                  clip.cutOff > 0 && `${clip.cutOff} part${clip.cutOff > 1 ? 's' : ''} may be cut off`,
                  clip.stopped && clip.total === 1 && 'stopped',
                  clip.backgrounded && 'tab was in the background',
                ]}
              />
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">Your audio appears here.</p>
          )}
        </section>

        <div className="flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <p id="speak-hint">
            Up to {MAX_CHARS.toLocaleString()} characters, spoken sentence by sentence — playback starts once enough is buffered to
            play without pauses · Ctrl/⌘+Enter to speak · Esc to stop. Higher exaggeration sounds more expressive and a little faster.
          </p>
          {capability && <DeviceSummary capability={capability} />}
        </div>
      </div>
    </>
  )
}

function LiveProgress({ live, playing }: { live: Live; playing: boolean }) {
  const pct = Math.round((live.done / live.total) * 100)
  const label =
    live.total > 1 ? `Part ${Math.min(live.done + 1, live.total)} of ${live.total}` : live.done ? 'Finishing…' : 'Generating speech…'
  const phase = playing ? 'Playing' : live.startsIn != null ? `Preparing audio — playback starts in about ${Math.ceil(live.startsIn)} s` : 'Preparing audio…'
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{phase}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Speech generation"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${live.done} of ${live.total} parts generated`}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ttsSource(capability: Capability | null, state: TtsState, load: () => void, online: boolean): ModelSource {
  const dtype = capability?.dtype ?? 'q4f16'
  const total = capability?.totalBytes || ttsTotalBytes(dtype)
  const base: ModelSource = {
    name: 'Chatterbox',
    blurb: 'Natural English text-to-speech with voice cloning (0.5B). Runs on your GPU via WebGPU.',
    href: `https://huggingface.co/${TTS_MODEL_ID}`,
    sizeBytes: total,
    status: 'checking',
    cached: false,
    downloadBytes: capability?.downloadBytes ?? total,
    origin: 'huggingface.co',
  }
  if (!capability) return base
  if (capability.unsupported) return { ...base, status: 'unsupported', unsupported: capability.unsupported }
  const cached = capability.downloadBytes === 0
  const offline = !online && !cached ? "You're offline. Connect to the internet to download Speak — files that already finished downloading are kept." : undefined
  const source: ModelSource = { ...base, status: 'idle', cached, blocked: offline ?? capability.blocked, load }
  if (state.status === 'ready') return { ...source, status: 'ready', warning: state.warning }
  if (state.status === 'error') return { ...source, status: 'error', error: state.error }
  if (state.status === 'loading') {
    // Progress events cover the model files only (the runtime wasm and default voice are fetched separately), and
    // their total grows as files start; use the known size as a floor so the bar doesn't jump backwards.
    const expected = total - ORT_RUNTIME_BYTES - DEFAULT_VOICE_BYTES
    const p = state.progress
    return { ...source, status: 'loading', progress: p ? { loaded: p.loaded, total: Math.max(p.total, expected), fromCache: cached } : undefined }
  }
  return source
}
