// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OpfsModelCache, keyName, listOpfsEntries, type DirLike, type FileLike } from '@/lib/gemma/opfsCache'

/** In-memory OPFS directory. `failAfterBytes` simulates a write interrupted mid-file. */
function memoryDir({ syncOnly = false, failAfterBytes = Infinity } = {}) {
  const files = new Map<string, Uint8Array[]>()
  const handle = (name: string): FileLike => ({
    getFile: async () => {
      const chunks = files.get(name)
      if (!chunks) throw new DOMException('missing', 'NotFoundError')
      return new File(chunks as BlobPart[], name)
    },
    ...(syncOnly
      ? {
          createSyncAccessHandle: async () => {
            const parts: Uint8Array[] = []
            files.set(name, parts)
            return {
              write: (buf: Uint8Array) => (parts.push(buf.slice()), buf.byteLength),
              flush: () => {},
              close: () => {},
              truncate: () => void parts.splice(0),
            }
          },
        }
      : {
          createWritable: async () => {
            const parts: Uint8Array[] = []
            let written = 0
            return new WritableStream<Uint8Array>({
              write(chunk) {
                written += chunk.byteLength
                if (written > failAfterBytes) throw new Error('disk full')
                parts.push(chunk.slice())
              },
              close() {
                files.set(name, parts)
              },
            }) as never
          },
        }),
  })
  const dir: DirLike = {
    getFileHandle: async (name, opts) => {
      if (!files.has(name) && !opts?.create) throw new DOMException('missing', 'NotFoundError')
      return handle(name)
    },
    removeEntry: async (name) => {
      if (!files.delete(name)) throw new DOMException('missing', 'NotFoundError')
    },
    async *values() {
      for (const name of files.keys()) yield { kind: 'file', name }
    },
  }
  return { dir, files }
}

const URL_A = 'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/abc/onnx/decoder.onnx_data'

describe('OpfsModelCache', () => {
  it('round-trips a response with size and content type', async () => {
    const { dir } = memoryDir()
    const cache = new OpfsModelCache(async () => dir)
    const body = new Uint8Array(100_000).map((_, i) => i & 255)
    expect(await cache.match(URL_A)).toBeUndefined()
    await cache.put(URL_A, new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }))
    const hit = await cache.match(URL_A)
    expect(hit?.headers.get('Content-Length')).toBe('100000')
    expect(hit?.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(new Uint8Array(await hit!.arrayBuffer())).toEqual(body)
  })

  it('accepts Request and URL keys', async () => {
    const { dir } = memoryDir()
    const cache = new OpfsModelCache(async () => dir)
    await cache.put(new Request(URL_A), new Response('x'))
    expect(await cache.match(new URL(URL_A))).toBeDefined()
  })

  it('never serves a partially written file', async () => {
    const { dir } = memoryDir({ failAfterBytes: 10 })
    const cache = new OpfsModelCache(async () => dir)
    await expect(cache.put(URL_A, new Response(new Uint8Array(1000)))).rejects.toThrow()
    expect(await cache.match(URL_A)).toBeUndefined()
  })

  it('rejects an entry whose file size no longer matches its metadata', async () => {
    const { dir, files } = memoryDir()
    const cache = new OpfsModelCache(async () => dir)
    await cache.put(URL_A, new Response(new Uint8Array(50)))
    files.set(`${await keyName(URL_A)}.bin`, [new Uint8Array(10)])
    expect(await cache.match(URL_A)).toBeUndefined()
  })

  it('falls back to a sync access handle (Safari workers)', async () => {
    const { dir } = memoryDir({ syncOnly: true })
    const cache = new OpfsModelCache(async () => dir)
    await cache.put(URL_A, new Response(new Uint8Array(64).fill(7)))
    expect(new Uint8Array(await (await cache.match(URL_A))!.arrayBuffer())).toEqual(new Uint8Array(64).fill(7))
  })

  it('lists complete entries with their URLs and sizes', async () => {
    const { dir } = memoryDir()
    const cache = new OpfsModelCache(async () => dir)
    await cache.put(URL_A, new Response(new Uint8Array(30)))
    await cache.put('http://localhost/tools/assets/ort.wasm', new Response(new Uint8Array(20)))
    const entries = await listOpfsEntries(async () => dir)
    expect(entries.map((e) => [e.url, e.size]).sort()).toEqual([
      ['http://localhost/tools/assets/ort.wasm', 20],
      [URL_A, 30],
    ])
  })
})

describe('revision pinning', () => {
  it('serves resolve/main lookups from the pinned-revision entry', async () => {
    const { pinGemmaRevision } = await import('@/lib/gemma/constants')
    const { GEMMA_REVISION } = await import('@/lib/gemma/constants')
    const { dir } = memoryDir()
    const cache = new OpfsModelCache(async () => dir, pinGemmaRevision)
    const base = 'https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve'
    await cache.put(`${base}/${GEMMA_REVISION}/tokenizer_config.json`, new Response('{"a":1}'))
    expect(await (await cache.match(`${base}/main/tokenizer_config.json`))?.text()).toBe('{"a":1}')
    // Other repos are untouched.
    expect(pinGemmaRevision('https://huggingface.co/other/model/resolve/main/x.json')).toBe('https://huggingface.co/other/model/resolve/main/x.json')
  })
})
