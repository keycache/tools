import { useEffect, useRef, useState } from 'react'
import { FileAudio, Mic, Square, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AUDIO_ACCEPT, SAMPLE_RATE, decodeAudio, isAudioFile, startRecording, type Recorder } from '@/lib/cactus/media'
import { cn } from '@/lib/utils'

export interface CapturedAudio {
  pcm: Float32Array
  url: string
  name: string
  seconds: number
}

interface Props {
  onAudio: (audio: CapturedAudio) => void
  disabled?: boolean
  allowUpload?: boolean
  recordLabel?: string
  /** Render as a drag-and-drop zone for audio files. */
  dropzone?: boolean
  className?: string
}

export function AudioInput({ onAudio, disabled, allowUpload = true, recordLabel = 'Record', dropzone = false, className }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const recorder = useRef<Recorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!recording) return
    const start = Date.now()
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 200)
    return () => clearInterval(t)
  }, [recording])

  useEffect(() => () => recorder.current?.cancel(), [])

  async function handleBlob(blob: Blob, name: string) {
    setBusy(true)
    setError(null)
    try {
      const pcm = await decodeAudio(blob)
      if (!pcm.length) throw new Error('The audio is empty')
      onAudio({ pcm, url: URL.createObjectURL(blob), name, seconds: pcm.length / SAMPLE_RATE })
    } catch (err) {
      setError(`Could not read audio: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleRecording() {
    setError(null)
    if (recording) {
      setRecording(false)
      const blob = await recorder.current!.stop()
      recorder.current = null
      await handleBlob(blob, 'Recording')
      return
    }
    try {
      recorder.current = await startRecording()
      setElapsed(0)
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone unavailable: ${String(err)}`)
    }
  }

  function handleFiles(files: FileList | null | undefined) {
    const file = files?.[0]
    if (!file) return
    if (!isAudioFile(file)) {
      setError(`"${file.name}" isn't an audio file. Try .wav, .mp3, .m4a, .ogg, .flac or .webm.`)
      return
    }
    void handleBlob(file, file.name)
  }

  const canDrop = !disabled && !busy && !recording

  const controls = (
    <div className={cn('flex flex-wrap items-center gap-2', dropzone && 'justify-center')}>
      <Button
        type="button"
        variant={recording ? 'destructive' : 'default'}
        onClick={() => void toggleRecording()}
        disabled={disabled || busy}
        className="gap-2"
        aria-pressed={recording}
      >
        {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
        {recording ? `Stop · ${elapsed.toFixed(1)}s` : recordLabel}
      </Button>
      {allowUpload && (
        <>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={disabled || busy || recording} className="gap-2">
            <Upload className="size-4" /> Upload audio
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files
              handleFiles(files)
              e.target.value = ''
            }}
          />
        </>
      )}
      {busy && <span className="text-xs text-muted-foreground">Decoding audio…</span>}
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {dropzone && allowUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none'
            if (canDrop) setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (canDrop) handleFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
            dragging ? 'border-primary bg-muted' : 'border-border',
          )}
        >
          <FileAudio className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drop a .wav (or other audio) file here, or</p>
          {controls}
        </div>
      ) : (
        controls
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
