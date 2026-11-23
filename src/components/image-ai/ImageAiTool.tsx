import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Download, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ImageDropzone } from '@/components/ImageDropzone'
import { ImageModelClient } from '@/lib/image-ai/client'
import { cachedModelBytes, deleteModelCache, fetchModelManifest, IMAGE_MODELS, type ImageDevice, type ImageScale, type ImageTool, type ModelAsset } from '@/lib/image-ai/models'
import { MAX_INPUT_PIXELS, upscaleSize, watermarkSize } from '@/lib/image-ai/processing'
import type { ImageResult } from '@/lib/image-ai/protocol'
import { isOpfsSupported } from '@/lib/transformers/opfsCache'

function useObjectUrl(blob: Blob | null): string | null {
  const [value, setValue] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    // The effect owns this external resource, including Strict Mode cleanup.
    // oxlint-disable-next-line react/set-state-in-effect
    setValue({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return value?.blob === blob ? value.url : null
}

interface SelectedImage { file: File; width: number; height: number }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

export function ImageAiTool({ tool }: { tool: ImageTool }) {
  const [client] = useState(() => new ImageModelClient(tool))
  const state = useSyncExternalStore(client.subscribe, client.getState)
  const [asset, setAsset] = useState<ModelAsset | null>(null)
  const [stored, setStored] = useState(0)
  const [checking, setChecking] = useState(true)
  const [image, setImage] = useState<SelectedImage | null>(null)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [passes, setPasses] = useState(1)
  const [scale, setScale] = useState<ImageScale>(2)
  const [device, setDevice] = useState<ImageDevice>(() => typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selection = useRef({ version: 0 })
  const originalUrl = useObjectUrl(image?.file ?? null)
  const outputUrl = useObjectUrl(result?.blob ?? null)
  const watermark = tool === 'watermark'
  const info = IMAGE_MODELS[tool]
  const busy = state.status === 'loading' || state.status === 'running' || reading || deleting
  let plannedSize: { width: number; height: number } | null = null
  let sizeError: string | null = null
  if (image) {
    try {
      plannedSize = watermark ? watermarkSize(image.width, image.height) : upscaleSize(image.width, image.height, scale)
    } catch (issue) {
      sizeError = message(issue)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const currentSelection = selection.current
    void fetchModelManifest(controller.signal).then(async (models) => {
      const current = models[tool]
      const bytes = await cachedModelBytes(tool, current)
      if (!controller.signal.aborted) {
        setAsset(current)
        setStored(bytes)
        setChecking(false)
      }
    }).catch((issue: unknown) => {
      if (!controller.signal.aborted) {
        setError(message(issue))
        setChecking(false)
      }
    })
    return () => {
      controller.abort()
      currentSelection.version++
      client.dispose()
    }
  }, [client, tool])

  useEffect(() => {
    if (!asset || deleting || state.status === 'loading' || state.status === 'running') return
    let active = true
    void cachedModelBytes(tool, asset).then((bytes) => {
      if (active) setStored(bytes)
    }).catch((issue: unknown) => {
      if (active) setError(`Could not check downloaded model storage: ${message(issue)}`)
    })
    return () => { active = false }
  }, [asset, deleting, state.status, tool])

  const selectFile = useCallback(async (file: File) => {
    const current = ++selection.current.version
    setError(null)
    setResult(null)
    setReading(true)
    try {
      if (!file.type.startsWith('image/')) throw new Error('Please select an image file.')
      const bitmap = await createImageBitmap(file)
      try {
        if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) throw new Error('Input images are limited to 16 megapixels. Resize the image first.')
        if (selection.current.version === current) setImage({ file, width: bitmap.width, height: bitmap.height })
      } finally {
        bitmap.close()
      }
    } catch (issue) {
      if (selection.current.version === current) setError(`Could not read the image: ${message(issue)}`)
    } finally {
      if (selection.current.version === current) setReading(false)
    }
  }, [])

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (busy) return
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'))
      if (!file) return
      event.preventDefault()
      void selectFile(file)
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [busy, selectFile])

  async function loadModel() {
    if (!asset) return
    setError(null)
    try {
      await client.load(asset, device)
    } catch (issue) {
      if (!aborted(issue)) setError(message(issue))
    }
  }

  async function processImage() {
    if (!image) return
    setError(null)
    setResult(null)
    try {
      setResult(await client.process(image.file, passes, scale))
    } catch (issue) {
      if (!aborted(issue)) setError(message(issue))
    }
  }

  async function deleteDownloadedModel() {
    setDeleting(true)
    setError(null)
    client.dispose()
    try {
      await deleteModelCache(tool)
      setStored(0)
    } catch (issue) {
      setError(`Could not delete the downloaded model: ${message(issue)}`)
    } finally {
      setDeleting(false)
    }
  }

  const selectClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50'
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {watermark
          ? 'Remove watermarks locally with the FODUU model. The saved PNG keeps your image aspect ratio within 256 x 256 pixels; it is not enlarged back to the original size.'
          : 'Enlarge photos with Swin2SR, entirely on your device. Choose 2x, 3x, or 4x while preserving the original aspect ratio.'}
        {' '}Your images are never uploaded.
      </p>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        {watermark
          ? 'Experimental: this model reconstructs the whole image, not just the watermark. It can blur or change clean areas. More passes may degrade detail. Use only images you own or have permission to edit.'
          : 'AI predicts plausible detail; it cannot recover exact missing information and may alter text, faces, or textures. 3x uses two 2x passes followed by downsampling; 4x uses two passes. Repeated passes may amplify artifacts.'}
        <p className="mt-2 text-muted-foreground">Transparency is flattened onto white. Processing happens only when you press the action button.</p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{info.name}</h2>
              <p className="text-sm text-muted-foreground">
                {asset ? `${(asset.bytes / 1e6).toFixed(1)} MB` : `About ${info.megabytes} MB`} model download, plus about 30 MB of shared runtime assets on first use.
              </p>
              <p className="text-sm text-muted-foreground">
                {checking ? 'Checking model assets...' : stored > 0 ? 'Model downloaded to this browser.' : 'Model not downloaded to this browser.'}
                {' '}Browser storage may be evicted; reopening the whole app offline is not guaranteed.
              </p>
            </div>
            <div className="flex gap-3 text-sm underline">
              <a href={`${import.meta.env.BASE_URL}licenses/image-models.txt`} target="_blank" rel="noreferrer">Licenses and attribution</a>
              <a href={`${import.meta.env.BASE_URL}models/LICENSE-2.0.txt`} target="_blank" rel="noreferrer">Apache-2.0</a>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1 sm:w-64">
              <Label htmlFor={`${tool}-device`}>Processing device</Label>
              <select id={`${tool}-device`} className={selectClass} value={device} disabled={busy} onChange={(event) => {
                client.dispose()
                setError(null)
                setDevice(event.target.value === 'wasm' ? 'wasm' : 'webgpu')
              }}>
                <option value="webgpu">WebGPU (recommended)</option>
                <option value="wasm">CPU / WASM (slower)</option>
              </select>
            </div>
            {state.status === 'ready' ? (
              <Button variant="outline" disabled={busy} onClick={client.dispose}>Unload model</Button>
            ) : (
              <Button disabled={busy || !asset} onClick={() => void loadModel()}>
                <Download /> {stored ? 'Load downloaded model' : 'Download and load model'}
              </Button>
            )}
            <Button variant="outline" disabled={busy || !isOpfsSupported()} onClick={() => void deleteDownloadedModel()}>
              <Trash2 /> Delete downloaded model
            </Button>
            {(state.status === 'loading' || state.status === 'running') && (
              <Button variant="outline" onClick={client.dispose}>Cancel</Button>
            )}
          </div>
          {device === 'wasm' && <p className="text-sm text-muted-foreground">CPU mode can be significantly slower, especially for upscaling. It runs in a worker to keep the page responsive.</p>}
          <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-2 text-sm">
            {(state.status === 'loading' || state.status === 'running') && <LoaderCircle className="size-4 animate-spin" />}
            {state.status === 'ready' ? 'Model ready. Images stay on your device.' : state.progress}
          </p>
          {state.warning && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{state.warning}</p>}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">Paste an image with Ctrl+V or Cmd+V to select or replace it.</p>
      {!image ? (
        reading ? <p role="status">Reading image...</p> : <ImageDropzone onFile={(file) => void selectFile(file)} onInvalidFile={setError} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            {watermark ? (
              <div className="w-40 space-y-1">
                <Label htmlFor="watermark-passes">Removal passes</Label>
                <select id="watermark-passes" className={selectClass} value={passes} disabled={busy} onChange={(event) => {
                  setPasses(Number(event.target.value))
                  setResult(null)
                }}>
                  {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {value === 1 ? 'pass' : 'passes'}</option>)}
                </select>
              </div>
            ) : (
              <div className="w-40 space-y-1">
                <Label htmlFor="upscale-factor">Scale</Label>
                <select id="upscale-factor" className={selectClass} value={scale} disabled={busy} onChange={(event) => {
                  const value = Number(event.target.value)
                  if (value === 2 || value === 3 || value === 4) setScale(value)
                  setResult(null)
                }}>
                  {[2, 3, 4].map((value) => <option key={value} value={value}>{value}x</option>)}
                </select>
              </div>
            )}
            <Button disabled={state.status !== 'ready' || busy || !!sizeError} onClick={() => void processImage()}>
              {watermark ? 'Remove watermark' : 'Upscale image'}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => {
              selection.current.version++
              setImage(null)
              setResult(null)
              setError(null)
            }}><RotateCcw /> Change image</Button>
            {plannedSize && <p className="text-sm text-muted-foreground">Output: {plannedSize.width} x {plannedSize.height} PNG</p>}
          </div>
          {sizeError && <p role="alert" className="text-sm text-destructive">{sizeError}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <figure className="min-w-0 space-y-2">
              <figcaption className="text-sm font-medium">Original - {image.width} x {image.height}</figcaption>
              {originalUrl && <img src={originalUrl} alt="Original image" className="h-80 w-full rounded-lg border bg-muted object-contain" />}
            </figure>
            <figure className="min-w-0 space-y-2">
              <figcaption className="text-sm font-medium">{result ? `Result - ${result.width} x ${result.height}` : 'Result preview'}</figcaption>
              {outputUrl && result
                ? <img src={outputUrl} alt={watermark ? 'Watermark removal result' : 'Upscaled image'} className="h-80 w-full rounded-lg border bg-muted object-contain" />
                : <div className="flex h-80 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">Your processed image will appear here.</div>}
            </figure>
          </div>
          {result && outputUrl && (
            <div className="flex flex-wrap items-center gap-3">
              <a className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={outputUrl}
                download={`${image.file.name.replace(/\.[^.]+$/, '')}-${watermark ? `cleaned-${passes}pass` : `${scale}x`}.png`}>
                <Download className="size-4" /> Download PNG
              </a>
              <p className="text-sm text-muted-foreground">{result.seconds.toFixed(1)} seconds, {(result.blob.size / 1024).toFixed(0)} KB</p>
            </div>
          )}
        </div>
      )}
      {(error || state.error) && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error || state.error}</p>}
    </div>
  )
}
