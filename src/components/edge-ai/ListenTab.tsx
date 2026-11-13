import { Fragment, useEffect, useRef, useState } from 'react'
import { Copy, FileAudio, Loader2, Mic, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioButtons } from '@/components/edge-ai/AudioInput'
import { useAudioCapture, type CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { ErrorNote, RawJson, Select, Stats, Textarea } from '@/components/edge-ai/shared'
import { cactus, useModel } from '@/lib/cactus/client'
import type { TranscribeResult } from '@/lib/cactus/engine'
import { LANGUAGES } from '@/lib/cactus/presets'
import { cn } from '@/lib/utils'

export function ListenTab() {
  const whistle = useModel('whistle')
  const [audio, setAudio] = useState<CapturedAudio | null>(null)
  const [language, setLanguage] = useState('')
  const [keywords, setKeywords] = useState('')
  const [timestamps, setTimestamps] = useState(true)
  const [result, setResult] = useState<{ res: TranscribeResult; ms: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const player = useRef<HTMLAudioElement>(null)
  const ready = whistle.status === 'ready'

  useEffect(() => () => void (audio && URL.revokeObjectURL(audio.url)), [audio])

  async function transcribe() {
    const clip = audio
    if (!clip) return
    setRunning(true)
    setError(null)
    try {
      const { result: res, ms } = await cactus.transcribe(clip.pcm, {
        language: language || null,
        keywords: keywords.split('\n'),
        wordTimestamps: timestamps,
      })
      setResult({ res, ms })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  function onAudio(clip: CapturedAudio) {
    setAudio(clip)
    setResult(null)
  }

  function seek(t: number) {
    if (!player.current) return
    player.current.currentTime = t
    void player.current.play()
  }

  const capture = useAudioCapture(onAudio, running)
  const [dragging, setDragging] = useState(false)

  const res = result?.res
  const audioSeconds = audio?.seconds ?? 0

  return (
    // Same grid as See/Act. Rows (lg): 1 = [audio box | keywords box], both a fixed height, with the player
    // inside the audio box so loading audio never moves anything; 2 = [audio hint | keywords hint];
    // 3 = [record/upload | language + timestamps + Transcribe]. `order-*` stacks each column on small screens.
    <div className="grid gap-x-5 gap-y-3 lg:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Audio</p>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = capture.canAccept ? 'copy' : 'none'
            if (capture.canAccept) setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (capture.canAccept) capture.handleFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex h-[22rem] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 text-center transition-colors',
            dragging ? 'border-primary bg-muted' : 'border-border',
          )}
        >
          {capture.recording ? (
            <>
              <Mic className="size-8 animate-pulse text-destructive" />
              <p className="text-sm font-medium">Recording… {capture.elapsed.toFixed(1)}s</p>
              <p className="text-xs text-muted-foreground">Press Stop below when you're done.</p>
            </>
          ) : capture.busy ? (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Decoding audio…</p>
            </>
          ) : audio ? (
            <>
              <FileAudio className="size-8 text-muted-foreground" />
              <p className="max-w-full truncate text-sm font-medium" title={audio.name}>
                {audio.name}
              </p>
              <audio
                ref={player}
                src={audio.url}
                controls
                className="w-full"
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <p className="text-xs text-muted-foreground">Drop another file to replace it.</p>
            </>
          ) : (
            <>
              <FileAudio className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Drop a .wav (or other audio) file here</p>
              <p className="text-xs text-muted-foreground">or use Record / Upload audio below</p>
            </>
          )}
        </div>
      </div>

      <div className="order-3 flex flex-col gap-1.5 lg:order-none">
        <label htmlFor="whistle-keywords" className="text-sm font-medium">
          Keywords
        </label>
        <Textarea id="whistle-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="h-[22rem] resize-none" />
      </div>

      <div className="order-1 space-y-2 lg:order-none">
        <p className="min-h-8 text-xs text-muted-foreground">
          {audio
            ? `${audio.seconds.toFixed(1)}s of audio, resampled to 16 kHz mono. Any length works; long clips are processed in windows.`
            : 'Formats: wav, mp3, m4a, ogg, flac, webm (anything your browser can play). Any length.'}
        </p>
        {capture.error && <ErrorNote>{capture.error}</ErrorNote>}
      </div>

      <div className="order-4 lg:order-none">
        <p className="min-h-8 text-xs text-muted-foreground">One per line. Biases recognition towards names and jargon, e.g. Siobhan, Kubernetes.</p>
      </div>

      <AudioButtons capture={capture} className="order-2 min-h-9 lg:order-none" />

      <div className="order-5 flex flex-wrap items-center gap-3 lg:order-none">
        <label htmlFor="whistle-lang" className="mr-1 text-sm font-medium">
          Language
        </label>
        <Select id="whistle-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">Detect automatically</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </Select>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} className="size-4 accent-primary" />
          Word timestamps
        </label>
        <Button onClick={() => void transcribe()} disabled={!ready || !audio || running} className="ml-auto h-9 gap-2">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Transcribe
        </Button>
      </div>

      <div className="order-6 mt-2 space-y-4 lg:order-none lg:col-span-2">
        <h2 className="text-lg font-semibold">Result</h2>
        <ErrorNote>{error}</ErrorNote>
        {res ? (
          <>
            {res.text ? (
              <div className="relative rounded-xl border p-4">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-2 right-2"
                  aria-label="Copy transcript"
                  onClick={() => void navigator.clipboard.writeText(res.text)}
                >
                  <Copy />
                </Button>
                {res.words?.length ? (
                  <p className="pr-8 leading-8">
                    {res.words.map((w, i) => {
                      const current = playing && time >= w.start && time < w.end
                      return (
                        <Fragment key={i}>
                          <button
                            type="button"
                            onClick={() => seek(w.start)}
                            title={`${w.start.toFixed(2)}–${w.end.toFixed(2)}s · ${(w.probability * 100).toFixed(0)}%`}
                            className={cn(
                              'rounded px-0.5 transition-colors hover:bg-muted',
                              current && 'bg-primary text-primary-foreground',
                              w.probability < 0.5 && 'underline decoration-amber-500 decoration-dotted underline-offset-4',
                            )}
                          >
                            {w.word}
                          </button>{' '}
                        </Fragment>
                      )
                    })}
                  </p>
                ) : (
                  <p className="pr-8">{res.text}</p>
                )}
              </div>
            ) : (
              <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">No speech detected.</p>
            )}
            {res.words?.length ? <p className="text-xs text-muted-foreground">Click a word to play from there. Dotted underline = low confidence.</p> : null}
            <Stats
              items={[
                res.language && `language: ${res.language}`,
                `${result!.ms.toFixed(0)} ms`,
                audioSeconds > 0 && `${(audioSeconds / (result!.ms / 1000)).toFixed(1)}× real time`,
                res.ttft_ms != null && `first token ${res.ttft_ms.toFixed(0)} ms`,
                res.decode_tps != null && `decode ${res.decode_tps.toFixed(0)} tok/s`,
              ]}
            />
            <RawJson value={res} />
          </>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {!ready ? 'Load Whistle above to start.' : audio ? 'Press Transcribe to convert the audio to text.' : 'Record, upload or drop audio, then press Transcribe.'}
          </p>
        )}
      </div>
    </div>
  )
}
