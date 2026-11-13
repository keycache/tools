import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StoredConversation } from '@/lib/gemma/storage'
import { cn } from '@/lib/utils'

interface Props {
  conversations: StoredConversation[]
  activeId: string | null
  /** While a reply is generating, switching / deleting is disabled. */
  disabled: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onClose?: () => void
  className?: string
}

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export function ConversationList({ conversations, activeId, disabled, onSelect, onNew, onRename, onDelete, onClose, className }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    if (editing && draft.trim()) onRename(editing, draft.trim())
    setEditing(null)
  }

  return (
    <nav aria-label="Saved chats" className={cn('flex flex-col overflow-hidden rounded-xl border bg-background', className)}>
      <div className="flex items-center gap-2 border-b p-2">
        <Button variant="outline" size="sm" onClick={onNew} disabled={disabled} className="flex-1 gap-2">
          <MessageSquarePlus className="size-4" /> New chat
        </Button>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close chat list" className="lg:hidden">
            <X className="size-4" />
          </Button>
        )}
      </div>
      {conversations.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">Chats are saved in this browser after the first message.</p>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {conversations.map((c) => {
            const active = c.id === activeId
            if (editing === c.id) {
              return (
                <li key={c.id} className="flex items-center gap-1 rounded-md bg-muted p-1">
                  <label htmlFor={`rename-${c.id}`} className="sr-only">
                    Chat name
                  </label>
                  <input
                    id={`rename-${c.id}`}
                    ref={inputRef}
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    onBlur={commit}
                    className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-sm outline-none focus:border-ring"
                  />
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} aria-label="Save name" className="rounded p-1 hover:bg-background">
                    <Check className="size-3.5" />
                  </button>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(null)} aria-label="Cancel rename" className="rounded p-1 hover:bg-background">
                    <X className="size-3.5" />
                  </button>
                </li>
              )
            }
            if (confirming === c.id) {
              return (
                <li key={c.id} className="flex items-center gap-1 rounded-md bg-destructive/10 p-1 pl-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">Delete “{c.title}”?</span>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => {
                      setConfirming(null)
                      onDelete(c.id)
                    }}
                  >
                    Delete
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </li>
              )
            }
            return (
              <li key={c.id} className={cn('group flex items-center rounded-md', active ? 'bg-muted' : 'hover:bg-muted/60')}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  disabled={disabled && !active}
                  aria-current={active ? 'true' : undefined}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left disabled:opacity-50"
                >
                  <span className={cn('block truncate text-sm', active && 'font-medium')}>{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{when(c.updatedAt)}</span>
                </button>
                <div className={cn('flex shrink-0 items-center pr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100', active && 'opacity-100')}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(c.title)
                      setEditing(c.id)
                    }}
                    aria-label={`Rename ${c.title}`}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(c.id)}
                    disabled={disabled && active}
                    aria-label={`Delete ${c.title}`}
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
