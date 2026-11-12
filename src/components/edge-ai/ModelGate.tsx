import { useEffect } from 'react'
import { CheckCircle2, Download, HardDrive, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ASSETS, ENGINE_ASSETS, type AssetId, type ModelId } from '@/lib/cactus/assets'
import { downloadSize, useModel } from '@/lib/cactus/client'
import { formatBytes } from '@/lib/cactus/media'

const MODEL_INFO: Record<ModelId, { name: string; blurb: string; href: string }> = {
  needle: {
    name: 'Needle 3',
    blurb: 'Tool calling and structured extraction from text.',
    href: 'https://cactuscompute.com/needle',
  },
  whistle: {
    name: 'Whistle',
    blurb: 'Speech to text in 7 languages, with word timestamps.',
    href: 'https://cactuscompute.com/blog/whistle',
  },
  mirage: {
    name: 'Mirage',
    blurb: 'Scene description, object detection, masks, OCR and visual forms.',
    href: 'https://cactuscompute.com/blog/mirage',
  },
}

interface Props {
  model: ModelId
  /** Only the visible tab auto-loads a model that is already in browser storage. */
  active: boolean
  cached: Set<AssetId>
}

export function ModelGate({ model, active, cached }: Props) {
  const { status, progress, error, load } = useModel(model)
  const info = MODEL_INFO[model]
  const isCached = [...ENGINE_ASSETS, model].every((id) => cached.has(id))

  useEffect(() => {
    if (active && isCached && status === 'idle') void load()
  }, [active, isCached, status, load])

  const size = formatBytes(ASSETS[model].bytes)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {info.name}{' '}
          <a href={info.href} target="_blank" rel="noreferrer" className="font-normal text-muted-foreground underline-offset-2 hover:underline">
            · {size} · about
          </a>
        </p>
        <p className="text-xs text-muted-foreground">{info.blurb}</p>
      </div>

      {status === 'ready' && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" /> Ready · runs offline
        </span>
      )}

      {status === 'loading' && <LoadingBar progress={progress} />}

      {status === 'idle' &&
        (isCached ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <HardDrive className="size-4" /> In browser storage
          </span>
        ) : (
          <Button onClick={() => void load()} className="gap-2">
            <Download className="size-4" />
            Download {formatBytes(downloadSize(model, cached))}
          </Button>
        ))}

      {status === 'error' && (
        <div className="flex w-full items-center gap-3">
          <p className="flex-1 text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void load()} className="gap-2">
            <RotateCcw className="size-4" /> Retry
          </Button>
        </div>
      )}

      {status === 'idle' && !isCached && (
        <p className="w-full text-xs text-muted-foreground">
          Downloaded once from this site, then kept in your browser so it loads instantly and works offline. Nothing you
          enter ever leaves your device.
        </p>
      )}
    </div>
  )
}

function LoadingBar({ progress }: { progress?: { loaded: number; total: number; fromCache: boolean } }) {
  const pct = progress ? Math.round((progress.loaded / progress.total) * 100) : 0
  const done = progress && progress.loaded >= progress.total
  const label = !progress
    ? 'Starting…'
    : done
      ? 'Initialising model…'
      : progress.fromCache
        ? 'Reading from browser storage…'
        : `Downloading ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
  return (
    <div className="w-full space-y-1.5 sm:w-72" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="flex-1">{label}</span>
        {!done && progress && !progress.fromCache && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
