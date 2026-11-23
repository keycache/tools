export interface DetectedFormat {
  ext: string
  mime: string
  method: 'signature' | 'text heuristic'
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be'
}

function fieldCount(line: string, delimiter: string): number {
  let quoted = false
  let count = 1
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index++
      else quoted = !quoted
    } else if (!quoted && line[index] === delimiter) count++
  }
  return quoted ? 0 : count
}

export function detectText(bytes: Uint8Array, complete: boolean): DetectedFormat | null {
  if (!bytes.length) return null
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let text: string
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: !complete })
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
  // Binary controls distinguish a text candidate from arbitrary binary data.
  // oxlint-disable-next-line no-control-regex
  if (!text.length || /[\u0000-\u0008\u000e-\u001f]/.test(text)) return null
  const head = text.trimStart()
  let ext = 'txt'
  let mime = 'text/plain'
  if (/^[{[]/.test(head) && complete) {
    try { JSON.parse(text); ext = 'json'; mime = 'application/json' } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  if (ext === 'txt') {
    if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) { ext = 'svg'; mime = 'image/svg+xml' }
    else if (/^(?:<!doctype\s+html|<html[\s>])/i.test(head)) { ext = 'html'; mime = 'text/html' }
    else if (/^(?:<\?xml[\s>]|<[A-Za-z_][\w:.-]*(?:\s|>))/.test(head)) { ext = 'xml'; mime = 'application/xml' }
    else if (/^(?:#{1,6} |```)/m.test(text)) { ext = 'md'; mime = 'text/markdown' }
    else {
      const lines = text.trim().split(/\r?\n/).slice(0, 8)
      for (const delimiter of [',', ';', '\t']) {
        const counts = lines.map((line) => fieldCount(line, delimiter))
        if (counts.length > 1 && counts[0] > 1 && counts[0] <= 100 && counts.every((count) => count === counts[0])) {
          ext = delimiter === '\t' ? 'tsv' : 'csv'
          mime = delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv'
          break
        }
      }
    }
  }
  return { ext, mime, method: 'text heuristic', encoding }
}

export function downloadName(format: DetectedFormat | null): string {
  return `decoded.${format?.ext.match(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/i)?.[0] || 'bin'}`
}

export function downloadMime(format: DetectedFormat | null): string {
  const mime = format?.mime
  // Active documents must not execute in this origin if their blob URL is opened.
  return !mime || /^(?:text\/(?:html|xml)|application\/(?:xml|xhtml\+xml)|image\/svg\+xml)$/.test(mime)
    ? 'application/octet-stream' : mime
}

export function safeFileName(name: string): string {
  // oxlint-disable-next-line no-control-regex
  return name.split(/[/\\]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'file.bin'
}
