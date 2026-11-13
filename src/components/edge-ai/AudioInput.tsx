import { useRef } from 'react'
import { Mic, Square, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAudioCapture, type AudioCapture, type CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { AUDIO_ACCEPT } from '@/lib/cactus/media'
import { cn } from '@/lib/utils'

export type { CapturedAudio }

/** Record + Upload buttons (and the hidden file input) driven by a shared `useAudioCapture` state. */
export function AudioButtons({ capture, recordLabel = 'Record', className }: { capture: AudioCapture; recordLabel?: string; className?: string }) {
  const { recording, elapsed, busy, disabled } = capture
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        type="button"
        variant={recording ? 'destructive' : 'default'}
        onClick={() => void capture.toggleRecording()}
        disabled={disabled || busy}
        className="h-9 gap-2"
        aria-pressed={recording}
      >
        {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
        {recording ? `Stop · ${elapsed.toFixed(1)}s` : recordLabel}
      </Button>
      <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={disabled || busy || recording} className="h-9 gap-2">
        <Upload className="size-4" /> Upload audio
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          capture.handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {busy && <span className="text-xs text-muted-foreground">Decoding audio…</span>}
    </div>
  )
}

/** Self-contained Record / Upload buttons with inline errors. */
export function AudioInput({
  onAudio,
  disabled,
  recordLabel,
  className,
}: {
  onAudio: (audio: CapturedAudio) => void
  disabled?: boolean
  recordLabel?: string
  className?: string
}) {
  const capture = useAudioCapture(onAudio, disabled)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AudioButtons capture={capture} recordLabel={recordLabel} />
      {capture.error && <p className="text-sm text-destructive">{capture.error}</p>}
    </div>
  )
}
