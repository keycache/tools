import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Download, Square, VolumeX } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { ScriptNotes } from '@/components/edge-ai/ScriptNotes'
import { SpeakerCards } from '@/components/edge-ai/SpeakerCards'
import { DeviceSummary, ErrorNote, Segmented, Stats } from '@/components/edge-ai/shared'
import { useHiddenWhile, usePageHidden } from '@/components/edge-ai/useHiddenWhile'
import { useOnline } from '@/components/edge-ai/useOnline'
import { useVoiceSlot, type VoiceSlot } from '@/components/edge-ai/useVoiceSlot'
import { VoiceSelect } from '@/components/edge-ai/VoiceSelect'
import type { Capability } from '@/lib/transformers/capability'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { limitPeak, speechFileName, toPcm16, wavFromParts } from '@/lib/tts/audio'
import { TtsError, tts, useTts, type TtsState } from '@/lib/tts/client'
import {
  DEFAULT_EXAGGERATION,
  DEFAULT_VOICE_BYTES,
  DEFAULT_VOICE_ID,
  EXAGGERATION_RANGE,
  MAX_INPUT_CHARS,
  SAMPLE_RATE,
  TTS_MODEL_ID,
  ttsTotalBytes,
} from '@/lib/tts/constants'
import { useTtsCapability, type TtsCacheState } from '@/lib/tts/hooks'
import { MAX_START_WAIT_SECONDS, SpeechPlayer, playbackStartAt, type PlannedChunk } from '@/lib/tts/playback'
import { formatDuration, hasErrors, parseScript, planChunks, type ScriptMode, type SpeakerNumber } from '@/lib/tts/script'
import type { ChunkStats, SynthStats } from '@/lib/tts/types'
import { DEFAULT_SPEAKER_VOICES, VOICE_STORAGE_KEY, speakerVoiceKey } from '@/lib/tts/voices'
import { cn } from '@/lib/utils'

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
  /** Stats about the voices, e.g. ["Female · Scottish voice"] or ["6 turns", "Speaker 1: …, 3 turns", …]. */
  voices: string[]
}

/** Generation in progress, for the output card. */
interface Live {
  done: number
  total: number
  /** Seconds until playback starts (estimate), null once playing. */
  startsIn: number | null
}

const MAX_CHARS = MAX_INPUT_CHARS

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const now = () => performance.now()

export function SpeakTab({ active, visited, cache }: Props) {
  const capability = useTtsCapability(visited, cache.ready)
  const state = useTts()
  const online = useOnline()
  const device = capability?.device
  const dtype = capability?.dtype
  const load = useCallback(() => {
    if (device === 'webgpu' && dtype) tts.load(device, dtype).catch(() => {})
  }, [device, dtype])

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

  const ready = state.status === 'ready'
  const busy = !!state.job
  const hiddenDuringJob = useHiddenWhile(busy)
  const pageHidden = usePageHidden()

  const [mode, setMode] = useState<ScriptMode>('single')
  const conversation = mode === 'conversation'
  /** Each mode keeps its own text. */
  const [texts, setTexts] = useState<Record<ScriptMode, string>>({ single: '', conversation: '' })
  const text = texts[mode]
  const setText = (t: string) => setTexts((x) => ({ ...x, [mode]: t }))
  const [speakerExaggeration, setSpeakerExaggeration] = useState<Record<SpeakerNumber, number>>({
    1: DEFAULT_EXAGGERATION,
    2: DEFAULT_EXAGGERATION,
    3: DEFAULT_EXAGGERATION,
    4: DEFAULT_EXAGGERATION,
  })
  const chars = text.trim().length
  const tooLong = chars > MAX_CHARS
  const script = useMemo(() => parseScript(text, { mode }), [text, mode])
  const scriptErrors = hasErrors(script)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const announce = setAnnouncement
  const inScript = (n: SpeakerNumber) => conversation && script.speakers.includes(n)
  const single = useVoiceSlot({ name: 'single', storageKey: VOICE_STORAGE_KEY, fallback: DEFAULT_VOICE_ID, ready, active: !conversation, announce })
  const s1 = useVoiceSlot({ name: 's1', storageKey: speakerVoiceKey(1), fallback: DEFAULT_SPEAKER_VOICES[1], ready, active: inScript(1), announce })
  const s2 = useVoiceSlot({ name: 's2', storageKey: speakerVoiceKey(2), fallback: DEFAULT_SPEAKER_VOICES[2], ready, active: inScript(2), announce })
  const s3 = useVoiceSlot({ name: 's3', storageKey: speakerVoiceKey(3), fallback: DEFAULT_SPEAKER_VOICES[3], ready, active: inScript(3), announce })
  const s4 = useVoiceSlot({ name: 's4', storageKey: speakerVoiceKey(4), fallback: DEFAULT_SPEAKER_VOICES[4], ready, active: inScript(4), announce })
  const speakerSlots: Record<SpeakerNumber, VoiceSlot> = { 1: s1, 2: s2, 3: s3, 4: s4 }
  const slotFor = (n: SpeakerNumber) => (conversation ? speakerSlots[n] : single)
  const preparing = [single, s1, s2, s3, s4].some((v) => v.preparing)
  /** Speakers in the script whose "Your voice…" has no clip yet. */
  const missingVoices = (conversation ? script.speakers : [1 as const]).filter((n) => !slotFor(n).usable)
  const turnCounts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<SpeakerNumber, number>
  for (const t of script.turns) turnCounts[t.speaker]++
  const canSpeak = ready && !busy && !preparing && script.turns.length > 0 && !tooLong && !scriptErrors && missingVoices.length === 0

  // Release the previous clip's blob URL when it's replaced or the tab unmounts.
  useEffect(() => {
    if (!clip) return
    return () => URL.revokeObjectURL(clip.url)
  }, [clip])

  const startedAt = useRef(0)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 100)
    return () => clearInterval(t)
  }, [busy])

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
    const chunks = planChunks(script, conversation ? (n) => speakerExaggeration[n] : exaggeration)
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

    // Every voice used is prepared before generation starts (one at a time — the worker runs one job at a time).
    const speakers = [...new Set(chunks.map((c) => c.speaker))]
    const ensureAll = async (force = false) => {
      const ids = new Map<SpeakerNumber, string>()
      for (const n of speakers) {
        const id = await slotFor(n).ensure(force)
        if (!id) return null
        ids.set(n, id)
      }
      return chunks.map((c) => ({ text: c.text, exaggeration: c.exaggeration, voiceId: ids.get(c.speaker) ?? DEFAULT_VOICE_ID }))
    }
    const firstSynth = await ensureAll()
    if (!firstSynth) return
    let synthChunks = firstSynth
    const voices = conversation
      ? [
          `${script.turns.length} turns`,
          ...script.speakers.map((n) => {
            const turns = script.turns.filter((t) => t.speaker === n).length
            return `Speaker ${n}: ${speakerSlots[n].label}, ${turns} turn${turns === 1 ? '' : 's'}`
          }),
        ]
      : [single.label]

    const plan: PlannedChunk[] = chunks.map((c) => ({ pause: c.pause, chars: c.text.length }))
    // Finished parts as 16-bit PCM (half the memory of Float32); the float copy only goes to the player.
    const parts: { pcm16: Int16Array; pauseBefore: number; stats: ChunkStats; turn: number }[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    startedAt.current = now()
    const since = () => (now() - startedAt.current) / 1000
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
        synthChunks,
        (c, stats) => {
          const pcm = limitPeak(c.pcm)
          const seconds = pcm.length / SAMPLE_RATE
          plan[c.index].done = { seconds, readyAt: since(), genSeconds: stats.ms / 1000 }
          parts.push({ pcm16: toPcm16(pcm), pauseBefore: plan[c.index].pause, stats, turn: chunks[c.index].turn })
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
        voices,
      })
      parts.length = 0
      return seconds
    }

    try {
      let done
      try {
        done = await run()
      } catch (err) {
        // The worker lost its speaker cache (restarted after a GPU loss / reload): encode the voices again, once.
        if (!(err instanceof TtsError && err.code === 'no-voice' && !parts.length)) throw err
        const again = await ensureAll(true)
        if (!again) throw err
        synthChunks = again
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
        <Segmented
          label="Speak mode"
          value={mode}
          onChange={(m) => !busy && setMode(m)}
          options={[
            { value: 'single', label: 'Single voice' },
            { value: 'conversation', label: 'Conversation' },
          ]}
        />
        {conversation ? (
          <>
            <div className={cn('flex flex-col gap-1.5', conversation ? 'h-56' : 'h-44')}>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="speak-text" className="text-sm font-medium">
                  Text
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {script.turns.length > 0 && (
                    <span id="speak-summary">
                      {conversation &&
                        `${script.summary.speakers} speaker${script.summary.speakers === 1 ? '' : 's'} · ${script.summary.turns} turn${script.summary.turns === 1 ? '' : 's'} · `}
                      about {formatDuration(script.summary.estSeconds)} of audio ·{' '}
                    </span>
                  )}
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
                placeholder={
                  conversation
                    ? '[S1] Hi, did you hear the news?\n[S2] [exaggeration 0.8] No! Tell me everything.\n[pause 1s]\n[S1] Well… it’s a long story.'
                    : ready
                      ? 'Type or paste text to hear it…'
                      : 'Type or paste text — load Chatterbox above to hear it.'
                }
                className="min-h-0 w-full flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <SpeakerCards
              speakers={script.speakers}
              slots={speakerSlots}
              exaggeration={speakerExaggeration}
              onExaggerationChange={(n, v) => setSpeakerExaggeration((x) => ({ ...x, [n]: v }))}
              turns={turnCounts}
              disabled={busy}
            />
          </>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className={cn('flex flex-col gap-1.5', conversation ? 'h-56' : 'h-44')}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="speak-text" className="text-sm font-medium">
                Text
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {script.turns.length > 0 && (
                  <span id="speak-summary">
                    {conversation &&
                      `${script.summary.speakers} speaker${script.summary.speakers === 1 ? '' : 's'} · ${script.summary.turns} turn${script.summary.turns === 1 ? '' : 's'} · `}
                    about {formatDuration(script.summary.estSeconds)} of audio ·{' '}
                  </span>
                )}
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
              placeholder={
                conversation
                  ? '[S1] Hi, did you hear the news?\n[S2] [exaggeration 0.8] No! Tell me everything.\n[pause 1s]\n[S1] Well… it’s a long story.'
                  : ready
                    ? 'Type or paste text to hear it…'
                    : 'Type or paste text — load Chatterbox above to hear it.'
              }
              className="min-h-0 w-full flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
            <VoiceSelect
              choice={single.choice}
              onChoiceChange={single.changeChoice}
              clip={single.clip}
              onAudio={single.addVoice}
              onRemove={single.removeVoice}
              status={single.status}
              error={single.error}
              // Built-in voices prepare in the background, so the dropdown stays usable (e.g. arrowing through it).
              disabled={busy || (single.choice === 'custom' && single.preparing)}
            />
          </div>
        )}
        <ScriptNotes id="speak-notes" diagnostics={script.diagnostics} onJump={jumpToLine} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {!conversation && (
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
          )}
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
              ? 'Preparing voice…'
              : missingVoices.length > 0 &&
                (conversation
                  ? `${missingVoices.map((n) => `Speaker ${n}`).join(' and ')} ${missingVoices.length > 1 ? 'need' : 'needs'} a voice clip — record or upload one, or pick a voice.`
                  : 'Add a voice clip on the right (or below) to speak in your voice.')}
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
                  ...clip.voices,
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
            Esc to stop. Higher exaggeration sounds more expressive and a little faster.{' '}
            {conversation
              ? 'Start each turn with [S1]–[S4]; [pause 1.5s] replaces the gap at that spot; [exaggeration 0.8] sets it for that turn.'
              : 'Markers: [pause 1.5s] or [pause 500ms] adds silence; [exaggeration 0.8] sets it for that line.'}
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
