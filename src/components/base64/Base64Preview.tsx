import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Base64Client } from '@/lib/base64/client'
import { INLINE_CHARS } from '@/lib/base64/codec'
import { safeFileName, type DetectedFormat } from '@/lib/base64/format'
import { officeSections, type OfficeSection } from '@/lib/base64/office'
import type { ArchiveEntry, OfficeFormat } from '@/lib/base64/protocol'
import { useObjectUrl } from '@/lib/useObjectUrl'

type Preview =
  | { kind: 'loading' }
  | { kind: 'media' }
  | { kind: 'svg'; blob: Blob }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'archive'; entries: ArchiveEntry[] }
  | { kind: 'office'; sections: OfficeSection[]; truncated: boolean }
  | { kind: 'unsupported'; message: string }

function isOffice(ext: string): ext is OfficeFormat { return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

async function rasterizeSvg(blob: Blob, signal: AbortSignal): Promise<Blob> {
  const image = new Image()
  const url = URL.createObjectURL(blob.slice(0, blob.size, 'image/svg+xml'))
  let cancel = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(new DOMException('Preview cancelled.', 'AbortError'))
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) { cancel(); return }
      timer = setTimeout(() => reject(new Error('SVG preview exceeded 10 seconds.')), 10_000)
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The browser could not decode this SVG as an image.'))
      image.src = url
    })
    if (signal.aborted) throw new DOMException('Preview cancelled.', 'AbortError')
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) throw new Error('SVG previews require nonzero dimensions within 16 megapixels.')
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available for a safe SVG preview.')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('Could not generate the SVG raster preview.'))
    }, 'image/png'))
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    image.onload = null
    image.onerror = null
    image.src = ''
    URL.revokeObjectURL(url)
  }
}

export default function Base64Preview({ blob, format }: { blob: Blob; format: DetectedFormat | null }) {
  const [client] = useState(() => new Base64Client())
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const [mediaStatus, setMediaStatus] = useState('Loading browser preview...')
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<{ blob: Blob; name: string } | null>(null)
  const mediaKind = format?.mime.startsWith('image/') ? 'image' : format?.mime.startsWith('audio/') ? 'audio'
    : format?.mime.startsWith('video/') ? 'video' : null
  const mediaBlob = useMemo(() => mediaKind && format && format.mime !== 'image/svg+xml' ? blob.slice(0, blob.size, format.mime) : null, [blob, format, mediaKind])
  const mediaUrl = useObjectUrl(preview.kind === 'svg' ? preview.blob : mediaBlob)
  const extractedUrl = useObjectUrl(extracted?.blob ?? null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function load(): Promise<Preview> {
      if (!blob.size) return { kind: 'unsupported', message: 'This is an empty file. There is nothing to preview.' }
      if (!format) return { kind: 'unsupported', message: 'Unknown format. The original bytes are available for download.' }
      if (format.ext === 'pdf') return { kind: 'unsupported', message: 'PDF preview is intentionally excluded. You can download the PDF.' }
      if (mediaKind) {
        if (mediaKind === 'image' && blob.size > 8 * 1024 * 1024) return { kind: 'unsupported', message: 'Image previews are limited to 8 MiB. Download the original file instead.' }
        if (format.mime === 'image/svg+xml') return { kind: 'svg', blob: await rasterizeSvg(blob, controller.signal) }
        return { kind: 'media' }
      }
      if (format.ext === 'zip') {
        const result = await client.run({ type: 'archive', source: blob })
        if (result.kind !== 'archive') throw new Error('Unexpected archive response.')
        return { kind: 'archive', entries: result.entries }
      }
      if (isOffice(format.ext)) {
        const result = await client.run({ type: 'office', source: blob, format: format.ext })
        if (result.kind !== 'office') throw new Error('Unexpected Office response.')
        return { kind: 'office', sections: officeSections(result.parts), truncated: result.truncated }
      }
      if (format.encoding || format.mime.startsWith('text/') || ['json', 'xml'].includes(format.ext)) {
        const bytes = await blob.slice(0, INLINE_CHARS).arrayBuffer()
        let text = new TextDecoder(format.encoding ?? 'utf-8', { fatal: true }).decode(bytes, { stream: blob.size > INLINE_CHARS })
        if (format.ext === 'json' && blob.size <= INLINE_CHARS) text = JSON.stringify(JSON.parse(text), null, 2)
        return { kind: 'text', text: text.slice(0, INLINE_CHARS), truncated: blob.size > INLINE_CHARS || text.length > INLINE_CHARS }
      }
      return { kind: 'unsupported', message: 'No browser preview is available for this format. Download the original file to open it.' }
    }
    void load().then((value) => { if (active) setPreview(value) }).catch((issue: unknown) => {
      if (active && !isAbort(issue)) setError(`Preview failed: ${errorMessage(issue)} The original download is unchanged.`)
    })
    return () => { active = false; controller.abort(); client.cancel() }
  }, [blob, format, mediaKind, client])

  async function extract(index: number) {
    setExtracting(true)
    setError(null)
    setExtracted(null)
    try {
      const result = await client.run({ type: 'extract', source: blob, index })
      if (result.kind !== 'extracted') throw new Error('Unexpected extraction response.')
      setExtracted({ blob: result.blob, name: safeFileName(result.name) })
    } catch (issue) {
      if (!isAbort(issue)) setError(`Extraction failed: ${errorMessage(issue)}`)
    } finally { setExtracting(false) }
  }

  const showMedia = mediaKind && format && mediaUrl && (preview.kind === 'media' || preview.kind === 'svg')
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Decoded file preview">
      <h3 className="font-semibold">Preview</h3>
      {showMedia ? (
        <>
          {mediaKind === 'image' ? <img src={mediaUrl} alt="Decoded file" className="max-h-96 max-w-full object-contain" onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) {
              image.removeAttribute('src')
              setMediaStatus('Preview unavailable: images are limited to 16 megapixels. The original download is unchanged.')
            } else setMediaStatus('Image preview available.')
          }} onError={() => setMediaStatus('Preview unavailable: this browser cannot display the image. The original download is unchanged.')} />
            : mediaKind === 'audio' ? <audio controls preload="metadata" src={mediaUrl} className="w-full" onLoadedMetadata={() => setMediaStatus('Audio preview available.')} onError={() => setMediaStatus('Preview unavailable: this audio format or codec is not supported by your browser.')} />
              : <video controls preload="metadata" src={mediaUrl} className="max-h-96 w-full" onLoadedMetadata={() => setMediaStatus('Video preview available.')} onError={() => setMediaStatus('Preview unavailable: this video container or codec is not supported by your browser.')} />}
          <p role="status" className="text-sm text-muted-foreground">{mediaStatus}</p>
          {preview.kind === 'svg' && <p className="text-sm text-muted-foreground">SVG is shown as a static PNG preview. The SVG download retains its original bytes.</p>}
        </>
      ) : (
        <>
          {preview.kind === 'loading' && !error && <p role="status">Preparing preview...</p>}
          {preview.kind === 'unsupported' && <p className="text-sm text-muted-foreground">{preview.message}</p>}
          {preview.kind === 'text' && <>
            <p className="text-sm text-muted-foreground">Source preview only. HTML, XML, and Markdown are shown as text and never executed.{preview.truncated && ' Showing a bounded preview of up to 65,536 characters.'}</p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{preview.text}</pre>
          </>}
          {preview.kind === 'archive' && <>
            <p className="text-sm text-muted-foreground">{preview.entries.length} {preview.entries.length === 1 ? 'entry' : 'entries'}. Listed sizes are declared by the archive; long paths are shortened for display. Extract one file at a time (8 MiB expanded limit). Nested archives are not opened automatically.</p>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead><tr><th className="p-2">Path</th><th className="p-2">Declared bytes</th><th className="p-2">Action</th></tr></thead>
                <tbody>{preview.entries.map((entry) => <tr key={entry.index} className="border-t">
                  <td className="max-w-80 break-all p-2">{entry.name.length > 240 ? `${entry.name.slice(0, 240)}...` : entry.name}</td><td className="p-2">{entry.size.toLocaleString()}</td>
                  <td className="p-2"><Button variant="outline" size="sm" disabled={extracting || entry.name.endsWith('/')} onClick={() => void extract(entry.index)}>Extract file {entry.index + 1}</Button></td>
                </tr>)}</tbody>
              </table>
            </div>
            {extracting && <Button variant="outline" onClick={client.cancel}>Cancel extraction</Button>}
            {extracted && extractedUrl && <a className="text-sm underline" href={extractedUrl} download={extracted.name}>Download extracted {extracted.name}</a>}
          </>}
          {preview.kind === 'office' && <>
            <p className="text-sm text-muted-foreground">Content preview, not original layout. At most 24 XML parts, 1,000 paragraphs per part, 200 rows and 30 columns per sheet, 2,000 total cells, and 65,536 characters of cell/text content. Spreadsheet dates remain stored values; formulas and macros are never executed.{preview.truncated && ' Additional parts were omitted.'}</p>
            {preview.sections.map((section) => <div key={section.name} className="space-y-2">
              <h4 className="break-all text-sm font-medium">{section.name.length > 240 ? `${section.name.slice(0, 240)}...` : section.name}</h4>
              {section.rows ? <div className="max-h-80 overflow-auto"><table className="text-left text-xs"><tbody>{section.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-64 break-words border p-2">{cell}</td>)}</tr>)}</tbody></table></div>
                : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{section.text || 'No text content found.'}</pre>}
            </div>)}
          </>}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
