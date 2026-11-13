/**
 * Model-file cache for Transformers.js backed by the Origin Private File System (OPFS).
 *
 * Why not Cache Storage: Transformers.js reads each file fully into memory and then calls
 * `cache.put(key, new Response(buffer))`. Chromium rejects multi-GB entries ("Failed to execute 'put' on 'Cache':
 * Unexpected internal error") — verified for 1.5–1.6 GB Gemma files, even with a streamed body — so every page
 * load would re-download ~3 GB. OPFS writes straight to disk and handled the same files fine.
 *
 * Plugged in via `env.useCustomCache = true; env.customCache = new OpfsModelCache()` (needs only match/put).
 * Each entry is `<sha256(url)>.bin` plus `<sha256(url)>.meta.json`; the meta file is written last, so a partially
 * written file is never served.
 */

export const OPFS_DIR = 'gemma-models'

export interface EntryMeta {
  url: string
  size: number
  contentType: string | null
}

/** The subset of FileSystemDirectoryHandle we use (injectable for tests). */
export interface DirLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>
  removeEntry(name: string): Promise<void>
  values?(): AsyncIterable<{ kind: string; name: string }>
  entries?(): AsyncIterable<[string, { kind: string }]>
}

export interface FileLike {
  getFile(): Promise<File>
  createWritable?(): Promise<WritableStream<Uint8Array> & { write?: unknown }>
  createSyncAccessHandle?(): Promise<{ write(buf: Uint8Array, opts: { at: number }): number; flush(): void; close(): void; truncate(n: number): void }>
}

type DirProvider = () => Promise<DirLike>

const defaultDir: DirProvider = async () => {
  const root = await navigator.storage.getDirectory()
  return (await root.getDirectoryHandle(OPFS_DIR, { create: true })) as unknown as DirLike
}

export async function keyName(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toUrl(key: RequestInfo | URL): string {
  if (typeof key === 'string') return key
  if (key instanceof URL) return key.href
  return key.url
}

export class OpfsModelCache {
  private dir: Promise<DirLike> | null = null
  private readonly getDir: DirProvider
  private readonly normalize: (url: string) => string
  /**
   * Writes that failed (e.g. storage full). Transformers.js only logs a warning when `put` throws and still loads
   * the model, so the worker reads these after loading to tell the user the model wasn't saved.
   */
  readonly failures: { url: string; error: unknown }[] = []

  /**
   * @param normalize Maps a request URL to its storage key (e.g. pins `resolve/main/` to a fixed revision),
   *   applied to both `match` and `put`.
   */
  constructor(getDir: DirProvider = defaultDir, normalize: (url: string) => string = (u) => u) {
    this.getDir = getDir
    this.normalize = normalize
  }

  private directory(): Promise<DirLike> {
    this.dir ??= this.getDir()
    return this.dir
  }

  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    try {
      const dir = await this.directory()
      const name = await keyName(this.normalize(toUrl(key)))
      const meta = await readMeta(dir, name)
      if (!meta) return undefined
      const file = await (await dir.getFileHandle(`${name}.bin`)).getFile()
      if (file.size !== meta.size) return undefined
      const headers: Record<string, string> = { 'Content-Length': String(meta.size) }
      if (meta.contentType) headers['Content-Type'] = meta.contentType
      return new Response(file, { headers })
    } catch {
      return undefined
    }
  }

  async put(key: RequestInfo | URL, response: Response): Promise<void> {
    if (!response.body) return
    const url = this.normalize(toUrl(key))
    const dir = await this.directory()
    const name = await keyName(url)
    // Drop any previous meta first so an interrupted rewrite can't be matched against stale metadata.
    await dir.removeEntry(`${name}.meta.json`).catch(() => {})
    try {
      const handle = await dir.getFileHandle(`${name}.bin`, { create: true })
      const size = await writeStream(handle, response.body)
      const meta: EntryMeta = { url, size, contentType: response.headers.get('Content-Type') }
      await writeStream(await dir.getFileHandle(`${name}.meta.json`, { create: true }), new Response(JSON.stringify(meta)).body!)
    } catch (error) {
      // Don't leave a partial (possibly GB-sized) file behind, e.g. when storage ran out mid-write.
      await dir.removeEntry(`${name}.bin`).catch(() => {})
      await dir.removeEntry(`${name}.meta.json`).catch(() => {})
      this.failures.push({ url, error })
      throw error
    }
  }
}

async function readMeta(dir: DirLike, name: string): Promise<EntryMeta | null> {
  try {
    const file = await (await dir.getFileHandle(`${name}.meta.json`)).getFile()
    return JSON.parse(await file.text()) as EntryMeta
  } catch {
    return null
  }
}

/** Streams to disk; uses createWritable where available, else a sync access handle (Safari workers). */
async function writeStream(handle: FileLike, body: ReadableStream<Uint8Array>): Promise<number> {
  let size = 0
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        size += chunk.byteLength
        ctrl.enqueue(chunk)
      },
    }),
  )
  if (handle.createWritable) {
    await counted.pipeTo(await handle.createWritable())
    return size
  }
  if (handle.createSyncAccessHandle) {
    const access = await handle.createSyncAccessHandle()
    try {
      access.truncate(0)
      const reader = counted.getReader()
      let at = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        at += access.write(value, { at })
      }
      access.flush()
    } finally {
      access.close()
    }
    return size
  }
  throw new Error('This browser cannot write files to origin-private storage.')
}

/** Lists entries with their metadata (complete entries only). */
export async function listOpfsEntries(getDir: DirProvider = defaultDir): Promise<EntryMeta[]> {
  const dir = await getDir()
  const names: string[] = []
  if (dir.values) for await (const h of dir.values()) names.push(h.name)
  else if (dir.entries) for await (const [n] of dir.entries()) names.push(n)
  const metas = await Promise.all(names.filter((n) => n.endsWith('.meta.json')).map((n) => readMeta(dir, n.slice(0, -'.meta.json'.length))))
  return metas.filter((m): m is EntryMeta => !!m)
}

/** Removes the whole model directory. */
export async function clearOpfsEntries(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return
  const root = await navigator.storage.getDirectory()
  await (root as unknown as { removeEntry(n: string, o?: { recursive?: boolean }): Promise<void> }).removeEntry(OPFS_DIR, { recursive: true }).catch(() => {})
}

export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}
