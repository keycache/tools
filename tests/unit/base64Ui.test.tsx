import { Blob as NodeBlob } from 'node:buffer'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Base64Tool } from '@/components/Base64Tool'
import Base64Preview from '@/components/base64/Base64Preview'
import { MAX_BINARY_BYTES, MAX_ENCODED_BYTES, MAX_PASTED_CHARS } from '@/lib/base64/codec'
import type { Base64Request, Base64Response } from '@/lib/base64/protocol'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: { data: Base64Response }) => void) | null = null
  requests: Base64Request[] = []
  constructor() { MockWorker.instances.push(this) }
  postMessage(request: Base64Request) { this.requests.push(request) }
  terminate() {}
  reply(data: Base64Response) { this.onmessage?.({ data }) }
}
let host: HTMLDivElement
let root: Root
let urlBlobs: Blob[]
beforeEach(() => {
  urlBlobs = []
  MockWorker.instances = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Worker', MockWorker)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { urlBlobs.push(blob); return 'blob:base64-output' }
    static revokeObjectURL() {}
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
function button(name: string) {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)
  if (!found) throw new Error(`Missing button: ${name}`)
  return found
}

async function enterText(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('#base64-input')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!input || !setter) throw new Error('Missing text input')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function paste(files: File[], target: EventTarget = document, text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => text } })
  await act(async () => { target.dispatchEvent(event) })
  return event
}

describe('Base64 workflows and isolated previews', () => {
  it('encodes entered Unicode text as UTF-8 while preserving whitespace', async () => {
    await act(async () => root.render(<Base64Tool />))
    expect(button('Encode to Base64').disabled).toBe(true)
    const text = '  caf\u00e9 \ud83c\udf0d\nsecond line\t '
    await enterText(text)
    expect(button('Encode to Base64').disabled).toBe(false)
    await act(async () => button('Encode to Base64').click())
    const worker = MockWorker.instances[0]
    const command = worker.requests[0].command
    expect(command.type).toBe('encode')
    expect([...new Uint8Array(await command.source.arrayBuffer())]).toEqual([...new TextEncoder().encode(text)])
    await act(async () => worker.reply({ id: 1, type: 'result', result: { kind: 'encoded', blob: new Blob(['encoded']) } }))
    expect(host.querySelector('a[download]')?.getAttribute('download')).toBe('text.base64.txt')
    await enterText('replacement')
    expect(host.querySelector('a[download]')).toBeNull()
    expect(host.textContent).not.toContain('Encoding succeeded')
  })

  it.each(['encode', 'decode'] as const)('pastes and replaces files in %s, ignores busy/unmounted pastes, and preserves ordinary text pasting', async (mode) => {
    await act(async () => root.render(<Base64Tool />))
    if (mode === 'decode') await act(async () => button('Decode').click())
    await enterText('YWJj')
    const input = host.querySelector<HTMLTextAreaElement>('#base64-input')!
    expect((await paste([], input, 'ordinary text')).defaultPrevented).toBe(false)
    const first = new File(['YWJj'], 'extensionless')
    const replacement = new File(['ZGVm'], 'replacement')
    expect((await paste([first, replacement], input, 'clipboard text')).defaultPrevented).toBe(true)
    expect(input.value).toBe('')
    expect(input.disabled).toBe(true)
    expect(MockWorker.instances).toHaveLength(0)
    const action = mode === 'encode' ? 'Encode to Base64' : 'Decode Base64'
    await act(async () => button(action).click())
    const worker = MockWorker.instances[0]
    expect(worker.requests[0].command).toEqual({ type: mode, source: first })
    expect((await paste([replacement])).defaultPrevented).toBe(false)
    expect(host.textContent).toContain('extensionless')
    await act(async () => worker.reply({ id: 1, type: 'result', result: { kind: mode === 'encode' ? 'encoded' : 'decoded', blob: new Blob(['abc']) } }))
    if (mode === 'decode') await act(async () => worker.reply({ id: 2, type: 'result', result: { kind: 'detected', format: null } }))
    expect(host.querySelector('a[download]')).not.toBeNull()
    expect((await paste([replacement])).defaultPrevented).toBe(true)
    expect(host.querySelector('a[download]')).toBeNull()
    expect(host.textContent).not.toContain('succeeded')
    await act(async () => button(action).click())
    expect(worker.requests.at(-1)?.command).toEqual({ type: mode, source: replacement })
    await act(async () => root.render(<p>Other tool</p>))
    expect((await paste([first])).defaultPrevented).toBe(false)
  })

  it.each(['encode', 'decode'] as const)('validates pasted file/text limits in %s and switches back to text after clearing a file', async (mode) => {
    await act(async () => root.render(<Base64Tool />))
    if (mode === 'decode') await act(async () => button('Decode').click())
    const input = host.querySelector<HTMLTextAreaElement>('#base64-input')!
    const oversized = new File([], 'oversized')
    Object.defineProperty(oversized, 'size', { value: (mode === 'encode' ? MAX_BINARY_BYTES : MAX_ENCODED_BYTES) + 1 })
    expect((await paste([oversized])).defaultPrevented).toBe(true)
    expect(host.querySelector('[role=alert]')?.textContent).toContain(mode === 'encode' ? '64 MiB' : '96 MiB')
    expect(MockWorker.instances).toHaveLength(0)
    expect((await paste([], input, 'a'.repeat(MAX_PASTED_CHARS + 1))).defaultPrevented).toBe(true)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('4 MiB')
    // Files take precedence over accompanying clipboard text, including oversized text.
    await paste([new File(['YWJj'], 'valid')], input, 'a'.repeat(MAX_PASTED_CHARS + 1))
    expect(host.querySelector('[role=alert]')).toBeNull()
    await act(async () => button('Clear file').click())
    expect(input.disabled).toBe(false)
    await enterText('YWJj')
    await act(async () => button(mode === 'encode' ? 'Encode to Base64' : 'Decode Base64').click())
    expect(await MockWorker.instances[0].requests[0].command.source.text()).toBe('YWJj')
  })

  it('accepts an extensionless file with no MIME and only starts a worker on encode', async () => {
    await act(async () => root.render(<Base64Tool />))
    expect(MockWorker.instances).toHaveLength(0)
    const file = new File(['binary'], 'no-extension')
    const input = host.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => button('Encode to Base64').click())
    const worker = MockWorker.instances[0]
    expect(worker.requests[0].command).toEqual({ type: 'encode', source: file })
    await act(async () => worker.reply({ id: 1, type: 'result', result: { kind: 'encoded', blob: new Blob(['AP8=']) } }))
    expect(host.querySelector('a[download]')?.getAttribute('download')).toBe('no-extension.base64.txt')
    expect((host.querySelector('#base64-output') as HTMLTextAreaElement).value).toBe('AP8=')
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await act(async () => button('Copy complete Base64').click())
    expect(writeText).toHaveBeenCalledWith('AP8=')
    writeText.mockRejectedValueOnce(new Error('Permission denied'))
    await act(async () => button('Copied').click())
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Permission denied')
    expect(button('Copy complete Base64')).not.toBeNull()
  })

  it('keeps successfully decoded bytes downloadable when identification fails', async () => {
    await act(async () => root.render(<Base64Tool />))
    await act(async () => button('Decode').click())
    await act(async () => button('Decode Base64').click())
    const worker = MockWorker.instances[0]
    await act(async () => worker.reply({ id: 1, type: 'result', result: { kind: 'decoded', blob: new Blob([new Uint8Array([0, 255])]) } }))
    expect(worker.requests[1].command.type).toBe('detect')
    await act(async () => worker.reply({ id: 2, type: 'error', message: 'Malformed metadata' }))
    expect(host.textContent).toContain('Decoding succeeded')
    expect(host.querySelector('a[download]')?.getAttribute('download')).toBe('decoded.bin')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Format identification failed')
  })

  it('reports invalid Base64 without exposing a successful download', async () => {
    await act(async () => root.render(<Base64Tool />))
    await act(async () => button('Decode').click())
    await act(async () => button('Decode Base64').click())
    await act(async () => MockWorker.instances[0].reply({ id: 1, type: 'error', message: 'Invalid Base64 length or padding.' }))
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Invalid Base64')
    expect(host.querySelector('a[download]')).toBeNull()
  })

  it('downloads active HTML with an inert MIME without changing the reconstructed bytes', async () => {
    await act(async () => root.render(<Base64Tool />))
    await act(async () => button('Decode').click())
    await act(async () => button('Decode Base64').click())
    const worker = MockWorker.instances[0]
    const source = '<html><script>bad()</script></html>'
    await act(async () => worker.reply({ id: 1, type: 'result', result: { kind: 'decoded', blob: new Blob([source]) } }))
    await act(async () => worker.reply({ id: 2, type: 'result', result: { kind: 'detected', format: { ext: 'html', mime: 'text/html', method: 'text heuristic' } } }))
    expect(host.querySelector('a[download]')?.getAttribute('download')).toBe('decoded.html')
    expect(urlBlobs.at(-1)?.type).toBe('application/octet-stream')
    expect(await urlBlobs.at(-1)?.text()).toBe(source)
    expect(host.querySelector('script')).toBeNull()
  })

  it('does not render PDFs or execute markup from text previews', async () => {
    await act(async () => root.render(<Base64Preview blob={new Blob(['%PDF-1.7'])} format={{ ext: 'pdf', mime: 'application/pdf', method: 'signature' }} />))
    expect(host.textContent).toContain('PDF preview is intentionally excluded')
    expect(host.querySelector('iframe, object, embed')).toBeNull()
    await act(async () => root.render(<Base64Preview key="html" blob={new Blob(['<script>bad()</script><img src="https://example.com/image">'])} format={{ ext: 'html', mime: 'text/html', method: 'text heuristic' }} />))
    expect(host.querySelector('script, img, iframe')).toBeNull()
    expect(host.querySelector('pre')?.textContent).toContain('<script>bad()</script>')
    expect(MockWorker.instances).toHaveLength(0)
  })
})
