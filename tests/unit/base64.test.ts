// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { Base64Decoder, decodeBlob, encodeBlob } from '@/lib/base64/codec'
import { detectFormat } from '@/lib/base64/detect'
import { extractZipEntry, listZip, readOfficeParts } from '@/lib/base64/archive'

describe('format-independent Base64 conversion', () => {
  it('round-trips every byte value, empty files, padding lengths, and chunk boundaries without using metadata', async () => {
    for (const length of [0, 1, 2, 3, 49151, 49152, 49153]) {
      const bytes = Uint8Array.from({ length }, (_, index) => index % 256)
      const encoded = await encodeBlob(new Blob([bytes], { type: 'application/x-false-type' }))
      expect(await encoded.text()).toBe(Buffer.from(bytes).toString('base64'))
      const decoded = await decodeBlob(encoded)
      expect(new Uint8Array(await decoded.arrayBuffer())).toEqual(bytes)
    }
  })

  it('handles data URL headers, whitespace and Base64URL across arbitrary chunk boundaries', () => {
    const bytes = Uint8Array.from([251, 255, 0, 128, 1])
    const source = `\uFEFF data:application/x-untrusted;base64,\r\n ${Buffer.from(bytes).toString('base64url')}\t`
    for (const length of [1, 2, 3, 4, 5, 7]) {
      const decoder = new Base64Decoder()
      const output: number[] = []
      for (let offset = 0; offset < source.length; offset += length) output.push(...decoder.push(source.slice(offset, offset + length)))
      output.push(...decoder.finish())
      expect(output).toEqual([...bytes])
    }
  })

  it.each(['A', '=', 'A===', 'AA=A', 'AA==A', 'AB==', 'AAB=', '$$', '--++', 'data:text/plain,QQ=='])('rejects malformed or noncanonical input: %s', async (value) => {
    await expect(decodeBlob(new Blob([value]))).rejects.toThrow()
  })

  it('accepts UTF-8 BOM text files but rejects non-UTF-8 binary input', async () => {
    expect(await (await decodeBlob(new Blob(['\uFEFF SGVsbG8=']))).text()).toBe('Hello')
    await expect(decodeBlob(new Blob([new Uint8Array([0xff, 0xff])]))).rejects.toThrow()
  })
})

describe('best-effort file identification', () => {
  it('identifies bytes rather than declared MIME, handles Unicode text, and leaves unknown data unknown', async () => {
    expect(await detectFormat(new Blob(['%PDF-1.7\n'], { type: 'image/png' }))).toMatchObject({ ext: 'pdf', mime: 'application/pdf', method: 'signature' })
    expect(await detectFormat(new Blob(['{"message":"こんにちは"}']))).toMatchObject({ ext: 'json', method: 'text heuristic' })
    expect(await detectFormat(new Blob(['hello']))).toMatchObject({ ext: 'txt' })
    expect(await detectFormat(new Blob([new Uint8Array([0xff, 0, 1, 128])]))).toBeNull()
    expect(await detectFormat(new Blob([]))).toBeNull()
  })

  it('recognizes delimited text heuristically and BOM-marked UTF-16 without relying on extensions', async () => {
    expect(await detectFormat(new Blob(['name,note\nAda,"Hello, world"\nLin,"He said ""Hi"""']))).toMatchObject({ ext: 'csv', method: 'text heuristic' })
    expect(await detectFormat(new Blob(['name\tage\nAda\t30']))).toMatchObject({ ext: 'tsv' })
    expect(await detectFormat(new Blob([new Uint8Array([0xff, 0xfe]), Buffer.from('Hello', 'utf16le')]))).toMatchObject({ ext: 'txt', encoding: 'utf-16le' })
  })
})

describe('bounded ZIP and Office content extraction', () => {
  const content = new TextEncoder().encode('Original file content')

  it('lists files without inflating them, extracts the requested file, and rejects oversized expansion', () => {
    const data = zipSync({ 'folder/test.txt': content, 'other.bin': new Uint8Array([1, 2]) })
    const entries = listZip(data)
    expect(entries.map((entry) => entry.name)).toEqual(['folder/test.txt', 'other.bin'])
    expect(extractZipEntry(data, entries, 0)).toEqual(content)
    const forged = entries.map((entry) => ({ ...entry, size: 1 }))
    expect(() => extractZipEntry(data, forged, 0, 8)).toThrow('Expanded archive data')
    expect(() => extractZipEntry(data, entries, 99)).toThrow('not found')
  })

  it('rejects corruption even when stored entry sizes still match', () => {
    const data = zipSync({ 'test.txt': [content, { level: 0 }] })
    const view = new DataView(data.buffer)
    const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    data[payload] ^= 1
    expect(() => extractZipEntry(data, listZip(data), 0)).toThrow('checksum mismatch')
  })

  it('bounds archive entry counts and only extracts Office content parts', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`file${index}`, new Uint8Array()]))
    expect(() => listZip(zipSync(tooMany))).toThrow('1,000')
    const xml = '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:document>'
    const data = zipSync({ 'word/document.xml': new TextEncoder().encode(xml), 'word/media/ignored.bin': content })
    expect(readOfficeParts(data, 'docx')).toEqual({ parts: [{ name: 'word/document.xml', xml }], truncated: false })
  })
})
