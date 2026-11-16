import { Play, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AudioButtons } from '@/components/edge-ai/AudioInput'
import { Select } from '@/components/edge-ai/shared'
import { useAudioCapture, type CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { Button } from '@/components/ui/button'
import { OpfsModelCache } from '@/lib/transformers/opfsCache'
import { ttsDir } from '@/lib/tts/cache'
import { DEFAULT_VOICE_ID, MAX_REFERENCE_SECONDS, SAMPLE_RATE, pinTtsRevision } from '@/lib/tts/constants'
import { BUILTIN_VOICES, CUSTOM_VOICE, DEFAULT_VOICE_INFO, builtinVoice, voicePreviewUrl, type VoiceChoice } from '@/lib/tts/voices'
import { cn } from '@/lib/utils'

/** The user's reference clip as shown in the picker (the PCM lives in SpeakTab). */
export interface ReferenceClip {
  url: string
  name: string
  /** Seconds kept (≤ MAX_REFERENCE_SECONDS). */
  seconds: number
  /** The original was longer and only the first MAX_REFERENCE_SECONDS are used. */
  trimmed: boolean
}

/** Shorter references clone noticeably less well. */
export const MIN_GOOD_REFERENCE_SECONDS = 3

interface Props {
  choice: VoiceChoice
  onChoiceChange: (choice: VoiceChoice) => void
  /** The user's own clip (shown when "Your voice…" is chosen). */
  clip: ReferenceClip | null
  /** Called with 24 kHz mono PCM from a recording, upload or drop. */
  onAudio: (audio: CapturedAudio) => void
  onRemove: () => void
  /** For the chosen voice: 'preparing' while it's fetched/encoded; 'ready' once generations can use it. */
  status: 'idle' | 'preparing' | 'ready'
  error?: string | null
  /** No changes while speech is being generated. */
  disabled: boolean
}

const previewCache = new OpfsModelCache(ttsDir, pinTtsRevision)

/** Plays one clip at a time; prefers the copy in Speak's storage (works offline once the voice was used). */
function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null)
  const audio = useRef<{ el: HTMLAudioElement; blobUrl?: string } | null>(null)
  const stop = () => {
    const a = audio.current
    if (a) {
      a.el.pause()
      if (a.blobUrl) URL.revokeObjectURL(a.blobUrl)
    }
    audio.current = null
    setPlaying(null)
  }
  useEffect(() => stop, [])
  const play = async (url: string) => {
    stop()
    setPlaying(url)
    const stored = await previewCache.match(url)
    const blobUrl = stored ? URL.createObjectURL(await stored.blob()) : undefined
    const el = new Audio(blobUrl ?? url)
    audio.current = { el, blobUrl }
    el.onended = () => audio.current?.el === el && stop()
    el.onerror = () => audio.current?.el === el && stop()
    await el.play().catch(() => audio.current?.el === el && stop())
  }
  return { playing, play, stop }
}

/**
 * Voice dropdown: the model's default voice, the built-in voices, or "Your voice…" (upload / record / drop).
 * Fixed height so switching never shifts the page.
 */
export function VoiceSelect({ choice, onChoiceChange, clip, onAudio, onRemove, status, error, disabled }: Props) {
  const capture = useAudioCapture(onAudio, disabled, { sampleRate: SAMPLE_RATE })
  const [dragging, setDragging] = useState(false)
  const preview = usePreview()
  const custom = choice === CUSTOM_VOICE
  const builtin = builtinVoice(choice)
  const info = builtin ?? (choice === DEFAULT_VOICE_ID ? DEFAULT_VOICE_INFO : null)
  const previewUrl = voicePreviewUrl(choice)
  const shownError = (custom ? capture.error : null) ?? error

  return (
    <section
      aria-label="Voice"
      className={cn('flex h-44 flex-col gap-2 rounded-xl border px-3 py-2.5', dragging && 'border-primary bg-primary/5')}
      onDragOver={(e) => {
        if (!custom || !capture.canAccept) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false)
        if (!custom || !capture.canAccept) return
        e.preventDefault()
        capture.handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="speak-voice" className="text-sm font-medium">
          Voice
        </label>
        <Select
          id="speak-voice"
          value={choice}
          onChange={(e) => {
            preview.stop()
            onChoiceChange(e.target.value)
          }}
          disabled={disabled || capture.recording}
          aria-describedby="speak-voice-info"
          wrapperClassName="min-w-0 flex-1"
          className="h-8 w-full truncate pl-2.5"
        >
          <optgroup label="Built-in voices">
            <option value={DEFAULT_VOICE_ID}>
              {DEFAULT_VOICE_INFO.label} — {DEFAULT_VOICE_INFO.description}
            </option>
            {BUILTIN_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} — {v.description}
              </option>
            ))}
          </optgroup>
          <optgroup label="Your voice">
            <option value={CUSTOM_VOICE}>Your voice… (upload / record)</option>
          </optgroup>
        </Select>
      </div>

      <div id="speak-voice-info" className="min-h-0 flex-1 text-xs text-muted-foreground">
        {!custom && info ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {previewUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => (preview.playing ? preview.stop() : void preview.play(previewUrl))}
                  aria-label={`${preview.playing ? 'Stop preview of' : 'Preview'} ${info.label} voice`}
                >
                  {preview.playing ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                  {preview.playing ? 'Stop' : 'Preview'}
                </Button>
              )}
              <p className="min-w-0">
                {info.seconds.toFixed(1)} s sample ·{' '}
                {builtin ? `${builtin.source.dataset} speaker ${builtin.source.speaker}, ${builtin.licence}` : 'comes with the model'}
              </p>
            </div>
            {builtin && (
              <>
                <p role="status" className={status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : undefined}>
                  {status === 'preparing' ? 'Preparing voice…' : status === 'ready' ? 'Voice ready' : 'Prepared when the model is loaded'}
                </p>
              </>
            )}
          </div>
        ) : clip ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <audio controls src={clip.url} className="h-8 min-w-0 flex-1" aria-label={`Your voice clip: ${clip.name}`} />
              <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled} aria-label="Remove voice clip">
                <X className="size-4" />
              </Button>
            </div>
            <p className="truncate">
              {clip.name} · {clip.seconds.toFixed(1)} s{clip.trimmed && ` (first ${MAX_REFERENCE_SECONDS} s)`}
              {clip.seconds < MIN_GOOD_REFERENCE_SECONDS && ' · longer clips (5–10 s) clone better'}
            </p>
            <p role="status" className={status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : undefined}>
              {status === 'preparing' ? 'Preparing your voice…' : status === 'ready' ? 'Voice ready' : 'Prepared when the model is loaded'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <AudioButtons capture={capture} />
            <p>Record or upload 5–10 s of clear speech from one speaker — or drop an audio file here.</p>
          </div>
        )}
        {shownError && (
          <p role="alert" className="mt-1 text-destructive">
            {shownError}
          </p>
        )}
      </div>

      {custom && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Only use voices you have permission to use. Your clip stays on this device and isn't saved.
        </p>
      )}
    </section>
  )
}
