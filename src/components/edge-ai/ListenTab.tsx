import { Fragment, useEffect, useRef, useState } from 'react'
import { Copy, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioInput, type CapturedAudio } from '@/components/edge-ai/AudioInput'
import { ErrorNote, Field, RawJson, Select, Stats, Textarea } from '@/components/edge-ai/shared'
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

  const res = result?.res
  const audioSeconds = audio?.seconds ?? 0

  return (
    // Grid cells: [audio box | keywords box] share row 1, so the two boxes get identical heights;
    // [player | options] share row 2; results span both columns. `order-*` keeps a sensible
    // audio → player → keywords → options order when the columns stack on small screens.
    <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Audio</p>
        <AudioInput onAudio={onAudio} disabled={running} dropzone className="flex-1" />
      </div>

      <div className="order-2 flex flex-col gap-1.5 lg:order-none">
        <label htmlFor="whistle-keywords" className="text-sm font-medium">
          Keywords
        </label>
        <Textarea id="whistle-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="min-h-20 flex-1" />
      </div>

      <div className="order-1 lg:order-none">
        {audio && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {audio.name} · {audio.seconds.toFixed(1)}s
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
          </div>
        )}
      </div>

      <div className="order-3 flex flex-col gap-4 lg:order-none">
        <p className="-mt-2.5 text-xs text-muted-foreground">One per line. Biases recognition towards names and jargon, e.g. Siobhan, Kubernetes.</p>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Language" htmlFor="whistle-lang">
            <Select id="whistle-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Detect automatically</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} className="size-4 accent-primary" />
            Word timestamps
          </label>
        </div>
        <Button onClick={() => void transcribe()} disabled={!ready || !audio || running} className="gap-2 self-start">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Transcribe
        </Button>
      </div>

      <div className="order-4 mt-1 space-y-4 lg:order-none lg:col-span-2">
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
