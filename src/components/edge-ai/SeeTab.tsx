import { useEffect, useState } from 'react'
import { ImagePlus, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageDropzone } from '@/components/ImageDropzone'
import { EmptyNote, ErrorNote, JsonPanel, KeyValues, ProbabilityBar, RawJson, ResultTabs, Segmented, Select, Stats, Textarea } from '@/components/edge-ai/shared'
import { cactus, useModel } from '@/lib/cactus/client'
import { boxRect, imageToRgb, polygonPoints, type RgbImage } from '@/lib/cactus/media'
import { CUSTOM_FORM_EXAMPLE, LANGUAGES, SCENE_FORM, parseJson } from '@/lib/cactus/presets'
import stopSignUrl from '@/assets/samples/stop-sign.jpg'
import { cn } from '@/lib/utils'

type Mode = 'describe' | 'form'
type FormPreset = 'custom' | 'scene'

interface MirageObject {
  id: number
  name: string
  bbox?: number[]
  score?: number
  mask?: number[]
  position?: string
  description?: Record<string, unknown>
}
interface MirageText {
  string: string
  bbox?: number[]
  score?: number
}
interface MirageRelation {
  subject: number
  predicate: string
  object: number
}
interface FormField {
  value: unknown
  /** enum / integer fields: distribution over choices ("-" = abstain). */
  probabilities?: Record<string, number>
  /** string fields: probability of the generated value. */
  probability?: number
}
interface MirageResult {
  scene?: Record<string, unknown>
  objects?: MirageObject[]
  regions?: MirageObject[]
  text?: MirageText[]
  relations?: MirageRelation[]
  events?: unknown[]
  reasoning?: string
  form?: Record<string, FormField>
}

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']
const color = (i: number) => COLORS[i % COLORS.length]

/** Mirage `sections` option names (verified against the engine; unknown names are rejected). */
const SECTIONS = [
  { id: 'scene', label: 'Scene', hint: 'setting, lighting, weather' },
  { id: 'objects', label: 'Objects', hint: 'names, boxes, masks, attributes' },
  { id: 'regions', label: 'Regions', hint: 'things mentioned without a box' },
  { id: 'text', label: 'Text (OCR)', hint: 'writing in the image' },
  { id: 'relations', label: 'Relations', hint: 'how objects connect' },
  { id: 'events', label: 'Events', hint: 'actions taking place' },
  { id: 'reasoning', label: 'Reasoning', hint: "the model's trace" },
]

export function SeeTab() {
  const mirage = useModel('mirage')
  const [image, setImage] = useState<(RgbImage & { url: string; name: string }) | null>(null)
  const [mode, setMode] = useState<Mode>('describe')
  const [language, setLanguage] = useState('en')
  const [formPreset, setFormPreset] = useState<FormPreset>('custom')
  // Each preset keeps its own text, so switching to "Scene" and back never loses custom questions.
  const [customJson, setCustomJson] = useState('')
  const [sceneJson, setSceneJson] = useState(JSON.stringify(SCENE_FORM, null, 2))
  const formJson = formPreset === 'scene' ? sceneJson : customJson
  const setFormJson = formPreset === 'scene' ? setSceneJson : setCustomJson
  const [result, setResult] = useState<{ mode: Mode; res: MirageResult; ms: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState({ masks: true, boxes: true, text: true })
  const [hover, setHover] = useState<number | null>(null)
  const [sections, setSections] = useState<string[]>(SECTIONS.map((x) => x.id))
  const [dragging, setDragging] = useState(false)
  const [resultTab, setResultTab] = useState('scene')
  const ready = mirage.status === 'ready'

  useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image])

  const formEmpty = !formJson.trim()
  const form = parseJson<Record<string, unknown>>(formJson)
  const formError =
    mode === 'form' && !formEmpty && (form.error ?? (form.value && typeof form.value === 'object' && Object.keys(form.value).length ? null : 'Add at least one field.'))
  const formBlocked = mode === 'form' && (formEmpty || !!formError)

  async function run() {
    if (!image || formBlocked || (mode === 'describe' && !sections.length)) return
    setRunning(true)
    setError(null)
    try {
      const allSections = sections.length === SECTIONS.length
      const options = mode === 'form' ? { form: form.value } : allSections ? {} : { sections }
      const { result: res, ms } = await cactus.describe(image.rgb, image.width, image.height, options, language)
      setResult({ mode, res: res as MirageResult, ms })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  async function choosePreset(preset: FormPreset) {
    setFormPreset(preset)
    setResult(null)
    if (preset !== 'scene') return
    // The Scene questions are written for the bundled stop-sign photo, so load it alongside them.
    try {
      const blob = await (await fetch(stopSignUrl)).blob()
      await onFile(new File([blob], 'stop-sign.jpg', { type: blob.type || 'image/jpeg' }))
    } catch (err) {
      setError(`Could not load the sample image: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function onFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError(`"${file.name}" isn't an image.`)
      return
    }
    try {
      const rgb = await imageToRgb(file)
      setImage({ ...rgb, url: URL.createObjectURL(file), name: file.name })
      setResult(null)
    } catch (err) {
      setError(`Could not read image: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const res = result?.mode === 'describe' ? result.res : null
  const actionLabel = mode === 'form' ? 'Answer' : 'Describe'

  return (
    <div className="space-y-5">
      <Segmented
        label="Mirage task"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setResult(null)
        }}
        options={[
          { value: 'describe', label: 'Describe' },
          { value: 'form', label: 'Ask (form)' },
        ]}
      />

      {/* Grid rows (lg): 1 = [image box | options box], both a fixed height so loading an image never moves the
          layout; 2 = [image info | hint]; 3 = [image actions | language + action button]. `order-*` stacks
          each column together on small screens. */}
      <div className="grid gap-x-5 gap-y-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Image</p>
          {image ? (
            <div
              className={cn('relative h-[22rem] overflow-hidden rounded-xl border bg-muted/30 transition-colors', dragging && 'border-primary bg-muted')}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void onFile(f)
              }}
            >
              <img src={image.url} alt={image.name} className="absolute inset-0 size-full object-contain" />
              {res && <Overlay res={res} layers={layers} hover={hover} width={image.width} height={image.height} />}
            </div>
          ) : (
            <ImageDropzone onFile={(f) => void onFile(f)} className="h-[22rem]" />
          )}
        </div>

        <div className="order-3 flex flex-col gap-1.5 lg:order-none">
          {mode === 'form' ? (
            <>
              <label htmlFor="mirage-form" className="text-sm font-medium">
                Questions
              </label>
              <Textarea
                id="mirage-form"
                value={formJson}
                onChange={(e) => setFormJson(e.target.value)}
                placeholder={`Write your questions as JSON, e.g.\n${CUSTOM_FORM_EXAMPLE}`}
                spellCheck={false}
                className="h-[22rem] resize-none font-mono text-xs"
              />
            </>
          ) : (
            <>
              <p id="mirage-sections" className="text-sm font-medium">
                What to describe
              </p>
              <div role="group" aria-labelledby="mirage-sections" className="flex h-[22rem] flex-col justify-center gap-1 overflow-y-auto rounded-lg border p-3">
                {SECTIONS.map((sct) => (
                  <label key={sct.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={sections.includes(sct.id)}
                      onChange={(e) => setSections(e.target.checked ? SECTIONS.filter((x) => x.id === sct.id || sections.includes(x.id)).map((x) => x.id) : sections.filter((x) => x !== sct.id))}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className="text-sm">
                      <span className="font-medium">{sct.label}</span>
                      <span className="text-muted-foreground"> — {sct.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="order-1 text-xs text-muted-foreground lg:order-none">{image ? `${image.name} · ${image.width}×${image.height}` : ''}</p>

        <div className="order-4 space-y-2 lg:order-none">
          <p className="min-h-8 text-xs text-muted-foreground">
            {mode === 'form'
              ? 'Filled in order. Use { "enum": [...] } or { "type": "integer", "minimum", "maximum" }; free-text { "type": "string" } fields are experimental. "unsure" means the model abstained.'
              : 'Masks, boxes and detected text are drawn on the image; objects are listed under Result.'}
          </p>
          {formError && <ErrorNote>Questions: {formError}</ErrorNote>}
          {mode === 'describe' && !sections.length && <ErrorNote>Pick at least one thing to describe.</ErrorNote>}
        </div>

        <div className="order-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 lg:order-none">
          {image && (
            <>
              <label className="cursor-pointer">
                <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted">
                  <ImagePlus className="size-4" /> Change image
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void onFile(f)
                  }}
                />
              </label>
              {res &&
                (['masks', 'boxes', 'text'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="size-4 accent-primary" />
                    {k}
                  </label>
                ))}
            </>
          )}
        </div>

        <div className="order-5 flex flex-wrap items-center gap-3 lg:order-none">
          {mode === 'form' && (
            <>
              <label htmlFor="mirage-preset" className="text-sm font-medium">
                Preset
              </label>
              <Select id="mirage-preset" value={formPreset} onChange={(e) => void choosePreset(e.target.value as FormPreset)}>
                <option value="custom">Custom</option>
                <option value="scene">Scene</option>
              </Select>
            </>
          )}
          <label htmlFor="mirage-lang" className="text-sm font-medium">
            Language
          </label>
          <Select id="mirage-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => void run()}
            disabled={!ready || !image || running || formBlocked || (mode === 'describe' && !sections.length)}
            className="ml-auto h-9 gap-2"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {actionLabel}
          </Button>
        </div>

        <div className="order-6 mt-2 space-y-4 lg:order-none lg:col-span-2">
          <h2 className="text-lg font-semibold">Result</h2>
          <ErrorNote>{error}</ErrorNote>
          {result ? (
            <>
              {result.mode === 'describe' ? (
                <DescribeResult res={result.res} onHover={setHover} hover={hover} tab={resultTab} onTab={setResultTab} />
              ) : (
                <FormResult form={result.res.form ?? {}} />
              )}
              <Stats items={[`${result.ms.toFixed(0)} ms`, image && `${image.width}×${image.height} input`]} />
              {result.mode === 'form' && <RawJson value={result.res} />}
            </>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {!ready ? 'Load Mirage above to start.' : image ? `Press ${actionLabel} to analyse the image.` : `Choose or drop an image, then press ${actionLabel}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Mirage geometry is on a 0–1000 scale per axis. Scaling it into image pixels and using
 * `xMidYMid meet` makes the SVG letterbox exactly like the `object-contain` <img> beneath it.
 */
function Overlay({
  res,
  layers,
  hover,
  width,
  height,
}: {
  res: MirageResult
  layers: { masks: boolean; boxes: boolean; text: boolean }
  hover: number | null
  width: number
  height: number
}) {
  const objects = res.objects ?? []
  const sx = width / 1000
  const sy = height / 1000
  const rect = (bbox: number[]) => {
    const r = boxRect(bbox)
    return { x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy }
  }
  const font = Math.max(width, height) / 45
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 size-full">
      {objects.map((o, i) => {
        const dim = hover != null && hover !== i
        return (
          <g key={i} opacity={dim ? 0.2 : 1}>
            {layers.masks && o.mask && o.mask.length >= 6 && (
              <polygon points={polygonPoints(o.mask, sx, sy)} fill={color(i)} fillOpacity={0.3} stroke={color(i)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            )}
            {layers.boxes && o.bbox && <rect {...rect(o.bbox)} fill="none" stroke={color(i)} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        )
      })}
      {layers.text &&
        (res.text ?? []).map(
          (t, i) =>
            t.bbox && <rect key={`t${i}`} {...rect(t.bbox)} fill="none" stroke="#facc15" strokeDasharray="6 4" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
        )}
      {layers.boxes &&
        objects.map((o, i) => {
          if (!o.bbox || (hover != null && hover !== i)) return null
          const x = o.bbox[0] * sx
          const y = Math.max(o.bbox[1] * sy, font * 1.3)
          return (
            <g key={`l${i}`}>
              <rect x={x} y={y - font * 1.3} width={o.name.length * font * 0.6 + font * 0.6} height={font * 1.3} rx={font * 0.2} fill={color(i)} />
              <text x={x + font * 0.3} y={y - font * 0.35} fontSize={font} fontWeight={600} fill="white">
                {o.name}
              </text>
            </g>
          )
        })}
    </svg>
  )
}

function attrs(o: MirageObject) {
  return [o.position, ...Object.values(o.description ?? {}).map(String)].filter(Boolean).join(' · ')
}

const RESULT_TABS: { id: keyof MirageResult | 'json'; label: string }[] = [
  { id: 'scene', label: 'Scene' },
  { id: 'objects', label: 'Objects' },
  { id: 'regions', label: 'Regions' },
  { id: 'text', label: 'Text' },
  { id: 'relations', label: 'Relations' },
  { id: 'events', label: 'Events' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'json', label: 'Raw JSON' },
]

/** One tab per section present in the engine's JSON (plus Raw JSON); the selected tab is kept across runs. */
function DescribeResult({
  res,
  hover,
  onHover,
  tab,
  onTab,
}: {
  res: MirageResult
  hover: number | null
  onHover: (i: number | null) => void
  tab: string
  onTab: (t: string) => void
}) {
  const tabs = RESULT_TABS.filter((t) => t.id === 'json' || t.id in res)
  const objects = res.objects ?? []
  const nameOf = (id: number) => [...objects, ...(res.regions ?? [])].find((o) => o.id === id)?.name ?? `#${id}`
  const count = (id: string) => {
    const v = res[id as keyof MirageResult]
    return Array.isArray(v) ? v.length : null
  }

  return (
    <ResultTabs
      idPrefix="mirage-result"
      tabs={tabs.map((t) => ({ id: t.id, label: t.label, count: count(t.id) }))}
      active={tab}
      onChange={(t) => {
        onTab(t)
        onHover(null)
      }}
    >
      {(active) => (
        <>
        {active === 'scene' && (res.scene && Object.keys(res.scene).length ? <KeyValues data={res.scene} /> : <EmptyNote />)}

        {active === 'objects' &&
          (objects.length ? (
            <ul className="divide-y rounded-xl border" onMouseLeave={() => onHover(null)}>
              {objects.map((o, i) => (
                <li key={i} onMouseEnter={() => onHover(i)} className={cn('flex items-center gap-3 px-3 py-2 text-sm', hover === i && 'bg-muted/60')}>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: color(i) }} />
                  <span className="font-medium">{o.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{attrs(o)}</span>
                  {o.score != null && <span className="text-xs tabular-nums text-muted-foreground">{(o.score * 100).toFixed(0)}%</span>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No objects detected.</EmptyNote>
          ))}

        {active === 'regions' &&
          (res.regions?.length ? (
            <ul className="divide-y rounded-xl border">
              {res.regions.map((r, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{attrs(r)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No other regions mentioned.</EmptyNote>
          ))}

        {active === 'text' &&
          (res.text?.length ? (
            <ul className="divide-y rounded-xl border">
              {res.text.map((t, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 font-mono break-words">{t.string}</span>
                  {t.score != null && <span className="text-xs tabular-nums text-muted-foreground">{(t.score * 100).toFixed(0)}%</span>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No text found in the image.</EmptyNote>
          ))}

        {active === 'relations' &&
          (res.relations?.length ? (
            <ul className="divide-y rounded-xl border">
              {res.relations.map((r, i) => (
                <li key={i} className="px-3 py-2 text-sm">
                  <span className="font-medium">{nameOf(r.subject)}</span> <span className="font-mono text-muted-foreground">{r.predicate.replace(/_/g, ' ')}</span>{' '}
                  <span className="font-medium">{nameOf(r.object)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No relations between objects.</EmptyNote>
          ))}

        {active === 'events' &&
          (res.events?.length ? (
            <ul className="divide-y rounded-xl border">
              {res.events.map((ev, i) => (
                <li key={i} className="px-3 py-2 text-sm">
                  {typeof ev === 'object' && ev !== null ? <KeyValues data={ev as Record<string, unknown>} /> : String(ev)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No events depicted.</EmptyNote>
          ))}

        {active === 'reasoning' &&
          (res.reasoning ? (
            <ul className="space-y-1.5 rounded-xl border p-3 text-sm text-muted-foreground">
              {res.reasoning.split(' | ').map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          ) : (
            <EmptyNote />
          ))}

        {active === 'json' && <JsonPanel value={res} />}
        </>
      )}
    </ResultTabs>
  )
}

function FormResult({ form }: { form: Record<string, FormField> }) {
  return (
    <div className="space-y-4">
      {Object.entries(form).map(([name, field]) => {
        const probs = Object.entries(field.probabilities ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
        // The engine reports an abstention as null (or "-", its key in `probabilities`).
        const unsure = field.value == null || field.value === '-'
        const chosen = unsure ? '-' : String(field.value)
        return (
          <div key={name} className="space-y-2 rounded-xl border p-3">
            <p className="text-sm">
              <span className="font-mono text-muted-foreground">{name}: </span>
              <span className="font-semibold">{unsure ? 'unsure' : String(field.value)}</span>
              {field.probability != null && <span className="text-xs text-muted-foreground"> · {(field.probability * 100).toFixed(1)}%</span>}
            </p>
            {probs.map(([label, p]) => (
              <ProbabilityBar key={label} label={label === '-' ? '(unsure)' : label} value={p} highlight={label === chosen} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
