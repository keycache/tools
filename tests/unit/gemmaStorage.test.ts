import { Blob as NodeBlob } from 'node:buffer'
import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatStore, getLastOpen, setLastOpen, titleFrom, type StoredConversation, type StoredMessage } from '@/lib/gemma/storage'
import { encodeWav } from '@/lib/cactus/media'

const settings = { temperature: 0, topP: 0.95, maxNewTokens: 512, thinking: false }

function conv(id: string, updatedAt: number, title = id): StoredConversation {
  return { id, title, titleEdited: false, createdAt: updatedAt, updatedAt, settings }
}

function msg(conversationId: string, index: number, extra: Partial<StoredMessage> = {}): StoredMessage {
  return { id: `${conversationId}-${index}`, conversationId, index, role: index % 2 ? 'assistant' : 'user', text: `t${index}`, createdAt: index, ...extra }
}

let store: ChatStore
beforeEach(() => {
  const factory = new IDBFactory()
  store = new ChatStore(() => factory)
})

describe('ChatStore', () => {
  it('lists conversations newest first and returns messages in order', async () => {
    await store.save(conv('a', 1), [msg('a', 1), msg('a', 0)])
    await store.save(conv('b', 5), [msg('b', 0)])
    expect((await store.listConversations()).map((c) => c.id)).toEqual(['b', 'a'])
    expect((await store.getMessages('a')).map((m) => m.text)).toEqual(['t0', 't1'])
    expect(await store.getMessages('zzz')).toEqual([])
  })

  it('round-trips image blobs and audio PCM', async () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1])
    // jsdom's Blob can't be structured-cloned by Node (fake-indexeddb); browsers store Blobs natively.
    const blob = new NodeBlob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }) as unknown as Blob
    await store.save(conv('a', 1), [msg('a', 0, { images: [{ blob, name: 'x.png' }], audio: { pcm, name: 'c.wav', seconds: 0.1, trimmed: false } })])
    const [m] = await store.getMessages('a')
    expect(Object.prototype.toString.call(m.audio?.pcm)).toBe('[object Float32Array]')
    expect([...m.audio!.pcm]).toEqual([...pcm])
    expect(m.images?.[0].name).toBe('x.png')
    expect(m.images?.[0].blob.size).toBe(5)
    expect(m.images?.[0].blob.type).toBe('image/png')
  })

  it('appends messages with later saves and updates the conversation', async () => {
    await store.save(conv('a', 1), [msg('a', 0)])
    await store.save(conv('a', 9), [msg('a', 1)])
    expect((await store.getMessages('a')).length).toBe(2)
    expect((await store.listConversations())[0].updatedAt).toBe(9)
  })

  it('renames (marking the title as edited) and ignores blank names', async () => {
    await store.save(conv('a', 1, 'Old'))
    expect((await store.rename('a', '  New title '))?.title).toBe('New title')
    expect((await store.rename('a', '   '))?.title).toBe('New title')
    expect((await store.getConversation('a'))?.titleEdited).toBe(true)
    expect(await store.rename('missing', 'x')).toBeUndefined()
  })

  it('deletes a conversation with its messages only', async () => {
    await store.save(conv('a', 1), [msg('a', 0), msg('a', 1)])
    await store.save(conv('b', 2), [msg('b', 0)])
    await store.remove('a')
    expect((await store.listConversations()).map((c) => c.id)).toEqual(['b'])
    expect(await store.getMessages('a')).toEqual([])
    expect((await store.getMessages('b')).length).toBe(1)
  })

  it('reports usage and clears everything', async () => {
    expect(await store.usage()).toEqual({ conversations: 0, bytes: 0 })
    await store.save(conv('a', 1), [msg('a', 0, { audio: { pcm: new Float32Array(16000), name: 'c', seconds: 1, trimmed: false } })])
    const u = await store.usage()
    expect(u.conversations).toBe(1)
    expect(u.bytes).toBeGreaterThan(64000)
    await store.clear()
    expect(await store.listConversations()).toEqual([])
    expect(await store.usage()).toEqual({ conversations: 0, bytes: 0 })
  })
})

describe('titleFrom', () => {
  it('uses the first 40 chars of the prompt on one line', () => {
    expect(titleFrom('  Hello\n  world ')).toBe('Hello world')
    const t = titleFrom('a'.repeat(60))
    expect(t.length).toBe(40)
    expect(t.endsWith('…')).toBe(true)
  })
  it('falls back to a media label', () => {
    expect(titleFrom('', 1)).toBe('Image')
    expect(titleFrom('', 3)).toBe('3 images')
    expect(titleFrom('', 0, true)).toBe('Audio clip')
    expect(titleFrom('', 2, true)).toBe('Image + audio')
    expect(titleFrom('')).toBe('New chat')
  })
})

describe('last-open conversation', () => {
  it('stores and clears the id', () => {
    setLastOpen('abc')
    expect(getLastOpen()).toBe('abc')
    setLastOpen(null)
    expect(getLastOpen()).toBeNull()
  })
})

describe('encodeWav', () => {
  it('writes a 16-bit mono WAV header and clamps samples', async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    expect(wav.type).toBe('audio/wav')
    expect(wav.size).toBe(44 + 8)
    const v = new DataView(await wav.arrayBuffer())
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
    expect(v.getInt16(50, true)).toBe(32767)
  })
})
