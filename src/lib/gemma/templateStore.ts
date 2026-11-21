import ttsConversation from '@/lib/gemma/templates/tts-conversation.md?raw'
import { parseTemplate, TemplateError } from '@/lib/gemma/promptTemplate'

export interface StoredTemplate {
  id: string
  name: string
  markdown: string
  builtin?: boolean
}

export const BUILTIN_TEMPLATES: StoredTemplate[] = [{ id: 'builtin-tts-conversation', name: 'TTS conversation script', markdown: ttsConversation, builtin: true }]

const KEY = 'pocket-chat-templates-v1'
export const MAX_TEMPLATE_BYTES = 200_000

/** Imported templates live in localStorage: small text, same-origin, and never leave the device. */
export function loadImported(): StoredTemplate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((t): t is StoredTemplate => !!t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.markdown === 'string')
  } catch {
    return []
  }
}

function saveImported(list: StoredTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Imported template'
}

/** Validates and stores a template file; throws TemplateError with a message fit to show the user. */
export async function importTemplate(file: File): Promise<StoredTemplate> {
  if (file.size > MAX_TEMPLATE_BYTES) throw new TemplateError('That file is too large for a template (200 KB max).')
  const markdown = await file.text()
  parseTemplate(markdown)
  const template: StoredTemplate = { id: `imported-${Date.now().toString(36)}`, name: nameFromFile(file.name), markdown }
  try {
    saveImported([...loadImported(), template])
  } catch {
    throw new TemplateError("Browser storage is full — couldn't save the template.")
  }
  return template
}

export function removeImported(id: string) {
  saveImported(loadImported().filter((t) => t.id !== id))
}
