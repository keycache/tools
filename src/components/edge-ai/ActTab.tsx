import { useState } from 'react'
import { Loader2, Mic, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioInput, type CapturedAudio } from '@/components/edge-ai/AudioInput'
import { EmptyNote, ErrorNote, JsonPanel, KeyValues, ResultTabs, Segmented, Select, Stats, Textarea } from '@/components/edge-ai/shared'
import { cactus, useModel } from '@/lib/cactus/client'
import { withDateFact, type CompleteResult, type FunctionCall, type ToolSchema } from '@/lib/cactus/engine'
import { EXTRACT_PRESETS, TOOL_PRESETS, parseJson } from '@/lib/cactus/presets'
import { cn } from '@/lib/utils'

type Mode = 'tools' | 'extract'

const CUSTOM = 'custom'
const pretty = (v: unknown) => JSON.stringify(v, null, 2)

const TOOLS_PLACEHOLDER = `[
  {
    "name": "send_email",
    "description": "Send an email to a contact",
    "parameters": {
      "type": "object",
      "properties": { "to": { "type": "string" }, "subject": { "type": "string" } },
      "required": ["to"]
    }
  }
]`

const SCHEMA_PLACEHOLDER = `{
  "name": "order",
  "description": "An online order confirmation",
  "parameters": {
    "type": "object",
    "properties": { "item": { "type": "string" }, "total": { "type": "number" } },
    "required": ["item"]
  }
}`

function validateTools(value: unknown): string | null {
  const list = Array.isArray(value) ? value : [value]
  if (!list.length) return 'Add at least one tool.'
  for (const t of list) {
    if (!t || typeof t !== 'object' || typeof (t as ToolSchema).name !== 'string') return 'Each tool needs a "name".'
    const params = (t as ToolSchema).parameters
    if (!params || params.type !== 'object' || typeof params.properties !== 'object')
      return `Tool "${(t as ToolSchema).name}" needs parameters: { type: "object", properties: {…} }.`
  }
  return null
}

/** Editable JSON per preset; "custom" starts empty and is never overwritten by other presets. */
function initialConfigs<T>(presets: { id: string }[], toJson: (p: T) => string): Record<string, string> {
  return Object.fromEntries([[CUSTOM, ''], ...presets.map((p) => [p.id, toJson(p as T)])])
}

export function ActTab() {
  const needle = useModel('needle')
  const whistle = useModel('whistle')
  const [mode, setMode] = useState<Mode>('tools')

  const [toolPreset, setToolPreset] = useState(CUSTOM)
  const [toolsJson, setToolsJson] = useState(() => initialConfigs<(typeof TOOL_PRESETS)[number]>(TOOL_PRESETS, (p) => pretty(p.tools)))
  const [query, setQuery] = useState('')

  const [extractPreset, setExtractPreset] = useState(CUSTOM)
  const [schemaJson, setSchemaJson] = useState(() => initialConfigs<(typeof EXTRACT_PRESETS)[number]>(EXTRACT_PRESETS, (p) => pretty(p.schema)))
  const [extractText, setExtractText] = useState('')

  const [result, setResult] = useState<{ mode: Mode; res: CompleteResult; ms: number } | null>(null)
  const [resultTab, setResultTab] = useState('calls')
  const [running, setRunning] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = needle.status === 'ready'
  const isTools = mode === 'tools'
  const preset = isTools ? toolPreset : extractPreset
  const configText = (isTools ? toolsJson : schemaJson)[preset]
  const setConfigText = (text: string) => (isTools ? setToolsJson : setSchemaJson)((prev) => ({ ...prev, [preset]: text }))
  const input = isTools ? query : extractText
  const setInput = isTools ? setQuery : setExtractText

  const configEmpty = !configText.trim()
  const parsed = parseJson<ToolSchema[] | ToolSchema>(configText)
  const configError = configEmpty ? null : (parsed.error ?? validateTools(parsed.value))
  const canRun = ready && !running && !transcribing && !!input.trim() && !configEmpty && !configError
  const actionLabel = isTools ? 'Run' : 'Extract'
  const examples = isTools ? (TOOL_PRESETS.find((p) => p.id === toolPreset)?.examples ?? []) : []

  async function run() {
    if (!canRun || !parsed.value) return
    setRunning(true)
    setError(null)
    try {
      const tools = Array.isArray(parsed.value) ? parsed.value : [parsed.value]
      const { result: res, ms } = await cactus.complete({ system: withDateFact(''), tools, text: input })
      setResult({ mode, res, ms })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  function choosePreset(id: string) {
    setResult(null)
    if (isTools) {
      setToolPreset(id)
      const p = TOOL_PRESETS.find((x) => x.id === id)
      if (p) setQuery(p.examples[0])
    } else {
      setExtractPreset(id)
      const p = EXTRACT_PRESETS.find((x) => x.id === id)
      if (p) setExtractText(p.sample)
    }
  }

  // Speech fills the input box (nothing runs until the button is pressed), so it can be reviewed first.
  async function onVoice(audio: CapturedAudio) {
    URL.revokeObjectURL(audio.url)
    setTranscribing(true)
    setError(null)
    try {
      const { result: heard } = await cactus.transcribe(audio.pcm, {})
      if (heard.text) setInput(heard.text)
      else setError('No speech detected in that recording.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <div className="space-y-5">
      <Segmented
        label="Needle task"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setResult(null)
          setError(null)
        }}
        options={[
          { value: 'tools', label: 'Tool calls' },
          { value: 'extract', label: 'Extract' },
        ]}
      />

      {/* Same grid as Listen/See. Rows (lg): 1 = [input box | config box], fixed height; 2 = [input hint | config
          hint]; 3 = [voice input | preset + action]. `order-*` stacks each column together on small screens. */}
      <div className="grid gap-x-5 gap-y-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="needle-input" className="text-sm font-medium">
            {isTools ? 'Request' : 'Text'}
          </label>
          <Textarea
            id="needle-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run()
            }}
            placeholder={isTools ? 'e.g. Dim the bedroom lights and set a 10 minute timer' : 'Paste a notification, email, message or note…'}
            className="h-[22rem] resize-none"
          />
        </div>

        <div className="order-3 flex flex-col gap-1.5 lg:order-none">
          <label htmlFor="needle-config" className="text-sm font-medium">
            {isTools ? 'Tools your app exposes' : 'Shape to extract'}
          </label>
          <Textarea
            id="needle-config"
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            placeholder={`Write as JSON, e.g.\n${isTools ? TOOLS_PLACEHOLDER : SCHEMA_PLACEHOLDER}`}
            spellCheck={false}
            className="h-[22rem] resize-none font-mono text-xs"
          />
        </div>

        <div className="order-1 min-h-8 lg:order-none">
          {examples.length ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <span className="shrink-0 py-0.5 text-xs text-muted-foreground">Try:</span>
              {examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isTools ? 'Say what you want done, in plain words — or speak it.' : 'Any text works: notifications, emails, receipts, chat messages.'}{' '}
              <kbd className="font-sans">⌘/Ctrl + Enter</kbd> to {actionLabel.toLowerCase()}.
            </p>
          )}
        </div>

        <div className="order-4 space-y-2 lg:order-none">
          <p className="min-h-8 text-xs text-muted-foreground">
            {isTools
              ? 'JSON list of { name, description, parameters }. Optional "triggers": regexes that force a tool. Describe each tool by the actions it covers.'
              : 'One { name, description, parameters } object. Field descriptions guide formats, e.g. "YYYY-MM-DD".'}
          </p>
          {configError && <ErrorNote>{isTools ? 'Tools' : 'Shape'}: {configError}</ErrorNote>}
        </div>

        <div className="order-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 lg:order-none">
          <VoiceInput whistle={whistle} disabled={running || transcribing} onAudio={(a) => void onVoice(a)} />
          {transcribing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Transcribing…
            </span>
          )}
        </div>

        <div className="order-5 flex flex-wrap items-center gap-3 lg:order-none">
          <label htmlFor="needle-preset" className="text-sm font-medium">
            Preset
          </label>
          <Select id="needle-preset" value={preset} onChange={(e) => choosePreset(e.target.value)}>
            <option value={CUSTOM}>Custom</option>
            {(isTools ? TOOL_PRESETS : EXTRACT_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Button onClick={() => void run()} disabled={!canRun} className="ml-auto h-9 gap-2">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {actionLabel}
          </Button>
        </div>

        <div className="order-6 mt-2 space-y-4 lg:order-none lg:col-span-2">
          <h2 className="text-lg font-semibold">Result</h2>
          <ErrorNote>{error}</ErrorNote>
          {result ? (
            <>
              {result.mode === 'tools' ? (
                <ToolCallResult res={result.res} tab={resultTab} onTab={setResultTab} />
              ) : (
                <ExtractResult res={result.res} tab={resultTab} onTab={setResultTab} />
              )}
              <Stats
                items={[
                  `${result.ms.toFixed(0)} ms`,
                  result.res.prefill_tps != null && `prefill ${result.res.prefill_tps.toFixed(0)} tok/s`,
                  result.res.decode_tps != null && `decode ${result.res.decode_tps.toFixed(0)} tok/s`,
                ]}
              />
            </>
          ) : (
            <EmptyNote>
              {!ready
                ? 'Load Needle above to start.'
                : preset === CUSTOM && configEmpty
                  ? `Write your ${isTools ? 'tools' : 'shape'} (or pick a preset), add ${isTools ? 'a request' : 'some text'}, then press ${actionLabel}.`
                  : `Press ${actionLabel} to see the result.`}
            </EmptyNote>
          )}
        </div>
      </div>
    </div>
  )
}

function VoiceInput({ whistle, disabled, onAudio }: { whistle: ReturnType<typeof useModel>; disabled: boolean; onAudio: (a: CapturedAudio) => void }) {
  if (whistle.status === 'ready') return <AudioInput onAudio={onAudio} disabled={disabled} recordLabel="Speak" />
  return (
    <Button variant="outline" onClick={() => void whistle.load()} disabled={whistle.status === 'loading'} className="h-9 gap-2">
      {whistle.status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
      {whistle.status === 'loading' ? 'Loading Whistle…' : 'Enable voice input (+16 MB)'}
    </Button>
  )
}

function confidenceTone(c: number) {
  if (c >= 0.7) return { label: 'Act', className: 'bg-emerald-500' }
  if (c >= 0.3) return { label: 'Confirm first', className: 'bg-amber-500' }
  return { label: 'Low', className: 'bg-red-500' }
}

function Confidence({ value }: { value: number }) {
  const tone = confidenceTone(value)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Confidence</span>
        <span>
          {(value * 100).toFixed(0)}% · {tone.label}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone.className)} style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  )
}

function CallList({ calls, muted }: { calls: FunctionCall[]; muted?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {calls.map((c, i) => (
        <div key={i} className={cn('rounded-xl border p-3', muted && 'opacity-60')}>
          <p className="mb-2 font-mono text-sm font-semibold">{c.name}()</p>
          <KeyValues data={c.arguments ?? {}} />
        </div>
      ))}
    </div>
  )
}

function Reasoning({ text }: { text?: string }) {
  return text ? <p className="rounded-xl border p-3 text-sm text-muted-foreground">{text}</p> : <EmptyNote>No reasoning returned.</EmptyNote>
}

function ToolCallResult({ res, tab, onTab }: { res: CompleteResult; tab: string; onTab: (t: string) => void }) {
  const calls = res.function_calls ?? []
  const held = res.suppressed_calls ?? []
  const tabs = [
    { id: 'calls', label: 'Calls', count: calls.length },
    ...(held.length ? [{ id: 'withheld', label: 'Withheld', count: held.length }] : []),
    { id: 'reasoning', label: 'Reasoning' },
    { id: 'json', label: 'Raw JSON' },
  ]
  return (
    <div className="space-y-4">
      {typeof res.confidence === 'number' && <Confidence value={res.confidence} />}
      <ResultTabs idPrefix="needle-result" tabs={tabs} active={tab} onChange={onTab}>
        {(active) => (
          <>
            {active === 'calls' &&
              (calls.length ? (
                <CallList calls={calls} />
              ) : (
                <EmptyNote>
                  {held.length ? 'Below the confidence floor — see the Withheld tab.' : 'No tool fits this request, so nothing was called.'}
                </EmptyNote>
              ))}
            {active === 'withheld' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">These calls were below the confidence floor, so the engine withheld them.</p>
                <CallList calls={held} muted />
              </div>
            )}
            {active === 'reasoning' && <Reasoning text={res.reasoning} />}
            {active === 'json' && <JsonPanel value={res} />}
          </>
        )}
      </ResultTabs>
    </div>
  )
}

function ExtractResult({ res, tab, onTab }: { res: CompleteResult; tab: string; onTab: (t: string) => void }) {
  const call = res.function_calls?.[0] ?? res.suppressed_calls?.[0]
  const ungrounded = (res.validation as { ungrounded?: unknown[] } | undefined)?.ungrounded ?? []
  const tabs = [
    { id: 'fields', label: 'Fields', count: call ? Object.keys(call.arguments ?? {}).length : 0 },
    { id: 'reasoning', label: 'Reasoning' },
    { id: 'json', label: 'Raw JSON' },
  ]
  return (
    <ResultTabs idPrefix="needle-result" tabs={tabs} active={tab} onChange={onTab}>
      {(active) => (
        <>
          {active === 'fields' &&
            (call ? (
              <div className="space-y-2">
                <div className="rounded-xl border p-3">
                  <KeyValues data={call.arguments ?? {}} />
                </div>
                {ungrounded.length > 0 && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Not found literally in the text (double-check): {ungrounded.map(String).join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <EmptyNote>Nothing matching this shape was found in the text.</EmptyNote>
            ))}
          {active === 'reasoning' && <Reasoning text={res.reasoning} />}
          {active === 'json' && <JsonPanel value={res} />}
        </>
      )}
    </ResultTabs>
  )
}
