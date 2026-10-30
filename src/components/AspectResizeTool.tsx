import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CropEditor } from '@/components/CropEditor'
import { ImageDropzone } from '@/components/ImageDropzone'
import {
  PRESETS,
  centeredRect,
  isValidRatio,
  planRender,
  type FitMode,
  type Rect,
} from '@/lib/aspect'
import { FORMAT_EXT, renderToBlob, type ImageFormat } from '@/lib/image'

interface Loaded {
  name: string
  url: string
  img: HTMLImageElement
}

const FORMATS: { value: ImageFormat; label: string }[] = [
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/webp', label: 'WebP' },
]

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: 'crop', label: 'Center crop' },
  { value: 'pad', label: 'Pad' },
  { value: 'stretch', label: 'Stretch' },
]

export function AspectResizeTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [ratioKey, setRatioKey] = useState<string>('16:9')
  const [customW, setCustomW] = useState('3')
  const [customH, setCustomH] = useState('2')
  const [boxEnabled, setBoxEnabled] = useState(true)
  const [boxState, setBoxState] = useState<{ ratio: number; rect: Rect } | null>(null)
  const [fit, setFit] = useState<FitMode>('crop')
  const [padColor, setPadColor] = useState('#ffffff')
  const [format, setFormat] = useState<ImageFormat>('image/png')
  const [quality, setQuality] = useState(92)
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File) {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (loaded) URL.revokeObjectURL(loaded.url)
      setLoaded({ name: file.name, url, img })
      setBoxState(null)
      setError(null)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Could not read that image.')
    }
    img.src = url
  }

  const preset = PRESETS.find((p) => p.label === ratioKey)
  const ratioW = preset ? preset.w : Number(customW)
  const ratioH = preset ? preset.h : Number(customH)
  const ratio = isValidRatio(ratioW, ratioH) ? ratioW / ratioH : null

  const size = loaded ? { w: loaded.img.naturalWidth, h: loaded.img.naturalHeight } : null

  let rect: Rect | null = null
  if (boxEnabled && ratio && size) {
    rect = boxState?.ratio === ratio ? boxState.rect : centeredRect(size, ratio)
  }

  const plan = size && ratio ? planRender(size, ratio, rect, fit) : null
  const padding = !rect && fit === 'pad'

  async function handleDownload() {
    if (!loaded || !plan) return
    try {
      const fill = padding || format === 'image/jpeg' ? padColor : null
      const blob = await renderToBlob(loaded.img, plan, format, quality / 100, fill)
      const base = loaded.name.replace(/\.[^.]+$/, '')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${base}-${plan.width}x${plan.height}.${FORMAT_EXT[format]}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }

  if (!loaded || !size) {
    return (
      <div className="space-y-3">
        <ImageDropzone onFile={handleFile} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <CropEditor
          src={loaded.url}
          size={size}
          ratio={ratio ?? 1}
          rect={rect}
          onChange={(r) => ratio && setBoxState({ ratio, rect: r })}
        />
      </div>

      <Card>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Aspect ratio</Label>
            <ToggleGroup
              variant="outline"
              spacing={1}
              className="flex-wrap"
              value={[ratioKey]}
              onValueChange={(v) => v[0] && setRatioKey(v[0])}
            >
              {PRESETS.map((p) => (
                <ToggleGroupItem key={p.label} value={p.label}>
                  {p.label}
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
            </ToggleGroup>
            {!preset && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  aria-label="Ratio width"
                />
                <span>:</span>
                <Input
                  type="number"
                  min={1}
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  aria-label="Ratio height"
                />
              </div>
            )}
            {!ratio && <p className="text-sm text-destructive">Enter a positive ratio.</p>}
          </div>

          <div className="space-y-2">
            <Label>Crop box</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBoxEnabled((on) => !on)}
              disabled={!ratio}
            >
              {boxEnabled ? 'Remove crop box (use whole image)' : 'Add crop box'}
            </Button>
          </div>

          {!boxEnabled && (
            <div className="space-y-2">
              <Label>Fit whole image by</Label>
              <ToggleGroup
                variant="outline"
                spacing={1}
                className="flex-wrap"
                value={[fit]}
                onValueChange={(v) => v[0] && setFit(v[0] as FitMode)}
              >
                {FIT_MODES.map((m) => (
                  <ToggleGroupItem key={m.value} value={m.value}>
                    {m.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          <div className="space-y-2">
            <Label>Format</Label>
            <ToggleGroup
              variant="outline"
              spacing={1}
              value={[format]}
              onValueChange={(v) => v[0] && setFormat(v[0] as ImageFormat)}
            >
              {FORMATS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value}>
                  {f.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {format !== 'image/png' && (
            <div className="space-y-2">
              <Label>Quality: {quality}</Label>
              <Slider
                min={10}
                max={100}
                value={[quality]}
                onValueChange={(v) => setQuality(Array.isArray(v) ? v[0] : v)}
              />
            </div>
          )}

          {(padding || format === 'image/jpeg') && (
            <div className="flex items-center gap-3">
              <Label htmlFor="pad-color">Background</Label>
              <input
                id="pad-color"
                type="color"
                value={padColor}
                onChange={(e) => setPadColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border"
              />
            </div>
          )}

          {plan && (
            <p className="text-sm text-muted-foreground">
              Output: {plan.width} × {plan.height}px (original {size.w} × {size.h}px)
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col gap-2">
            <Button onClick={handleDownload} disabled={!plan}>
              Download
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(loaded.url)
                setLoaded(null)
              }}
            >
              Choose another image
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
