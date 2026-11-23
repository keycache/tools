import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Base64Client } from '@/lib/base64/client'
import { COPY_BYTES, INLINE_CHARS, MAX_BINARY_BYTES, MAX_ENCODED_BYTES, MAX_PASTED_CHARS } from '@/lib/base64/codec'
import { downloadMime, downloadName, safeFileName, type DetectedFormat } from '@/lib/base64/format'
import { useObjectUrl } from '@/lib/useObjectUrl'

const Base64Preview = lazy(() => import('@/components/base64/Base64Preview'))
type Mode = 'encode' | 'decode'
type Identification = { status: 'pending' } | { status: 'done'; format: DetectedFormat | null } | { status: 'failed'; message: string }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const bytesLabel = (bytes: number) => `${bytes.toLocaleString()} bytes`

function EncodedOutput({ blob }: { blob: Blob }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let active = true
    void blob.slice(0, INLINE_CHARS).text().then((value) => { if (active) setText(value) }).catch((issue: unknown) => {
      if (active) setError(`Could not display encoded text: ${message(issue)}. The download remains available.`)
    })
    return () => { active = false }
  }, [blob])
  async function copy() {
    setError(null)
    setCopied(false)
    try {
      await navigator.clipboard.writeText(await blob.text())
      setCopied(true)
    } catch (issue) { setError(`Could not copy Base64: ${message(issue)}. Use the text download instead.`) }
  }
  return (
    <div className="space-y-3">
      <Label htmlFor="base64-output">Base64 output{blob.size > INLINE_CHARS ? ' (first 64 KiB)' : ''}</Label>
      <textarea id="base64-output" readOnly value={text} rows={8} spellCheck={false} className="w-full rounded-lg border p-3 font-mono text-xs" />
      {blob.size > INLINE_CHARS && <p className="text-sm text-muted-foreground">The preview is truncated; the download contains the complete Base64 output.</p>}
      <Button variant="outline" disabled={blob.size > COPY_BYTES} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy complete Base64'}</Button>
      {blob.size > COPY_BYTES && <p className="text-sm text-muted-foreground">Copying is limited to 4 MiB. Download the complete output instead.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function Workflow({ mode }: { mode: Mode }) {
  const [client] = useState(() => new Base64Client())
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ blob: Blob; id: number } | null>(null)
  const [identification, setIdentification] = useState<Identification>({ status: 'pending' })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const generation = useRef({ value: 0 })
  const encode = mode === 'encode'
  const format = identification.status === 'done' ? identification.format : null
  const downloadBlob = useMemo(() => result
    ? encode ? result.blob : result.blob.slice(0, result.blob.size, downloadMime(format))
    : null, [result, encode, format])
  const outputUrl = useObjectUrl(downloadBlob)
  const filename = encode ? `${safeFileName(file?.name ?? 'text')}.base64.txt` : downloadName(format)
  const textLimitError = encode
    ? 'Text input is limited to 4 MiB of characters. Upload a UTF-8 text file for larger inputs.'
    : 'Pasted input is limited to 4 MiB of characters. Upload a Base64 text file instead.'

  useEffect(() => {
    const current = generation.current
    return () => { current.value++; client.cancel() }
  }, [client])

  const chooseFile = useCallback((next: File) => {
    setResult(null)
    setError(null)
    setText('')
    setProgress('')
    if (next.size > (encode ? MAX_BINARY_BYTES : MAX_ENCODED_BYTES)) {
      setFile(null)
      setError(encode ? 'Encoding is limited to 64 MiB per file.' : 'Base64 text files are limited to 96 MiB.')
    } else setFile(next)
  }, [encode])

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (busy) return
      const pasted = event.clipboardData?.files[0]
      if (!pasted) return
      event.preventDefault()
      chooseFile(pasted)
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [busy, chooseFile])

  function editText(value: string) {
    if (value.length > MAX_PASTED_CHARS) { setError(textLimitError); return }
    setText(value)
    setFile(null)
    setResult(null)
    setError(null)
    setProgress('')
  }

  function cancel() {
    generation.current.value++
    client.cancel()
    setBusy(false)
    setProgress('Operation cancelled. Any completed download remains available.')
    if (result && identification.status === 'pending') setIdentification({ status: 'failed', message: 'Format identification was cancelled.' })
  }

  async function convert() {
    if (encode && !file && !text) return
    const current = ++generation.current.value
    const active = () => generation.current.value === current
    setBusy(true)
    setError(null)
    setResult(null)
    setIdentification({ status: 'pending' })
    setProgress(encode ? 'Encoding...' : 'Decoding...')
    try {
      const source = file ?? new Blob([text])
      const converted = await client.run({ type: mode, source }, (percent) => {
        if (active()) setProgress(`${encode ? 'Encoding' : 'Decoding'}: ${percent}%`)
      })
      if (!active()) return
      if (converted.kind !== (encode ? 'encoded' : 'decoded')) throw new Error('Unexpected Base64 conversion response.')
      if (!('blob' in converted)) throw new Error('The conversion returned no file.')
      setResult({ blob: converted.blob, id: current })
      if (!encode) {
        setProgress('Decoding succeeded. Identifying the file...')
        try {
          const detected = await client.run({ type: 'detect', source: converted.blob })
          if (detected.kind !== 'detected') throw new Error('Unexpected identification response.')
          if (active()) setIdentification({ status: 'done', format: detected.format })
        } catch (issue) {
          if (active() && !aborted(issue)) setIdentification({ status: 'failed', message: message(issue) })
        }
      }
      if (active()) setProgress(encode ? 'Encoding succeeded.' : 'Decoding succeeded. Downloaded bytes are unchanged by detection and previews.')
    } catch (issue) {
      if (active() && !aborted(issue)) { setError(message(issue)); setProgress('Conversion failed.') }
    } finally { if (active()) setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="space-y-2 rounded-lg border-2 border-dashed p-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault()
          const dropped = event.dataTransfer.files[0]
          if (!busy && dropped) chooseFile(dropped)
        }}>
          <Label htmlFor="base64-file">{encode ? 'File to encode (any format)' : 'Base64 text file (optional)'}</Label>
          <input id="base64-file" type="file" disabled={busy} className="block w-full text-sm" onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) chooseFile(selected)
            event.target.value = ''
          }} />
          <p className="text-sm text-muted-foreground">Choose, drop, or paste a file with Ctrl+V / Cmd+V. The first clipboard file is selected. No extension or MIME type is required.</p>
          {file && <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="break-all">{file.name || 'Unnamed file'} - {bytesLabel(file.size)}</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFile(null); setResult(null); setError(null) }}>Clear file</Button>
          </div>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="base64-input">{encode ? 'Or enter text' : 'Or paste Base64'}</Label>
          <textarea id="base64-input" value={text} disabled={busy || !!file} spellCheck={false} rows={8} className="w-full rounded-lg border p-3 font-mono text-xs"
            placeholder={encode ? 'Type or paste text to encode as UTF-8' : 'Paste standard Base64, Base64URL, or a data:...;base64,... URL'}
            onChange={(event) => editText(event.target.value)} onPaste={(event) => {
              if (event.clipboardData.files.length) return
              const pasted = event.clipboardData.getData('text')
              const target = event.currentTarget
              if (text.length - (target.selectionEnd - target.selectionStart) + pasted.length > MAX_PASTED_CHARS) {
                event.preventDefault()
                setError(textLimitError)
              }
            }} />
          <p className="text-sm text-muted-foreground">{encode
            ? 'Text is encoded as UTF-8, preserving spaces and line breaks. Clear a selected file to enter text instead.'
            : 'ASCII whitespace and omitted final padding are accepted; mixed alphabets, invalid characters, padding, and trailing bits are rejected. Data URL MIME claims are not trusted. Empty Base64 decodes to an empty file.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy || (encode && !file && !text)} onClick={() => void convert()}>{busy && <LoaderCircle className="size-4 animate-spin" />}{encode ? 'Encode to Base64' : 'Decode Base64'}</Button>
          {busy && <Button variant="outline" onClick={cancel}>Cancel</Button>}
          <p role="status" aria-live="polite" className="text-sm">{progress}</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </Card>

      {result && <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">{encode ? 'Encoding succeeded' : 'Decoding succeeded'}</h2>
        <p className="text-sm">{bytesLabel(result.blob.size)}{encode ? ' of Base64 text' : ' reconstructed'}</p>
        {outputUrl && <a className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" href={outputUrl} download={filename}>
          <Download className="size-4" />{encode ? 'Download Base64 text' : `Download ${filename}`}
        </a>}
        {encode ? <EncodedOutput key={result.id} blob={result.blob} /> : <>
          {identification.status === 'pending' && <p role="status">Identifying format... The binary download is already available.</p>}
          {identification.status === 'failed' && <p role="alert" className="text-sm text-destructive">Format identification failed: {identification.message} Download the unchanged binary file above.</p>}
          {identification.status === 'done' && <>
            <p className="text-sm">{format
              ? `Detected: ${format.ext.toUpperCase()} - ${format.mime} (${format.method}${format.encoding ? `, ${format.encoding}` : ''}). Detection is a best-effort hint, not file validation.`
              : 'Format unknown. The complete binary data is still downloadable.'}</p>
            {format && downloadMime(format) !== format.mime && <p className="text-sm text-muted-foreground">For safety, active HTML/XML/SVG content downloads as a binary attachment with its detected extension. The file bytes are unchanged.</p>}
            <Suspense fallback={<p role="status">Loading preview support...</p>}><Base64Preview key={result.id} blob={result.blob} format={format} /></Suspense>
          </>}
        </>}
      </Card>}
    </div>
  )
}

export function Base64Tool() {
  const [mode, setMode] = useState<Mode>('encode')
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-muted-foreground">Convert any file or UTF-8 text to Base64, or reconstruct its original bytes from Base64. Everything stays in your browser. Detection and previews are optional conveniences; they never modify the reconstructed file.</p>
      <p className="text-sm text-muted-foreground">Limits: 64 MiB binary files, 96 MiB Base64 text files, 4 MiB pasted input/copy, and 65,536 displayed characters. ZIP/Office previews: 16 MiB compressed; extracted files: 8 MiB each. Larger text results are downloaded, not rendered in full. Tasks stop after 30 seconds. Raw Base64 does not preserve the original filename.</p>
      <a className="inline-block text-sm underline" href={`${import.meta.env.BASE_URL}licenses/base64.txt`} target="_blank" rel="noreferrer">Third-party licenses</a>
      <div role="group" aria-label="Base64 operation" className="flex gap-2">
        {(['encode', 'decode'] as const).map((value) => <Button key={value} aria-pressed={mode === value} variant={mode === value ? 'default' : 'outline'} onClick={() => setMode(value)}>{value === 'encode' ? 'Encode' : 'Decode'}</Button>)}
      </div>
      <Workflow key={mode} mode={mode} />
    </div>
  )
}
