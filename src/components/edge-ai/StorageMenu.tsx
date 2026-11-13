import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/cactus/media'

export interface StorageEntry {
  id: string
  label: string
  bytes: number
  clear: () => Promise<void>
  /** Checked by default when the Clear menu opens (default true). */
  preselect?: boolean
}

/** "Stored in browser: X · Clear" with a menu to pick which stores to remove. */
export function StorageMenu({ entries }: { entries: StorageEntry[] }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const total = entries.reduce((sum, e) => sum + e.bytes, 0)
  const removable = entries.filter((e) => e.bytes > 0)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function removeSelected() {
    setBusy(true)
    try {
      await Promise.all(entries.filter((e) => selected.has(e.id)).map((e) => e.clear()))
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2 text-xs text-muted-foreground">
      <span>Stored in browser: {formatBytes(total)}</span>
      {removable.length > 0 && (
        <Button
          variant="ghost"
          size="xs"
          className="gap-1"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setSelected(new Set(removable.filter((e) => e.preselect !== false).map((e) => e.id)))
            setOpen((o) => !o)
          }}
        >
          <Trash2 /> Clear
        </Button>
      )}
      {open && (
        <div role="dialog" aria-label="Clear browser storage" className="absolute top-full right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border bg-background p-3 text-sm text-foreground shadow-lg">
          <p className="text-xs text-muted-foreground">Choose what to remove. Models already loaded stay usable on this page.</p>
          <div className="space-y-1.5">
            {removable.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.has(e.id)}
                  onChange={(ev) => {
                    const next = new Set(selected)
                    if (ev.target.checked) next.add(e.id)
                    else next.delete(e.id)
                    setSelected(next)
                  }}
                />
                <span className="flex-1">{e.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(e.bytes)}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={!selected.size || busy} onClick={() => void removeSelected()}>
              Remove selected
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
