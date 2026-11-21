/**
 * Prompt templates: Markdown whose `## Settings` section holds one fenced block of `KEY = value` lines.
 * The block's values are the editable fields; everything else in the file is sent verbatim.
 */

export interface TemplateField {
  key: string
  /** The value written in the template, used to seed the form. */
  value: string
  /** From the matching `- KEY: description` entry below the block; empty when there is none. */
  description: string
  /** Index of the field's line in the template. */
  line: number
  /** The line up to and including `=` and the spacing after it, so alignment survives rendering. */
  prefix: string
}

export interface ParsedTemplate {
  lines: string[]
  fields: TemplateField[]
}

export class TemplateError extends Error {}

const FENCE = /^\s*(`{3,}|~{3,})/
const SETTING = /^(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)(.*)$/
const SETTINGS_HEADING = /^#{1,6}\s+settings\b/i

export function parseTemplate(markdown: string): ParsedTemplate {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const heading = lines.findIndex((l) => SETTINGS_HEADING.test(l))
  if (heading < 0) throw new TemplateError('This template has no "## Settings" section.')

  let open = -1
  for (let i = heading + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break
    if (FENCE.test(lines[i])) {
      open = i
      break
    }
  }
  if (open < 0) throw new TemplateError('The Settings section needs a fenced code block of KEY = value lines.')

  const marker = FENCE.exec(lines[open])![1]
  const closing = new RegExp(`^\\${marker[0]}{${marker.length},}$`)
  const close = lines.findIndex((l, i) => i > open && closing.test(l.trim()))
  if (close < 0) throw new TemplateError('The Settings code block is never closed.')

  const fields: TemplateField[] = []
  for (let i = open + 1; i < close; i++) {
    if (!lines[i].trim()) continue
    const m = SETTING.exec(lines[i])
    if (!m) throw new TemplateError(`Settings line ${i + 1} is not in the form KEY = value: "${lines[i].trim()}"`)
    if (fields.some((f) => f.key === m[2])) throw new TemplateError(`Setting ${m[2]} appears more than once.`)
    fields.push({ key: m[2], value: m[3].trim(), description: '', line: i, prefix: m[1] })
  }
  if (!fields.length) throw new TemplateError('The Settings block is empty.')

  // Descriptions follow the block as "- KEY: text" entries; indented or plain lines continue the previous entry.
  let current: TemplateField | undefined
  for (let i = close + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^#{1,6}\s/.test(line)) break
    const entry = /^[-*]\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*:\s*(.*)$/.exec(line)
    if (entry) {
      current = fields.find((f) => f.key === entry[1])
      if (current) current.description = entry[2].trim()
    } else if (current) {
      current.description = `${current.description} ${line.trim()}`.trim()
    }
  }

  return { lines, fields }
}

/** One line per value, and no way to close the surrounding code fence. */
function cleanValue(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').replace(/`{3,}/g, '`').replace(/~{3,}/g, '~').trim()
}

export function renderTemplate(template: ParsedTemplate, values: Record<string, string>): string {
  const lines = [...template.lines]
  for (const f of template.fields) lines[f.line] = f.prefix + cleanValue(values[f.key] ?? f.value)
  return lines.join('\n')
}

export function initialValues(template: ParsedTemplate): Record<string, string> {
  return Object.fromEntries(template.fields.map((f) => [f.key, f.value]))
}
