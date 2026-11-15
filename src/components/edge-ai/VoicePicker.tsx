import { X } from 'lucide-react'
import { useState } from 'react'
import { AudioButtons } from '@/components/edge-ai/AudioInput'
import { Segmented } from '@/components/edge-ai/shared'
import { useAudioCapture, type CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { Button } from '@/components/ui/button'
import { MAX_REFERENCE_SECONDS, SAMPLE_RATE } from '@/lib/tts/constants'
import { cn } from '@/lib/utils'

export type VoiceMode = 'default' | 'custom'

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
  mode: VoiceMode
  onModeChange: (mode: VoiceMode) => void
  clip: ReferenceClip | null
  /** Called with 24 kHz mono PCM from a recording, upload or drop. */
  onAudio: (audio: CapturedAudio) => void
  onRemove: () => void
  /** 'preparing' while the clip is being encoded; 'ready' once generations can use it. */
  status: 'idle' | 'preparing' | 'ready'
  error?: string | null
  /** No changes while speech is being generated. */
  disabled: boolean
}

/** Default voice or a voice cloned from the user's own clip. Fixed height so switching never shifts the page. */
export function VoicePicker({ mode, onModeChange, clip, onAudio, onRemove, status, error, disabled }: Props) {
  const capture = useAudioCapture(onAudio, disabled, { sampleRate: SAMPLE_RATE })
  const [dragging, setDragging] = useState(false)
  const shownError = capture.error ?? error

  return (
    <section
      aria-label="Voice"
      className={cn('flex h-44 flex-col gap-2 rounded-xl border px-3 py-2.5', dragging && 'border-primary bg-primary/5')}
      onDragOver={(e) => {
        if (mode !== 'custom' || !capture.canAccept) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false)
        if (mode !== 'custom' || !capture.canAccept) return
        e.preventDefault()
        capture.handleFiles(e.dataTransfer.files)
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Voice</span>
        <Segmented
          label="Voice"
          value={mode}
          onChange={(v) => !disabled && !capture.recording && onModeChange(v)}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'custom', label: 'Your voice' },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 text-xs text-muted-foreground">
        {mode === 'default' ? (
          <p className="pt-1">The model's built-in voice.</p>
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
        {mode === 'custom' && shownError && (
          <p role="alert" className="mt-1 text-destructive">
            {shownError}
          </p>
        )}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Only use voices you have permission to use. Your clip stays on this device and isn't saved.
      </p>
    </section>
  )
}
