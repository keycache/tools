import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileText, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { initialValues, parseTemplate, renderTemplate, TemplateError } from '@/lib/gemma/promptTemplate'
import { BUILTIN_TEMPLATES, importTemplate, loadImported, removeImported, type StoredTemplate } from '@/lib/gemma/templateStore'

interface Props {
  /** Starting a template begins a new chat, so it needs a loaded model that isn't mid-reply. */
  disabled: boolean
  /** Receives the rendered template; the caller starts a new conversation with it. */
  onSubmit: (text: string) => void
}

export function PromptTemplates({ disabled, onSubmit }: Props) {
  const [open, setOpen] = useState(false)
  const [imported, setImported] = useState<StoredTemplate[]>(loadImported)
  const [selected, setSelected] = useState<StoredTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => {
    if (!selected) return null
    try {
      return parseTemplate(selected.markdown)
    } catch {
      return null
    }
  }, [selected])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close() {
    setOpen(false)
    setSelected(null)
    setError(null)
    buttonRef.current?.focus()
  }

  function choose(t: StoredTemplate) {
    try {
      setValues(initialValues(parseTemplate(t.markdown)))
      setSelected(t)
      setError(null)
    } catch (err) {
      setError(err instanceof TemplateError ? `${t.name}: ${err.message}` : String(err))
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return
    try {
      const t = await importTemplate(file)
      setImported(loadImported())
      choose(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function submit() {
    if (!selected || !parsed) return
    onSubmit(renderTemplate(parsed, values))
    close()
  }

  const all = [...BUILTIN_TEMPLATES, ...imported]

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <Button ref={buttonRef} variant="outline" onClick={() => (open ? close() : setOpen(true))} disabled={disabled} aria-expanded={open} aria-controls="prompt-templates" className="h-9 gap-2">
        <FileText className="size-4" /> Templates
      </Button>
      {open && (
        <div
          id="prompt-templates"
          role="group"
          aria-label="Prompt templates"
          className="absolute bottom-full left-0 z-20 mb-2 flex max-h-[min(32rem,70dvh)] w-[min(30rem,calc(100vw-1.5rem))] flex-col gap-3 overflow-y-auto rounded-xl border bg-background p-4 text-sm shadow-lg"
        >
          {!selected || !parsed ? (
            <>
              <p className="text-xs text-muted-foreground">Pick a template, fill in its settings, and Pocket Chat starts a new chat with the completed prompt.</p>
              <ul className="space-y-1">
                {all.map((t) => (
                  <li key={t.id} className="flex items-center gap-1">
                    <button type="button" onClick={() => choose(t)} className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-muted">
                      {t.name}
                      {t.builtin && <span className="ml-2 text-xs text-muted-foreground">built-in</span>}
                    </button>
                    {!t.builtin && (
                      <button
                        type="button"
                        aria-label={`Remove template ${t.name}`}
                        onClick={() => {
                          removeImported(t.id)
                          setImported(loadImported())
                        }}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-2 self-start">
                <Upload className="size-4" /> Import Markdown file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  void onImport(file)
                }}
              />
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelected(null)} aria-label="Back to templates" className="rounded p-1 hover:bg-muted">
                  <ArrowLeft className="size-4" />
                </button>
                <span className="min-w-0 flex-1 truncate font-medium">{selected.name}</span>
              </div>
              {parsed.fields.map((f) => {
                const id = `tpl-${f.key}`
                const long = f.value.length > 50
                return (
                  <div key={f.key} className="space-y-1">
                    <label htmlFor={id} className="block text-xs font-medium">
                      {f.key}
                    </label>
                    {long ? (
                      <textarea id={id} rows={3} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-describedby={f.description ? `${id}-help` : undefined} className="w-full resize-y rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ring" />
                    ) : (
                      <input id={id} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-describedby={f.description ? `${id}-help` : undefined} className="h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-ring" />
                    )}
                    {f.description && (
                      <p id={`${id}-help`} className="text-xs text-muted-foreground">
                        {f.description}
                      </p>
                    )}
                  </div>
                )
              })}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Start chat
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
