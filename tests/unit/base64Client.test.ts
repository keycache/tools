import { afterEach, describe, expect, it, vi } from 'vitest'
import { Base64Client } from '@/lib/base64/client'
import type { Base64Request, Base64Response } from '@/lib/base64/protocol'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: { data: Base64Response }) => void) | null = null
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null
  requests: Base64Request[] = []
  terminated = false
  constructor() { MockWorker.instances.push(this) }
  postMessage(request: Base64Request) { this.requests.push(request) }
  terminate() { this.terminated = true }
  reply(data: Base64Response) { this.onmessage?.({ data }) }
}
afterEach(() => { MockWorker.instances = []; vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Base64 worker lifecycle', () => {
  it('cancels work, ignores replies from the old worker, and supports a fresh request', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const client = new Base64Client()
    expect(MockWorker.instances).toHaveLength(0)
    const first = client.run({ type: 'encode', source: new Blob() })
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const old = MockWorker.instances[0]
    client.cancel()
    await rejected
    expect(old.terminated).toBe(true)
    const next = client.run({ type: 'decode', source: new Blob() })
    old.reply({ id: 1, type: 'error', message: 'Stale failure' })
    const fresh = MockWorker.instances[1]
    fresh.reply({ id: 2, type: 'result', result: { kind: 'decoded', blob: new Blob() } })
    await expect(next).resolves.toMatchObject({ kind: 'decoded' })
    client.cancel()
  })

  it('terminates timed-out work and surfaces native worker crashes', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', MockWorker)
    const client = new Base64Client()
    const slow = client.run({ type: 'detect', source: new Blob() })
    const rejected = expect(slow).rejects.toThrow('30 seconds')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(MockWorker.instances[0].terminated).toBe(true)
    const crashed = client.run({ type: 'encode', source: new Blob() })
    const failure = expect(crashed).rejects.toThrow('crashed')
    MockWorker.instances[1].onerror?.({ message: '', preventDefault() {} })
    await failure
  })
})
