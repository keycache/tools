import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Cpu, Loader2, MessageSquarePlus, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { CopyButton, ErrorNote, Select, Textarea } from '@/components/edge-ai/shared'
import { formatBytes } from '@/lib/cactus/media'
import type { Capability } from '@/lib/gemma/capability'
import { gemma, useGemma, type GemmaState } from '@/lib/gemma/client'
import { GEMMA_MODEL_ID, ORT_RUNTIME_BYTES, gemmaTotalBytes } from '@/lib/gemma/constants'
import { useGemmaCapability, type GemmaCacheState } from '@/lib/gemma/hooks'
import type { GenSettings, GenStats } from '@/lib/gemma/protocol'
import { cn } from '@/lib/utils'

interface Props {
  /** Whether the Chat tab is visible (drives auto-load from cache). */
  active: boolean
  /** Becomes true the first time the tab is opened; capability detection only runs from then on. */
  visited: boolean
  cache: GemmaCacheState
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  stats?: GenStats
  stopped?: boolean
}

const MAX_TOKEN_OPTIONS = [256, 512, 1024, 2048]
const DEFAULT_SETTINGS: GenSettings = { temperature: 0, topP: 0.95, maxNewTokens: 512, thinking: false }

let nextMessageId = 1
const newId = () => `m${nextMessageId++}`

export function ChatTab({ active, visited, cache }: Props) {
  const capability = useGemmaCapability(visited, cache.bytes)
  const state = useGemma()
  const device = capability?.device
  const dtype = capability?.dtype
  const load = useCallback(() => {
    if (device && dtype) gemma.load(device, dtype).catch(() => {})
  }, [device, dtype])

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string | null>(null)
  const [lastTrimmed, setLastTrimmed] = useState(0)

  const ready = state.status === 'ready'
  const busy = !!state.stream
  const canSend = ready && !busy && !!input.trim()

  async function send() {
    if (!canSend) return
    const history: ChatMessage[] = [...messages, { id: newId(), role: 'user', text: input.trim() }]
    setMessages(history)
    setInput('')
    setError(null)
    try {
      const done = await gemma.generate(
        history.map((m) => ({ role: m.role, text: m.text })),
        settings,
      )
      setLastTrimmed(done.stats.trimmedTurns)
      setMessages((h) => [...h, { id: newId(), role: 'assistant', text: done.answer, thinking: done.thinking || undefined, stats: done.stats, stopped: done.stopped }])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function newChat() {
    setMessages([])
    setError(null)
    setLastTrimmed(0)
  }

  const stream = state.stream

  return (
    <>
      <ModelGate source={gemmaSource(capability, state, load)} active={active} />

      <div className="space-y-3">
        <Transcript messages={messages} stream={stream} ready={ready} />
        <ErrorNote>{error}</ErrorNote>

        <label htmlFor="gemma-input" className="sr-only">
          Message
        </label>
        <Textarea
          id="gemma-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={ready ? 'Ask Gemma anything…' : 'Load Gemma above to start chatting.'}
          disabled={!ready}
          className="h-24 resize-none"
        />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Temperature</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })}
              className="w-28 accent-primary"
              aria-valuetext={settings.temperature === 0 ? '0, deterministic' : String(settings.temperature)}
            />
            <span className="w-24 text-xs tabular-nums text-muted-foreground">{settings.temperature === 0 ? '0 · deterministic' : settings.temperature.toFixed(1)}</span>
          </label>
          <div className="flex items-center gap-3 text-sm">
            <label htmlFor="gemma-max-tokens" className="mr-1 font-medium">
              Max reply
            </label>
            <Select id="gemma-max-tokens" value={settings.maxNewTokens} onChange={(e) => setSettings({ ...settings, maxNewTokens: Number(e.target.value) })}>
              {MAX_TOKEN_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} tokens
                </option>
              ))}
            </Select>
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.thinking} onChange={(e) => setSettings({ ...settings, thinking: e.target.checked })} className="size-4 accent-primary" />
            Thinking
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={newChat} disabled={busy || !messages.length} className="h-9 gap-2">
              <MessageSquarePlus className="size-4" /> New chat
            </Button>
            {busy ? (
              <Button variant="destructive" onClick={() => gemma.stop()} className="h-9 gap-2">
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={!canSend} className="h-9 gap-2">
                <Send className="size-4" /> Send
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <p>
            Enter to send · Shift+Enter for a new line.
            {lastTrimmed > 0 && ` Older messages (${lastTrimmed}) weren't sent to the model to fit its context.`}
          </p>
          {capability && <DeviceSummary capability={capability} />}
        </div>
      </div>
    </>
  )
}

function Transcript({ messages, stream, ready }: { messages: ChatMessage[]; stream: GemmaState['stream']; ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Follow new text only while the user is already at the bottom, so scrolling up to read isn't interrupted.
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, stream])

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      role="log"
      aria-label="Conversation"
      className="h-[28rem] space-y-4 overflow-y-auto rounded-xl border p-4"
    >
      {!messages.length && !stream ? (
        <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
          {ready ? 'Ask anything — Gemma runs entirely on this device.' : 'Your conversation appears here.'}
        </div>
      ) : (
        <>
          {messages.map((m) => (m.role === 'user' ? <UserBubble key={m.id} text={m.text} /> : <AssistantBubble key={m.id} message={m} />))}
          {stream && <AssistantBubble message={{ id: 'stream', role: 'assistant', text: stream.answer, thinking: stream.thinking }} streaming />}
        </>
      )}
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
      {text}
    </div>
  )
}

function AssistantBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const { text, thinking, stats, stopped } = message
  const thinkingOnly = streaming && !!thinking && !text
  return (
    <div className="mr-auto max-w-[85%] space-y-2">
      {thinking && (
        <details open={thinkingOnly} className="rounded-lg border bg-muted/30 text-xs">
          <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground select-none">
            {thinkingOnly ? 'Thinking…' : 'Reasoning'}
          </summary>
          <p className="border-t px-3 py-2 whitespace-pre-wrap text-muted-foreground">{thinking}</p>
        </details>
      )}
      {(text || !thinkingOnly) && (
        <div className={cn('rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap', streaming && !text && 'text-muted-foreground')}>
          {text || (streaming ? <Loader2 className="size-4 animate-spin" aria-label="Generating" /> : <em>No reply.</em>)}
          {streaming && text && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
        </div>
      )}
      {!streaming && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {stopped && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">Stopped</span>}
          {stats && (
            <span className="tabular-nums">
              {stats.newTokens} tokens · {stats.tokensPerSec.toFixed(1)} tok/s · first token {(stats.firstTokenMs / 1000).toFixed(1)} s
            </span>
          )}
          {text && <CopyButton text={text} className="h-6 px-2 text-xs" />}
        </div>
      )}
    </div>
  )
}

function gemmaSource(capability: Capability | null, state: GemmaState, load: () => void): ModelSource {
  const dtype = capability?.dtype ?? 'q4f16'
  const total = capability?.totalBytes || gemmaTotalBytes(dtype)
  const base: ModelSource = {
    name: 'Gemma 4 E2B',
    blurb: 'Chat with a 2B-parameter multimodal model. Runs on your GPU via WebGPU.',
    href: `https://huggingface.co/${GEMMA_MODEL_ID}`,
    sizeBytes: total,
    status: 'checking',
    cached: false,
    downloadBytes: capability?.downloadBytes ?? total,
    origin: 'huggingface.co',
  }
  if (!capability) return base
  if (capability.unsupported) return { ...base, status: 'unsupported', unsupported: capability.unsupported }
  const cached = capability.downloadBytes === 0
  const source: ModelSource = { ...base, status: 'idle', cached, blocked: capability.blocked, load }
  if (state.status === 'ready') return { ...source, status: 'ready' }
  if (state.status === 'error') return { ...source, status: 'error', error: state.error }
  if (state.status === 'loading') {
    // Progress events cover model files only (the runtime wasm is fetched separately), and their total grows as
    // files start; use the known size as a floor so the bar doesn't jump backwards.
    const expected = total - ORT_RUNTIME_BYTES
    const p = state.progress
    return {
      ...source,
      status: 'loading',
      progress: p ? { loaded: p.loaded, total: Math.max(p.total, expected), fromCache: cached } : undefined,
    }
  }
  return source
}

function DeviceSummary({ capability: c }: { capability: Capability }) {
  const items = [
    c.webgpu ? 'WebGPU' : 'No WebGPU',
    c.dtype,
    c.storage && `${formatBytes(Math.max(0, c.storage.quota - c.storage.usage))} storage free`,
  ].filter(Boolean) as string[]
  return (
    <p className="inline-flex items-center gap-1.5">
      <Cpu className="size-3.5" />
      {items.join(' · ')}
    </p>
  )
}
