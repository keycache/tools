import type { OfficePart } from './protocol'
import { INLINE_CHARS } from './codec'

export interface OfficeSection { name: string; text?: string; rows?: string[][] }

function parse(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Document type and entity declarations are not allowed in Office previews.')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('An Office XML part is malformed.')
  return document
}

function text(element: Element): string {
  return [...element.getElementsByTagNameNS('*', 't')].map((node) => node.textContent ?? '').join('')
}

function column(reference: string): number {
  const letters = reference.match(/^[A-Z]{1,3}/)?.[0]
  if (!letters) throw new Error('A spreadsheet cell has an invalid reference.')
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return value - 1
}

export function officeSections(parts: OfficePart[]): OfficeSection[] {
  const sharedPart = parts.find((part) => part.name === 'xl/sharedStrings.xml')
  const shared = sharedPart ? parse(sharedPart.xml).getElementsByTagNameNS('*', 'si') : null
  let remaining = INLINE_CHARS
  let remainingCells = 2000
  const clip = (value: string) => {
    const clipped = value.slice(0, Math.max(0, remaining))
    remaining -= clipped.length
    return clipped
  }
  return parts.filter((part) => part !== sharedPart).map((part) => {
    const document = parse(part.xml)
    if (part.name.startsWith('xl/worksheets/')) {
      const rows: string[][] = []
      for (const row of [...document.getElementsByTagNameNS('*', 'row')].slice(0, 200)) {
        if (remaining <= 0 || remainingCells <= 0) break
        const values: string[] = []
        for (const cell of [...row.getElementsByTagNameNS('*', 'c')].slice(0, 30)) {
          const index = column(cell.getAttribute('r') ?? '')
          if (index >= 30) continue
          if (index + 1 - values.length > remainingCells) break
          const type = cell.getAttribute('t')
          const value = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? ''
          let display = value
          if (type === 's') {
            const sharedIndex = Number(value)
            if (!shared || !/^\d+$/.test(value) || !Number.isSafeInteger(sharedIndex) || !shared[sharedIndex]) throw new Error('A shared spreadsheet string is missing.')
            display = text(shared[sharedIndex])
          } else if (type === 'inlineStr') display = text(cell)
          else if (type === 'b') display = value === '1' ? 'TRUE' : 'FALSE'
          else if (!value) {
            const formula = cell.getElementsByTagNameNS('*', 'f')[0]?.textContent
            if (formula) display = `=${formula}`
          }
          while (values.length <= index) { values.push(''); remainingCells-- }
          values[index] = clip(display)
        }
        rows.push(values)
        if (remaining <= 0) break
      }
      return { name: part.name, rows }
    }
    const paragraphs: string[] = []
    for (const paragraph of document.getElementsByTagNameNS('*', 'p')) {
      paragraphs.push(clip(`${text(paragraph)}\n`))
      if (remaining <= 0 || paragraphs.length >= 1000) break
    }
    return { name: part.name, text: paragraphs.join('').trimEnd() }
  })
}
