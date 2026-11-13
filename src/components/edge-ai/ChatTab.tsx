import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Cpu, Loader2, MessageSquarePlus, Mic, PanelLeft, Paperclip, Send, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConversationList } from '@/components/edge-ai/ConversationList'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { CopyButton, ErrorNote, Select } from '@/components/edge-ai/shared'
import { useAudioCapture, type CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import { AUDIO_ACCEPT, encodeWav, formatBytes, isAudioFile, prepareImage } from '@/lib/cactus/media'
import { AUDIO_SAMPLE_RATE, MAX_AUDIO_SECONDS } from '@/lib/gemma/conversation'
import type { Capability } from '@/lib/gemma/capability'
import { gemma, useGemma, type GemmaState } from '@/lib/gemma/client'
import { GEMMA_MODEL_ID, ORT_RUNTIME_BYTES, gemmaTotalBytes } from '@/lib/gemma/constants'
import { notifyChatsChanged, onChatsChanged, useGemmaCapability, type GemmaCacheState } from '@/lib/gemma/hooks'
import type { GenSettings, GenStats } from '@/lib/gemma/protocol'
import {
  chatStore,
  getLastOpen,
  isChatStorageSupported,
  newChatId,
  setLastOpen,
  titleFrom,
  type StoredConversation,
  type StoredMessage,
} from '@/lib/gemma/storage'
import { cn } from '@/lib/utils'

interface Props {
  /** Whether the Chat tab is visible (drives auto-load from cache). */
  active: boolean
  /** Becomes true the first time the tab is opened; capability detection only runs from then on. */
  visited: boolean
  cache: GemmaCacheState
}

interface Attachment {
  id: string
  blob: Blob
  /** Object URL for previews; revoked when the attachment or its message is discarded. */
  url: string
  name: string
}

interface AudioClip {
  pcm: Float32Array
  url: string
  name: string
  seconds: number
  /** Longer than the model's 30 s limit; only the start is kept. */
  trimmed: boolean
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: Attachment[]
  audio?: AudioClip
  thinking?: string
  stats?: GenStats
  stopped?: boolean
  createdAt: number
}

const MAX_TOKEN_OPTIONS = [256, 512, 1024, 2048]
/** Each image costs up to ~282 tokens and a vision-encoder pass on every turn it stays in the history. */
const MAX_IMAGES_PER_MESSAGE = 4
const MAX_AUDIO_SAMPLES = MAX_AUDIO_SECONDS * AUDIO_SAMPLE_RATE
const DEFAULT_SETTINGS: GenSettings = { temperature: 0, topP: 0.95, maxNewTokens: 512, thinking: false }

let nextMessageId = 1
const newId = () => `m${nextMessageId++}`

function toStored(m: ChatMessage, conversationId: string, index: number): StoredMessage {
  return {
    id: m.id,
    conversationId,
    index,
    role: m.role,
    text: m.text,
    thinking: m.thinking,
    images: m.images?.map((a) => ({ blob: a.blob, name: a.name })),
    audio: m.audio && { pcm: m.audio.pcm, name: m.audio.name, seconds: m.audio.seconds, trimmed: m.audio.trimmed },
    stats: m.stats,
    stopped: m.stopped,
    createdAt: m.createdAt,
  }
}

/** Rebuilds a transcript message; `track` registers each new object URL for later revocation. */
function fromStored(s: StoredMessage, track: (url: string) => string): ChatMessage {
  return {
    id: s.id,
    role: s.role,
    text: s.text,
    thinking: s.thinking,
    images: s.images?.map((img) => ({ id: newId(), blob: img.blob, name: img.name, url: track(URL.createObjectURL(img.blob)) })),
    // Only the PCM sent to the model is stored, so playback uses a WAV rebuilt from it.
    audio: s.audio && { ...s.audio, url: track(URL.createObjectURL(encodeWav(s.audio.pcm, AUDIO_SAMPLE_RATE))) },
    stats: s.stats,
    stopped: s.stopped,
    createdAt: s.createdAt,
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function ChatTab({ active, visited, cache }: Props) {
  const capability = useGemmaCapability(visited, cache.bytes)
  const state = useGemma()
  useEffect(() => {
    if (visited) void import('@/components/edge-ai/Markdown')
  }, [visited])
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
  const [lastDroppedAudio, setLastDroppedAudio] = useState(0)
  const [audioClip, setAudioClip] = useState<AudioClip | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preparing, setPreparing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Revoke every preview URL when the tab unmounts.
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const live = urls.current
    return () => live.forEach((u) => URL.revokeObjectURL(u))
  }, [])
  const release = useCallback((items: ({ url: string } | undefined)[] = []) => {
    items.forEach((a) => {
      if (!a) return
      URL.revokeObjectURL(a.url)
      urls.current.delete(a.url)
    })
  }, [])

  const ready = state.status === 'ready'
  const busy = !!state.stream

  // --- Saved conversations -------------------------------------------------------------------------------------
  const [conversations, setConversations] = useState<StoredConversation[]>([])
  const [activeConv, setActiveConv] = useState<StoredConversation | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const activeRef = useRef<StoredConversation | null>(null)
  /** How many of the current transcript's messages are already in IndexedDB (later saves append the rest). */
  const savedCount = useRef(0)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  /** Bumped whenever the transcript is replaced, so late replies / saves from the previous chat are ignored. */
  const session = useRef(0)
  const messagesRef = useRef(messages)
  const busyRef = useRef(busy)
  useEffect(() => {
    messagesRef.current = messages
    busyRef.current = busy
  })

  const setActive = useCallback((conv: StoredConversation | null) => {
    activeRef.current = conv
    setActiveConv(conv)
  }, [])

  const refreshList = useCallback(async (): Promise<StoredConversation[]> => {
    if (!isChatStorageSupported()) return []
    try {
      const list = await chatStore.listConversations()
      setConversations(list)
      return list
    } catch {
      return []
    }
  }, [])

  const replaceTranscript = useCallback(
    (next: ChatMessage[]) => {
      session.current++
      messagesRef.current.forEach((m) => release([...(m.images ?? []), m.audio]))
      messagesRef.current = next
      setMessages(next)
      setError(null)
      setLastTrimmed(0)
      setLastDroppedAudio(0)
    },
    [release],
  )

  const startNewChat = useCallback(() => {
    replaceTranscript([])
    setActive(null)
    savedCount.current = 0
    setLastOpen(null)
  }, [replaceTranscript, setActive])

  const openConversation = useCallback(
    async (id: string) => {
      const token = ++session.current
      try {
        const [conv, stored] = await Promise.all([chatStore.getConversation(id), chatStore.getMessages(id)])
        if (token !== session.current) return
        if (!conv) {
          setLastOpen(null)
          return
        }
        replaceTranscript(
          stored.map((s) =>
            fromStored(s, (url) => {
              urls.current.add(url)
              return url
            }),
          ),
        )
        setActive(conv)
        savedCount.current = stored.length
        setSettings(conv.settings)
        setLastOpen(id)
      } catch (err) {
        setError(`Couldn't open the chat: ${errorText(err)}`)
      }
    },
    [replaceTranscript, setActive],
  )

  // Restore the last-open chat the first time the tab is opened (works before the model is loaded).
  useEffect(() => {
    if (!visited || !isChatStorageSupported()) return
    let cancelled = false
    chatStore
      .listConversations()
      .then((list) => {
        if (cancelled) return
        setConversations(list)
        const last = getLastOpen()
        if (last && list.some((c) => c.id === last) && !activeRef.current && !messagesRef.current.length) void openConversation(last)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [visited, openConversation])

  // Saved chats changed (here or via "Clear" in the storage menu): refresh, and leave a chat that no longer exists.
  useEffect(
    () =>
      onChatsChanged(() => {
        void refreshList().then((list) => {
          const cur = activeRef.current
          if (!cur || list.some((c) => c.id === cur.id)) return
          if (busyRef.current) gemma.stop()
          startNewChat()
        })
      }),
    [refreshList, startNewChat],
  )

  /** Appends unsaved messages of `history` to the open conversation (creating it on the first message). */
  function persist(history: ChatMessage[], forSession: number, withSettings: GenSettings) {
    if (!isChatStorageSupported()) return
    saveQueue.current = saveQueue.current.then(async () => {
      if (forSession !== session.current) return
      try {
        const now = Date.now()
        let conv = activeRef.current
        if (conv) {
          // Re-read so a rename made meanwhile isn't overwritten.
          conv = { ...((await chatStore.getConversation(conv.id)) ?? conv), updatedAt: now, settings: withSettings }
        } else {
          const first = history.find((m) => m.role === 'user')
          conv = {
            id: newChatId(),
            title: titleFrom(first?.text ?? '', first?.images?.length ?? 0, !!first?.audio),
            titleEdited: false,
            createdAt: now,
            updatedAt: now,
            settings: withSettings,
          }
          savedCount.current = 0
        }
        const start = savedCount.current
        const id = conv.id
        await chatStore.save(conv, history.slice(start).map((m, i) => toStored(m, id, start + i)))
        if (forSession !== session.current) return
        savedCount.current = history.length
        setActive(conv)
        setLastOpen(conv.id)
        notifyChatsChanged()
      } catch (err) {
        setError(`Couldn't save this chat: ${errorText(err)}`)
      }
    })
  }

  async function renameConversation(id: string, title: string) {
    try {
      const next = await chatStore.rename(id, title)
      if (next && activeRef.current?.id === id) setActive(next)
      notifyChatsChanged()
    } catch (err) {
      setError(`Couldn't rename the chat: ${errorText(err)}`)
    }
  }

  async function deleteConversation(id: string) {
    try {
      await chatStore.remove(id)
      notifyChatsChanged()
    } catch (err) {
      setError(`Couldn't delete the chat: ${errorText(err)}`)
    }
  }

  // Recording / audio-file decoding (16 kHz mono PCM), shared with the Listen tab.
  const capture = useAudioCapture((clip: CapturedAudio) => {
    urls.current.add(clip.url)
    const trimmed = clip.pcm.length > MAX_AUDIO_SAMPLES
    setAudioClip((old) => {
      release([old ?? undefined])
      return {
        pcm: trimmed ? clip.pcm.slice(0, MAX_AUDIO_SAMPLES) : clip.pcm,
        url: clip.url,
        name: clip.name,
        seconds: Math.min(clip.seconds, MAX_AUDIO_SECONDS),
        trimmed,
      }
    })
  }, !ready || busy)

  const canSend = ready && !busy && !preparing && !capture.busy && !capture.recording && (!!input.trim() || attachments.length > 0 || !!audioClip)

  /** Routes dropped / pasted / picked files: images to the strip, the first audio file to the audio slot. */
  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const audio = files.filter((f) => !f.type.startsWith('image/') && isAudioFile(f))
    const room = MAX_IMAGES_PER_MESSAGE - attachments.length
    setError(
      images.length + audio.length < files.length
        ? 'Only images and audio can be attached.'
        : images.length > room
          ? `Up to ${MAX_IMAGES_PER_MESSAGE} images per message.`
          : audio.length > 1
            ? 'One audio clip per message — the first one was attached.'
            : null,
    )
    if (audio.length) capture.handleFiles([audio[0]])
    if (images.length && room > 0) void addImages(images.slice(0, room))
  }

  async function addImages(images: File[]) {
    setPreparing(true)
    try {
      const prepared = await Promise.all(
        images.map(async (file) => {
          const { blob } = await prepareImage(file)
          const url = URL.createObjectURL(blob)
          urls.current.add(url)
          return { id: newId(), blob, url, name: file.name || 'pasted image' }
        }),
      )
      setAttachments((a) => [...a, ...prepared])
    } catch (err) {
      setError(`Could not read image: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPreparing(false)
    }
  }

  function removeAttachment(id: string) {
    const gone = attachments.filter((a) => a.id === id)
    release(gone)
    setAttachments((a) => a.filter((x) => x.id !== id))
  }

  async function send() {
    if (!canSend) return
    const forSession = session.current
    const sentWith = settings
    const history: ChatMessage[] = [
      ...messages,
      {
        id: newChatId(),
        role: 'user',
        text: input.trim(),
        images: attachments.length ? attachments : undefined,
        audio: audioClip ?? undefined,
        createdAt: Date.now(),
      },
    ]
    messagesRef.current = history
    setMessages(history)
    setInput('')
    setAttachments([])
    setAudioClip(null)
    setError(null)
    persist(history, forSession, sentWith)
    try {
      const done = await gemma.generate(
        history.map((m) => ({ role: m.role, text: m.text, images: m.images?.map((i) => i.blob), audio: m.audio?.pcm })),
        sentWith,
      )
      // The user switched / started another chat meanwhile (only possible if its saved copy was removed).
      if (forSession !== session.current) return
      setLastTrimmed(done.stats.trimmedTurns)
      setLastDroppedAudio(done.stats.droppedAudio)
      const full: ChatMessage[] = [
        ...history,
        { id: newChatId(), role: 'assistant', text: done.answer, thinking: done.thinking || undefined, stats: done.stats, stopped: done.stopped, createdAt: Date.now() },
      ]
      messagesRef.current = full
      setMessages(full)
      persist(full, forSession, sentWith)
    } catch (err) {
      if (forSession === session.current) setError(errorText(err))
    }
  }

  const stream = state.stream

  return (
    <>
      <ModelGate source={gemmaSource(capability, state, load)} active={active} />

      <div className="space-y-3">
        <div className="relative grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <Button variant="outline" size="sm" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} aria-controls="gemma-chat-list" className="gap-2">
              <PanelLeft className="size-4" /> Chats
            </Button>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{activeConv?.title ?? 'New chat'}</span>
          </div>
          <ConversationList
            conversations={conversations}
            activeId={activeConv?.id ?? null}
            disabled={busy}
            onSelect={(id) => {
              setListOpen(false)
              if (id !== activeRef.current?.id) void openConversation(id)
            }}
            onNew={() => {
              setListOpen(false)
              startNewChat()
            }}
            onRename={(id, title) => void renameConversation(id, title)}
            onDelete={(id) => void deleteConversation(id)}
            onClose={() => setListOpen(false)}
            className={cn('h-[28rem]', listOpen ? 'absolute top-10 left-0 z-20 w-72 shadow-lg' : 'hidden', 'lg:static lg:flex lg:w-auto lg:shadow-none')}
          />
          <Transcript messages={messages} stream={stream} ready={ready} />
        </div>
        <ErrorNote>{error ?? capture.error}</ErrorNote>

        {/* Fixed-height composer: the thumbnail strip takes space from the textarea, so nothing below moves. */}
        <div
          className={cn(
            'flex h-36 flex-col overflow-hidden rounded-lg border transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
            dragging && 'border-primary bg-muted',
            !ready && 'opacity-50',
          )}
          onDragOver={(e) => {
            if (!ready || busy) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (ready && !busy) addFiles([...e.dataTransfer.files])
          }}
        >
          {(attachments.length > 0 || preparing || !!audioClip || capture.busy) && (
            <ul className="flex h-16 shrink-0 items-center gap-2 overflow-x-auto px-2 pt-2" aria-label="Attachments">
              {audioClip && (
                <li className="flex h-14 shrink-0 items-center gap-2 rounded-md border bg-muted/40 pr-1 pl-3 text-xs">
                  <Mic className="size-4 text-muted-foreground" />
                  <span className="max-w-40 truncate" title={audioClip.name}>
                    {audioClip.name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {audioClip.seconds.toFixed(1)}s{audioClip.trimmed && ' (first 30 s)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      release([audioClip])
                      setAudioClip(null)
                    }}
                    aria-label={`Remove ${audioClip.name}`}
                    className="rounded-full p-0.5 hover:bg-muted"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              )}
              {attachments.map((a) => (
                <li key={a.id} className="relative shrink-0">
                  <img src={a.url} alt={a.name} className="size-14 rounded-md border object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 shadow-sm hover:bg-muted"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
              {(preparing || capture.busy) && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Preparing attachment" />}
            </ul>
          )}
          <label htmlFor="gemma-input" className="sr-only">
            Message
          </label>
          <textarea
            id="gemma-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files]
              if (files.length) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            placeholder={ready ? 'Ask Gemma anything… (drop or paste images or audio to ask about them)' : 'Load Gemma above to start chatting.'}
            disabled={!ready}
            className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!ready || busy || preparing || capture.recording} className="h-9 gap-2">
              <Paperclip className="size-4" /> Attach
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={`image/*,${AUDIO_ACCEPT}`}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                addFiles(files)
              }}
            />
            <Button
              variant={capture.recording ? 'destructive' : 'outline'}
              onClick={() => void capture.toggleRecording()}
              disabled={!ready || busy || capture.busy}
              aria-pressed={capture.recording}
              className="h-9 gap-2"
            >
              {capture.recording ? <Square className="size-4" /> : <Mic className="size-4" />}
              {capture.recording ? `Stop · ${capture.elapsed.toFixed(1)}s` : 'Record'}
            </Button>
          </div>
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
            <Button variant="outline" onClick={startNewChat} disabled={busy || (!messages.length && !activeConv)} className="h-9 gap-2">
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
            Enter to send · Shift+Enter for a new line · up to {MAX_IMAGES_PER_MESSAGE} images and one audio clip (≤ {MAX_AUDIO_SECONDS} s) per message.
            {lastTrimmed > 0 && ` Older messages (${lastTrimmed}) weren't sent to the model to fit its context.`}
            {lastDroppedAudio > 0 && ' Only the newest audio clip is sent to the model.'}
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
          {messages.map((m) => (m.role === 'user' ? <UserBubble key={m.id} text={m.text} images={m.images} audio={m.audio} /> : <AssistantBubble key={m.id} message={m} />))}
          {stream && <AssistantBubble message={{ id: 'stream', role: 'assistant', text: stream.answer, thinking: stream.thinking, createdAt: 0 }} streaming />}
        </>
      )}
    </div>
  )
}

function UserBubble({ text, images, audio }: { text: string; images?: Attachment[]; audio?: AudioClip }) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
      {audio && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mic className="size-3.5" />
          <span className="max-w-40 truncate">{audio.name}</span>
          <audio src={audio.url} controls preload="metadata" className="h-8 w-60" aria-label={`Audio: ${audio.name}`} />
        </div>
      )}
      {images && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((img) => (
            <a key={img.id} href={img.url} target="_blank" rel="noreferrer" title={img.name}>
              <img src={img.url} alt={img.name} className="max-h-40 max-w-56 rounded-xl border object-cover" />
            </a>
          ))}
        </div>
      )}
      {text && <div className="w-fit rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">{text}</div>}
    </div>
  )
}

const Markdown = lazy(() => import('@/components/edge-ai/Markdown'))

function AssistantText({ text }: { text: string }) {
  // Streaming deltas arrive up to 20×/s; a deferred value keeps re-parsing interruptible so typing stays smooth.
  const deferred = useDeferredValue(text)
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
      <Markdown text={deferred} />
    </Suspense>
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
        <div className={cn('rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm', streaming && !text && 'text-muted-foreground')}>
          {text ? <AssistantText text={text} /> : streaming ? <Loader2 className="size-4 animate-spin" aria-label="Generating" /> : <em>No reply.</em>}
          {streaming && text && <span className="inline-block animate-pulse">▍</span>}
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
