/**
 * Saved Gemma conversations in IndexedDB (`edge-ai-chat`). Images are stored as Blobs and audio as the 16 kHz
 * Float32Array actually sent to the model (≤ 30 s), so restored chats can be continued with the same context.
 */
import type { GenSettings, GenStats } from './protocol'

export const CHAT_DB = 'edge-ai-chat'
const DB_VERSION = 1
const CONVERSATIONS = 'conversations'
const MESSAGES = 'messages'
const BY_CONVERSATION = 'conversationId'
const LAST_OPEN_KEY = 'edge-ai-chat:last-open'
const TITLE_LENGTH = 40

export interface StoredConversation {
  id: string
  title: string
  /** True once the user renamed it; auto-titles never overwrite a manual title. */
  titleEdited: boolean
  createdAt: number
  updatedAt: number
  settings: GenSettings
}

export interface StoredImage {
  blob: Blob
  name: string
}

export interface StoredAudio {
  pcm: Float32Array
  name: string
  seconds: number
  trimmed: boolean
}

export interface StoredMessage {
  id: string
  conversationId: string
  /** Position in the conversation (messages are sorted by it). */
  index: number
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  images?: StoredImage[]
  audio?: StoredAudio
  stats?: GenStats
  stopped?: boolean
  backgrounded?: boolean
  createdAt: number
}

export interface ChatUsage {
  conversations: number
  bytes: number
}

export function newChatId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** First 40 characters of the first prompt (single line), or a media label when the prompt has no text. */
export function titleFrom(text: string, images = 0, audio = false): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line) return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line
  if (images && audio) return 'Image + audio'
  if (images) return images > 1 ? `${images} images` : 'Image'
  if (audio) return 'Audio clip'
  return 'New chat'
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

/** Rough on-disk size: text (UTF-16) + image bytes + PCM bytes + per-record overhead. */
function messageBytes(m: StoredMessage): number {
  let n = 200 + (m.text.length + (m.thinking?.length ?? 0)) * 2
  for (const img of m.images ?? []) n += img.blob.size
  if (m.audio) n += m.audio.pcm.byteLength
  return n
}

export class ChatStore {
  private db: Promise<IDBDatabase> | null = null
  private readonly factory: () => IDBFactory

  constructor(factory: () => IDBFactory = () => indexedDB) {
    this.factory = factory
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = this.factory().open(CHAT_DB, DB_VERSION)
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains(CONVERSATIONS)) db.createObjectStore(CONVERSATIONS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(MESSAGES)) {
          db.createObjectStore(MESSAGES, { keyPath: 'id' }).createIndex(BY_CONVERSATION, BY_CONVERSATION)
        }
      }
      r.onsuccess = () => {
        // Another tab upgrading the schema: close so it isn't blocked; the next call reopens.
        r.result.onversionchange = () => {
          r.result.close()
          this.db = null
        }
        resolve(r.result)
      }
      r.onerror = () => reject(r.error)
      r.onblocked = () => reject(new Error('Saved chats are locked by another tab.'))
    }).catch((err: unknown) => {
      this.db = null
      throw err
    })
    return this.db
  }

  /** Newest first. */
  async listConversations(): Promise<StoredConversation[]> {
    const db = await this.open()
    const all = await request(db.transaction(CONVERSATIONS).objectStore(CONVERSATIONS).getAll() as IDBRequest<StoredConversation[]>)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getConversation(id: string): Promise<StoredConversation | undefined> {
    const db = await this.open()
    return request(db.transaction(CONVERSATIONS).objectStore(CONVERSATIONS).get(id) as IDBRequest<StoredConversation | undefined>)
  }

  async getMessages(conversationId: string): Promise<StoredMessage[]> {
    const db = await this.open()
    const index = db.transaction(MESSAGES).objectStore(MESSAGES).index(BY_CONVERSATION)
    const all = await request(index.getAll(IDBKeyRange.only(conversationId)) as IDBRequest<StoredMessage[]>)
    return all.sort((a, b) => a.index - b.index)
  }

  /** Upserts the conversation and the given messages atomically. */
  async save(conversation: StoredConversation, messages: StoredMessage[] = []): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([CONVERSATIONS, MESSAGES], 'readwrite')
    tx.objectStore(CONVERSATIONS).put(conversation)
    const store = tx.objectStore(MESSAGES)
    for (const m of messages) store.put(m)
    await complete(tx)
  }

  async rename(id: string, title: string): Promise<StoredConversation | undefined> {
    const db = await this.open()
    const tx = db.transaction(CONVERSATIONS, 'readwrite')
    const store = tx.objectStore(CONVERSATIONS)
    const conv = (await request(store.get(id) as IDBRequest<StoredConversation | undefined>)) ?? undefined
    if (!conv) return undefined
    const next = { ...conv, title: title.trim() || conv.title, titleEdited: true }
    store.put(next)
    await complete(tx)
    return next
  }

  /** Deletes a conversation and all of its messages. */
  async remove(id: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([CONVERSATIONS, MESSAGES], 'readwrite')
    tx.objectStore(CONVERSATIONS).delete(id)
    const keys = await request(tx.objectStore(MESSAGES).index(BY_CONVERSATION).getAllKeys(IDBKeyRange.only(id)))
    const store = tx.objectStore(MESSAGES)
    for (const k of keys) store.delete(k)
    await complete(tx)
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([CONVERSATIONS, MESSAGES], 'readwrite')
    tx.objectStore(CONVERSATIONS).clear()
    tx.objectStore(MESSAGES).clear()
    await complete(tx)
  }

  async usage(): Promise<ChatUsage> {
    const db = await this.open()
    const tx = db.transaction([CONVERSATIONS, MESSAGES])
    const [conversations, messages] = await Promise.all([
      request(tx.objectStore(CONVERSATIONS).count()),
      request(tx.objectStore(MESSAGES).getAll() as IDBRequest<StoredMessage[]>),
    ])
    return { conversations, bytes: conversations ? messages.reduce((n, m) => n + messageBytes(m), 0) + conversations * 200 : 0 }
  }
}

export function isChatStorageSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

export const chatStore = new ChatStore()

export function getLastOpen(): string | null {
  try {
    return localStorage.getItem(LAST_OPEN_KEY)
  } catch {
    return null
  }
}

export function setLastOpen(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_OPEN_KEY, id)
    else localStorage.removeItem(LAST_OPEN_KEY)
  } catch {
    // Storage disabled (private mode etc.) — restoring the last chat is best-effort.
  }
}
