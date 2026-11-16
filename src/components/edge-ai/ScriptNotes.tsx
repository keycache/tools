import { useState } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { Diagnostic } from '@/lib/tts/script'
import { cn } from '@/lib/utils'

const SHOWN = 3
const RANK = { error: 0, warning: 1, hint: 2 } as const

const ICON = { error: CircleAlert, warning: TriangleAlert, hint: Info } as const
const TONE = {
  error: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  hint: 'text-muted-foreground',
} as const

/** Script marker diagnostics under the text box (errors first); "Line n" moves the cursor to that line. */
export function ScriptNotes({ id, diagnostics, onJump }: { id: string; diagnostics: Diagnostic[]; onJump: (line: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  if (!diagnostics.length) return null
  const sorted = [...diagnostics].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.line - b.line)
  const shown = expanded ? sorted : sorted.slice(0, SHOWN)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  return (
    <div id={id} className="space-y-0.5 text-xs">
      {errors > 0 && <p className="sr-only">{`${errors} marker error${errors > 1 ? 's' : ''} — fix ${errors > 1 ? 'them' : 'it'} to speak.`}</p>}
      <ul className="space-y-0.5">
        {shown.map((d, i) => {
          const Icon = ICON[d.severity]
          return (
            <li key={`${d.line}-${i}`} className={cn('flex items-start gap-1.5', TONE[d.severity])}>
              <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onJump(d.line)}>
                  Line {d.line}
                </button>
                <span className="sr-only"> ({d.severity})</span>: {d.message}
              </span>
            </li>
          )
        })}
      </ul>
      {diagnostics.length > SHOWN && (
        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `Show ${diagnostics.length - SHOWN} more`}
        </button>
      )}
    </div>
  )
}
