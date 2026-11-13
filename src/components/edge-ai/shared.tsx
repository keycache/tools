import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const fieldClass =
  'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'min-h-20 resize-y', className)} {...props} />
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  // The native arrow hugs the right border and differs per browser, so hide it and draw our own
  // chevron with consistent right padding.
  return (
    <span className="relative inline-flex">
      <select className={cn(fieldClass, 'h-9 w-auto cursor-pointer appearance-none py-0 pr-9', className)} {...props} />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stats({ items }: { items: (string | false | null | undefined)[] }) {
  const shown = items.filter(Boolean) as string[]
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      {shown.map((s) => (
        <span key={s} className="rounded-md bg-muted px-2 py-0.5 tabular-nums">
          {s}
        </span>
      ))}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('gap-1.5', className)}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  )
}

export function RawJson({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2)
  return (
    <details className="rounded-lg border text-sm">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground select-none">Raw JSON</summary>
      <div className="relative border-t bg-muted/40">
        <CopyButton text={json} label="Copy JSON" className="absolute top-2 right-2 bg-background" />
        <pre className="max-h-96 overflow-auto p-3 pr-28 text-xs">{json}</pre>
      </div>
    </details>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{children}</p>
}

export function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (!entries.length) return <p className="text-sm text-muted-foreground">No fields.</p>
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-muted-foreground">{k}</dt>
          <dd className="break-words">{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProbabilityBar({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-sm">
      <span className={cn('truncate', highlight && 'font-medium')}>{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', highlight ? 'bg-primary' : 'bg-muted-foreground/40')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
    </div>
  )
}

/** Pretty-printed JSON with a copy button, for "Raw JSON" result tabs. */
export function JsonPanel({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2)
  return (
    <div className="relative rounded-xl border bg-muted/40">
      <CopyButton text={json} label="Copy JSON" className="absolute top-2 right-2 bg-background" />
      <pre className="max-h-96 overflow-auto p-3 pr-28 text-xs">{json}</pre>
    </div>
  )
}

export function EmptyNote({ children = 'Nothing found.' }: { children?: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>
}

export interface ResultTab {
  id: string
  label: string
  count?: number | null
}

/**
 * Underlined tab bar + panel used by every Result section. If `active` isn't among `tabs`
 * (e.g. a section disappeared on re-run), the first tab is shown.
 */
export function ResultTabs({
  idPrefix,
  tabs,
  active,
  onChange,
  children,
}: {
  idPrefix: string
  tabs: ResultTab[]
  active: string
  onChange: (id: string) => void
  children: (active: string) => ReactNode
}) {
  const current = tabs.some((t) => t.id === active) ? active : tabs[0]?.id
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Result sections" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const selected = current === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel`}
              onClick={() => onChange(t.id)}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                selected ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {t.count != null && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{t.count}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${current}`}>
        {current && children(current)}
      </div>
    </div>
  )
}
