import { useEffect, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, HardDrive, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ASSETS, ENGINE_ASSETS, type AssetId, type ModelId, type Progress } from '@/lib/cactus/assets'
import { downloadSize, useModel } from '@/lib/cactus/client'
import { formatBytes } from '@/lib/cactus/media'

export type ModelSourceStatus = 'checking' | 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'

/** Everything the gate needs to know about a model, independent of which engine runs it. */
export interface ModelSource {
  name: string
  blurb: string
  href: string
  /** Headline size shown next to the name. */
  sizeBytes: number
  /** Extra size info, e.g. "+171 MB for audio". */
  sizeNote?: string
  status: ModelSourceStatus
  progress?: Progress
  error?: string
  /** Shown with the ready state, e.g. "loaded but not saved for offline use". */
  warning?: string
  /** Fully available in browser storage (load won't download anything). */
  cached: boolean
  /** What clicking Download will fetch. */
  downloadBytes: number
  /** Where the files come from, for the first-download note. */
  origin: string
  load?: () => void
  /** Can't run here at all (shown instead of the Download button). */
  unsupported?: string
  /** Could run, but downloading is blocked (e.g. not enough storage). */
  blocked?: string
  /** Shown when there's no load() yet. */
  unavailableNote?: string
}

interface Props {
  source: ModelSource
  /** Only the visible tab auto-loads a model that is already in browser storage. */
  active: boolean
}

export function ModelGate({ source, active }: Props) {
  const { status, load, cached } = source

  useEffect(() => {
    if (active && cached && status === 'idle' && load) load()
  }, [active, cached, status, load])

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {source.name}{' '}
          <a href={source.href} target="_blank" rel="noreferrer" className="font-normal text-muted-foreground underline-offset-2 hover:underline">
            · {formatBytes(source.sizeBytes)}
            {source.sizeNote ? ` (${source.sizeNote})` : ''} · about
          </a>
        </p>
        <p className="text-xs text-muted-foreground">{source.blurb}</p>
      </div>

      {status === 'checking' && (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking this device…
        </span>
      )}

      {status === 'ready' &&
        (source.warning ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" /> Ready · not saved for offline use
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Ready · runs offline
          </span>
        ))}

      {status === 'loading' && <LoadingBar progress={source.progress} />}

      {status === 'idle' &&
        (cached && load ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <HardDrive className="size-4" /> In browser storage
          </span>
        ) : (
          <Button onClick={load} disabled={!load || !!source.blocked} className="gap-2">
            <Download className="size-4" />
            Download {formatBytes(source.downloadBytes)}
          </Button>
        ))}

      {status === 'error' && (
        <div className="flex w-full items-center gap-3">
          <p role="alert" className="flex-1 text-sm text-destructive">
          {source.error}
        </p>
          {load && (
            <Button variant="outline" onClick={load} className="gap-2">
              <RotateCcw className="size-4" /> Retry
            </Button>
          )}
        </div>
      )}

      {status === 'ready' && source.warning && <Notice tone="warn">{source.warning}</Notice>}
      {status === 'unsupported' && <Notice tone="warn">{source.unsupported}</Notice>}
      {status === 'idle' && source.blocked && <Notice tone="warn">{source.blocked}</Notice>}
      {status === 'idle' && !load && source.unavailableNote && <Notice>{source.unavailableNote}</Notice>}

      {status === 'idle' && !cached && load && !source.blocked && (
        <p className="w-full text-xs text-muted-foreground">
          Downloaded once from {source.origin}, then kept in your browser so it loads instantly and works offline.
          Nothing you enter ever leaves your device.
        </p>
      )}
    </div>
  )
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return (
    <p className={`flex w-full items-start gap-2 text-xs ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
      {tone === 'warn' && <AlertTriangle className="mt-px size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

function LoadingBar({ progress }: { progress?: Progress }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0
  const done = progress && progress.loaded >= progress.total
  const label = !progress
    ? 'Starting…'
    : done
      ? 'Initialising model…'
      : progress.fromCache
        ? 'Reading from browser storage…'
        : `Downloading ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
  const phase = !progress ? 'Starting…' : done ? 'Initialising model…' : progress.fromCache ? 'Reading from browser storage…' : 'Downloading model…'
  return (
    <div className="w-full space-y-1.5 sm:w-72">
      {/* Announce phase changes only; the byte counter below updates several times a second. */}
      <span className="sr-only" role="status">
        {phase}
      </span>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="flex-1">{label}</span>
        {!done && progress && !progress.fromCache && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={phase}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={progress && !progress.fromCache && !done ? `${pct}% · ${label}` : phase}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const CACTUS_INFO: Record<ModelId, { name: string; blurb: string; href: string }> = {
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

/** Gate for the Cactus models (Listen / See / Act), adapting the Cactus client to a ModelSource. */
export function CactusModelGate({ model, active, cached }: { model: ModelId; active: boolean; cached: Set<AssetId> }) {
  const { status, progress, error, load } = useModel(model)
  const source: ModelSource = {
    ...CACTUS_INFO[model],
    sizeBytes: ASSETS[model].bytes,
    status,
    progress,
    error,
    cached: [...ENGINE_ASSETS, model].every((id) => cached.has(id)),
    downloadBytes: downloadSize(model, cached),
    origin: 'this site',
    load,
  }
  return <ModelGate source={source} active={active} />
}
