export const MAX_BINARY_BYTES = 64 * 1024 * 1024
export const MAX_ENCODED_BYTES = 96 * 1024 * 1024
export const MAX_PASTED_CHARS = 4 * 1024 * 1024
export const INLINE_CHARS = 64 * 1024
export const COPY_BYTES = 4 * 1024 * 1024
const CHUNK_BYTES = 3 * 16 * 1024
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const WHITESPACE = /[\t\n\v\f\r ]/g

export function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export class Base64Decoder {
  private prefix = ''
  private started = false
  private bomChecked = false
  private tail = ''
  private standard = false
  private urlSafe = false

  push(text: string, final = false): Uint8Array<ArrayBuffer> {
    if (!this.bomChecked && text.length) {
      text = text.replace(/^\uFEFF/, '')
      this.bomChecked = true
    }
    if (!this.started) {
      this.prefix = (this.prefix + text).replace(/^[\t\n\v\f\r ]+/, '')
      if (!final && this.prefix.length < 5 && 'data:'.startsWith(this.prefix.toLowerCase())) return new Uint8Array()
      if (/^data:/i.test(this.prefix)) {
        const comma = this.prefix.indexOf(',')
        if (comma < 0 && this.prefix.length <= 4096 && !final) return new Uint8Array()
        if (comma < 0 || comma > 4096 || !/;base64$/i.test(this.prefix.slice(0, comma))) {
          throw new Error('Expected a data URL with a base64 payload and a header under 4 KiB.')
        }
        text = this.prefix.slice(comma + 1)
      } else {
        text = this.prefix
      }
      this.prefix = ''
      this.started = true
    }
    text = text.replace(WHITESPACE, '')
    this.standard ||= /[+/]/.test(text)
    this.urlSafe ||= /[-_]/.test(text)
    if (this.standard && this.urlSafe) throw new Error('Do not mix standard Base64 and Base64URL alphabets.')
    if (/[^A-Za-z0-9+/_=-]/.test(text)) throw new Error('Invalid Base64 character. Only Base64, Base64URL, and ASCII whitespace are accepted.')
    const combined = this.tail + text.replace(/-/g, '+').replace(/_/g, '/')
    const length = Math.max(0, Math.floor((combined.length - 1) / 4) * 4)
    const complete = combined.slice(0, length)
    if (complete.includes('=')) throw new Error('Base64 padding is only allowed at the end.')
    this.tail = combined.slice(length)
    return decodeBytes(complete)
  }

  finish(): Uint8Array<ArrayBuffer> {
    const prefixBytes = this.push('', true)
    const tail = this.tail
    if (!/^(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|[A-Za-z0-9+/]{4})?$/.test(tail)) {
      throw new Error('Invalid Base64 length or padding.')
    }
    const unpadded = tail.replace(/=+$/, '')
    if ((unpadded.length === 2 && (ALPHABET.indexOf(unpadded[1]) & 15))
      || (unpadded.length === 3 && (ALPHABET.indexOf(unpadded[2]) & 3))) {
      throw new Error('Invalid Base64 trailing bits.')
    }
    const last = decodeBytes(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '='))
    const bytes = new Uint8Array(prefixBytes.length + last.length)
    bytes.set(prefixBytes)
    bytes.set(last, prefixBytes.length)
    this.tail = ''
    return bytes
  }
}

export async function encodeBlob(source: Blob, progress: (percent: number) => void = () => {}): Promise<Blob> {
  if (source.size > MAX_BINARY_BYTES) throw new Error('Encoding is limited to 64 MiB per file.')
  const parts: Blob[] = []
  for (let offset = 0; offset < source.size; offset += CHUNK_BYTES) {
    const bytes = new Uint8Array(await source.slice(offset, offset + CHUNK_BYTES).arrayBuffer())
    parts.push(new Blob([encodeBytes(bytes)]))
    progress(Math.min(100, Math.round((offset + bytes.length) / source.size * 100)))
  }
  return new Blob(parts, { type: 'text/plain;charset=utf-8' })
}

export async function decodeBlob(source: Blob, progress: (percent: number) => void = () => {}): Promise<Blob> {
  if (source.size > MAX_ENCODED_BYTES) throw new Error('Base64 text files are limited to 96 MiB.')
  const decoder = new Base64Decoder()
  const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  function append(bytes: Uint8Array<ArrayBuffer>) {
    size += bytes.length
    if (size > MAX_BINARY_BYTES) throw new Error('The decoded file exceeds the 64 MiB limit.')
    if (bytes.length) parts.push(bytes)
  }
  for (let offset = 0; offset < source.size; offset += CHUNK_BYTES) {
    const bytes = await source.slice(offset, offset + CHUNK_BYTES).arrayBuffer()
    append(decoder.push(textDecoder.decode(bytes, { stream: true })))
    progress(Math.min(100, Math.round((offset + bytes.byteLength) / source.size * 100)))
  }
  append(decoder.push(textDecoder.decode()))
  append(decoder.finish())
  return new Blob(parts, { type: 'application/octet-stream' })
}
