import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Download, Square, VolumeX } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { ScriptNotes } from '@/components/edge-ai/ScriptNotes'
import { DeviceSummary, ErrorNote, Stats } from '@/components/edge-ai/shared'
import type { CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { useHiddenWhile, usePageHidden } from '@/components/edge-ai/useHiddenWhile'
import { useOnline } from '@/components/edge-ai/useOnline'
import { VoiceSelect, type ReferenceClip } from '@/components/edge-ai/VoiceSelect'
import { encodeWav } from '@/lib/cactus/media'
import type { Capability } from '@/lib/transformers/capability'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { isSilent, limitPeak, speechFileName, toPcm16, trimTo, wavFromParts } from '@/lib/tts/audio'
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
import { MAX_START_WAIT_SECONDS, SpeechPlayer, playbackStartAt, type PlannedChunk } from '@/lib/tts/playback'
import { formatDuration, hasErrors, parseScript, planChunks } from '@/lib/tts/script'
import type { ChunkStats, SynthStats } from '@/lib/tts/types'
import {
  CUSTOM_VOICE,
  builtinVoice,
  builtinVoiceKey,
  builtinVoiceUrl,
  loadVoiceChoice,
  saveVoiceChoice,
  type VoiceChoice,
} from '@/lib/tts/voices'

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
  /** Parts in the clip (fewer than `total` after Stop or an error). */
  parts: number
  outcome: 'complete' | 'stopped' | 'error'
  backgrounded: boolean
  /** e.g. "default voice", "your voice", "Female · Scottish". */
  voiceLabel: string
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

  const [choice, setChoice] = useState<VoiceChoice>(loadVoiceChoice)
  /** Built-in voice the worker has encoded (for the "Voice ready" note; Speak still re-checks with the worker). */
  const [builtinReady, setBuiltinReady] = useState<string | null>(null)
  /** Built-in voice encodes run one at a time (the worker takes one job at a time). */
  const prepareQueue = useRef<Promise<unknown>>(Promise.resolve())
  const choiceRef = useRef(choice)
  useEffect(() => {
    choiceRef.current = choice
  }, [choice])
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
  const pageHidden = usePageHidden()
  const chars = text.trim().length
  const tooLong = chars > MAX_CHARS
  const script = useMemo(() => parseScript(text, { mode: 'single' }), [text])
  const scriptErrors = hasErrors(script)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const custom = choice === CUSTOM_VOICE
  const canSpeak = ready && !busy && !preparing && script.turns.length > 0 && !tooLong && !scriptErrors && (!custom || !!voice)

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

  function changeChoice(next: VoiceChoice) {
    setChoice(next)
    saveVoiceChoice(next)
    setVoiceError(null)
  }

  /**
   * Makes built-in voice `id` available in the worker (fetched and stored on first use, then encoded once per worker).
   * On failure it shows why and falls back to the default voice. `eager` prepares are skipped once another voice is
   * chosen (arrowing through the dropdown queues one per option).
   */
  function prepareBuiltin(id: string, eager = false): Promise<boolean> {
    const v = builtinVoice(id)
    if (!v) return Promise.resolve(false)
    const run = async () => {
      if (eager && choiceRef.current !== id) return false
      setPreparing(true)
      try {
        await tts.encodeBuiltin(builtinVoiceKey(id), builtinVoiceUrl(v))
        setBuiltinReady(id)
        return true
      } catch (err) {
        setChoice((c) => (c === id ? DEFAULT_VOICE_ID : c))
        const why =
          err instanceof TtsError && err.code === 'network'
            ? `it downloads (${Math.round(v.bytes / 1000)} KB) the first time it's used — check your connection`
            : errorText(err).replace(/\.$/, '')
        setVoiceError(`Couldn't load the ${v.label} voice: ${why}. Using the default voice.`)
        return false
      } finally {
        setPreparing(false)
      }
    }
    const next = prepareQueue.current.then(run, run)
    prepareQueue.current = next
    return next
  }

  // Prepare the chosen built-in voice as soon as the model is ready, so Speak starts without the extra step.
  useEffect(() => {
    if (ready && builtinVoice(choice) && builtinReady !== choice) void prepareBuiltin(choice, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, choice])

  /** The worker voice id for the current choice, preparing it first if needed; null if it couldn't be prepared. */
  async function ensureVoice(force = false): Promise<string | null> {
    if (custom) {
      if (!voice) return null
      if ((force || !voice.encoded) && !(await prepareVoice(voice))) return null
      return voice.id
    }
    if (builtinVoice(choice)) return (await prepareBuiltin(choice)) ? builtinVoiceKey(choice) : null
    return DEFAULT_VOICE_ID
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

  /** Selects `line` (1-based) in the text box, e.g. from a marker diagnostic. */
  function jumpToLine(line: number) {
    const el = textRef.current
    if (!el) return
    const lines = el.value.split('\n')
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
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
    const chunks = planChunks(script, exaggeration)
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

    const firstVoiceId = await ensureVoice()
    if (!firstVoiceId) return
    let voiceId = firstVoiceId
    const builtinLabel = builtinVoice(choice)?.label
    const voiceLabel = custom ? 'your voice' : builtinLabel ? `${builtinLabel} voice` : 'default voice'

    const plan: PlannedChunk[] = chunks.map((c) => ({ pause: c.pause, chars: c.text.length }))
    // Finished parts as 16-bit PCM (half the memory of Float32); the float copy only goes to the player.
    const parts: { pcm16: Int16Array; pauseBefore: number; stats: ChunkStats }[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    startedAt.current = performance.now()
    const since = () => (performance.now() - startedAt.current) / 1000
    setElapsed(0)
    setLive({ done: 0, total: chunks.length, startsIn: null })
    setAnnouncement(chunks.length > 1 ? `Generating speech in ${chunks.length} parts…` : 'Generating speech…')

    // Start once the buffered audio covers the projected remaining generation time — or after MAX_START_WAIT_SECONDS,
    // accepting short waits at part boundaries (never mid-part) so long texts don't wait minutes for the first word.
    const maybeStart = () => {
      clearTimeout(timer)
      if (p.isStarted || player.current !== p || !parts.length) return
      const wait = playbackStartAt(plan) - since()
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
        chunks.map((c) => ({ text: c.text, exaggeration: c.exaggeration })),
        voiceId,
        (c, stats) => {
          const pcm = limitPeak(c.pcm)
          const seconds = pcm.length / SAMPLE_RATE
          plan[c.index].done = { seconds, readyAt: since(), genSeconds: stats.ms / 1000 }
          parts.push({ pcm16: toPcm16(pcm), pauseBefore: plan[c.index].pause, stats })
          p.push(pcm, plan[c.index].pause)
          setLive((l) => l && { ...l, done: c.index + 1 })
          maybeStart()
        },
      )
    /** Turns the finished parts into the clip (also after Stop or an error), then releases them. */
    const keep = (outcome: Clip['outcome'], stats?: SynthStats) => {
      const seconds = parts.reduce((n, x, i) => n + x.pcm16.length / SAMPLE_RATE + (i ? x.pauseBefore : 0), 0)
      const audio = parts.reduce((n, x) => n + x.stats.audioSeconds, 0)
      const ms = Math.round(since() * 1000)
      setClip({
        id: ++clipId.current,
        url: URL.createObjectURL(wavFromParts(parts, SAMPLE_RATE)),
        fileName: speechFileName(),
        seconds,
        synth: stats ?? { chunks: parts.length, ms, firstAudioMs: 0, audioSeconds: audio, rtf: audio > 0 ? ms / 1000 / audio : 0 },
        parts: parts.length,
        total: chunks.length,
        speechTokens: parts.reduce((n, x) => n + x.stats.speechTokens, 0),
        cutOff: parts.filter((x) => x.stats.hitCap).length,
        resplit: parts.filter((x) => x.stats.resplit).length,
        stalls: p.stalls,
        stallSeconds: p.stallSeconds,
        outcome,
        backgrounded: hiddenDuringJob.current,
        voiceLabel,
      })
      parts.length = 0
      return seconds
    }

    try {
      let done
      try {
        done = await run()
      } catch (err) {
        // The worker lost its speaker cache (restarted after a GPU loss / reload): encode the voice again, once.
        if (!(err instanceof TtsError && err.code === 'no-voice' && !parts.length)) throw err
        const again = await ensureVoice(true)
        if (!again) throw err
        voiceId = again
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
      const kept = parts.length
      const seconds = keep(done.stopped ? 'stopped' : 'complete', done.stats)
      setAnnouncement(done.stopped ? `Stopped. Kept ${kept} of ${chunks.length} parts, ${seconds.toFixed(1)} seconds.` : `Audio ready, ${seconds.toFixed(1)} seconds.`)
    } catch (err) {
      clearTimeout(timer)
      generated = true
      stopPlayback()
      setError(errorText(err))
      // Keep what was generated before the error — on a long text that can be many minutes of audio.
      if (parts.length) {
        const kept = parts.length
        const seconds = keep('error')
        setAnnouncement(`Stopped by an error. Kept ${kept} of ${chunks.length} parts, ${seconds.toFixed(1)} seconds.`)
      } else setAnnouncement('')
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
            <span className="text-xs tabular-nums text-muted-foreground">
              {script.turns.length > 0 && <span id="speak-summary">about {formatDuration(script.summary.estSeconds)} of audio · </span>}
              <span id="speak-count" className={tooLong ? 'text-destructive' : undefined}>
                {chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </span>
            </span>
          </div>
          <textarea
            ref={textRef}
            id="speak-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void speak()
              }
            }}
            aria-describedby="speak-count speak-notes speak-hint"
            aria-invalid={tooLong || scriptErrors}
            placeholder={ready ? 'Type or paste text to hear it…' : 'Type or paste text — load Chatterbox above to hear it.'}
            className="min-h-0 w-full flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
          <VoiceSelect
            choice={choice}
            onChoiceChange={changeChoice}
            clip={voice?.clip ?? null}
            onAudio={addVoice}
            onRemove={removeVoice}
            status={
              preparing ? 'preparing' : custom ? (voice?.encoded ? 'ready' : 'idle') : builtinVoice(choice) && builtinReady === choice && ready ? 'ready' : 'idle'
            }
            error={voiceError}
            // Built-in voices prepare in the background, so the dropdown stays usable (e.g. arrowing through it).
            disabled={busy || (custom && preparing)}
          />
        </div>
        <ScriptNotes id="speak-notes" diagnostics={script.diagnostics} onJump={jumpToLine} />

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
            ? `Generating speech… ${elapsed.toFixed(1)} s (usually about 1.5× the length of the audio)${live && live.total > 1 ? ` · part ${Math.min(live.done + 1, live.total)} of ${live.total}` : ''}${pageHidden ? ' · Keep this tab visible for full speed' : ''}`
            : preparing
              ? custom
                ? 'Preparing your voice…'
                : 'Preparing voice…'
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
                  clip.outcome === 'error'
                    ? `stopped by an error — first ${clip.parts} of ${clip.total} parts`
                    : clip.total > 1 && (clip.outcome === 'stopped' ? `stopped — first ${clip.parts} of ${clip.total} parts` : `${clip.total} parts`),
                  `generated in ${(clip.synth.ms / 1000).toFixed(1)} s`,
                  `${clip.synth.rtf.toFixed(2)}× real time`,
                  `${clip.speechTokens} speech tokens`,
                  clip.voiceLabel,
                  clip.stalls > 0 && `playback waited ${clip.stalls}× (${clip.stallSeconds.toFixed(1)} s)`,
                  clip.resplit > 0 && `${clip.resplit} part${clip.resplit > 1 ? 's' : ''} re-split`,
                  clip.cutOff > 0 && `${clip.cutOff} part${clip.cutOff > 1 ? 's' : ''} may be cut off`,
                  clip.outcome === 'stopped' && clip.total === 1 && 'stopped',
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
            Up to {MAX_CHARS.toLocaleString()} characters, spoken sentence by sentence. Playback starts within about{' '}
            {MAX_START_WAIT_SECONDS} s; on long texts it may pause between parts while generation catches up · Ctrl/⌘+Enter to speak ·
            Esc to stop. Higher exaggeration sounds more expressive and a little faster. Markers: [pause 1.5s] or [pause 500ms]
            adds silence; [exaggeration 0.8] sets it for that line.
          </p>
          {capability && <DeviceSummary capability={capability} />}
        </div>
        <p className="text-xs text-muted-foreground">
          Built-in voices:{' '}
          <a className="underline underline-offset-2" href="https://datashare.ed.ac.uk/handle/10283/3443" target="_blank" rel="noreferrer">
            VCTK
          </a>{' '}
          (CSTR, University of Edinburgh) and{' '}
          <a className="underline underline-offset-2" href="https://www.openslr.org/141/" target="_blank" rel="noreferrer">
            LibriTTS-R
          </a>{' '}
          (Google), licensed{' '}
          <a className="underline underline-offset-2" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>
          .
        </p>
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
