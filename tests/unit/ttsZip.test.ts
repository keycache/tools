import { describe, expect, it } from 'vitest'
import { wavPieces as wavPiecesRaw } from '@/lib/tts/audio'
import { lineEntries, linesZip } from '@/lib/tts/lines'
import { crc32, createZip, dosDateTime } from '@/lib/tts/zip'

const wavPiecesForTest = (parts: { pcm16: Int16Array; pauseBefore: number }[]) => wavPiecesRaw(parts, 1000)

const bytes = (s: string) => new TextEncoder().encode(s)

/** Minimal reader: walks the central directory, checks each local header against it, and returns names + data. */
async function readZip(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const v = new DataView(buf.buffer)
  const eocd = buf.length - 22
  expect(v.getUint32(eocd, true)).toBe(0x06054b50)
  const count = v.getUint16(eocd + 10, true)
  const cdSize = v.getUint32(eocd + 12, true)
  let at = v.getUint32(eocd + 16, true)
  expect(at + cdSize).toBe(eocd)
  const files = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50)
    const flags = v.getUint16(at + 8, true)
    const method = v.getUint16(at + 10, true)
    const crc = v.getUint32(at + 16, true)
    const size = v.getUint32(at + 20, true)
    expect(v.getUint32(at + 24, true)).toBe(size)
    const nameLen = v.getUint16(at + 28, true)
    const extra = v.getUint16(at + 30, true)
    const comment = v.getUint16(at + 32, true)
    const local = v.getUint32(at + 42, true)
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen))
    expect(v.getUint32(local, true)).toBe(0x04034b50)
    expect(v.getUint32(local + 14, true)).toBe(crc)
    expect(v.getUint16(local + 26, true)).toBe(nameLen)
    const start = local + 30 + nameLen + v.getUint16(local + 28, true)
    const data = buf.slice(start, start + size)
    expect(crc32(data)).toBe(crc)
    files.push({ name, flags, method, data })
    at += 46 + nameLen + extra + comment
  }
  return files
}

describe('crc32', () => {
  it('matches standard test vectors and can continue over pieces', () => {
    expect(crc32(bytes(''))).toBe(0)
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
    expect(crc32(bytes('6789'), crc32(bytes('12345')))).toBe(0xcbf43926)
  })
})

describe('createZip', () => {
  it('round-trips names (UTF-8) and bytes, joining pieces in order, stored', async () => {
    const wav = new Uint8Array(1000).map((_, i) => i % 251)
    const blob = createZip([
      { name: '001-S1.wav', data: [wav.subarray(0, 44), wav.subarray(44)] },
      { name: '002-S2 – café.wav', data: bytes('hello') },
      { name: 'empty.wav', data: new Uint8Array(0) },
    ])
    const files = await readZip(blob)
    expect(files.map((f) => f.name)).toEqual(['001-S1.wav', '002-S2 – café.wav', 'empty.wav'])
    expect(files.every((f) => f.method === 0 && f.flags === 0x0800)).toBe(true)
    expect(files[0].data).toEqual(wav)
    expect(new TextDecoder().decode(files[1].data)).toBe('hello')
    expect(files[2].data.length).toBe(0)
    expect(blob.type).toBe('application/zip')
  })

  it('writes an empty archive as just the end record', async () => {
    const blob = createZip([])
    expect(blob.size).toBe(22)
    expect(await readZip(blob)).toEqual([])
  })

  it('encodes DOS date and time', () => {
    expect(dosDateTime(new Date(2026, 10, 15, 21, 34, 19))).toEqual({ time: (21 << 11) | (34 << 5) | 9, date: (46 << 9) | (11 << 5) | 15 })
  })
})

describe('lineEntries', () => {
  const part = (line: number, speaker: 1 | 2 | 3 | 4, values: number[], pauseBefore = 0.5) => ({ pcm16: Int16Array.from(values), pauseBefore, line, speaker })
  const pcm = (piece: Uint8Array[]) => {
    const all = new Uint8Array(piece.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of piece) {
      all.set(p, at)
      at += p.length
    }
    return new Int16Array(all.buffer.slice(44))
  }

  it('groups parts per line, names them in order, and rejoined with the gaps equals the stitched WAV', () => {
    const parts = [part(0, 1, [1, 2], 0), part(0, 1, [3], 0.001), part(1, 2, [4, 5], 0.002), part(2, 1, [6], 0.001)]
    const entries = lineEntries(parts, 1000, true)
    expect(entries.map((e) => e.name)).toEqual(['001-S1.wav', '002-S2.wav', '003-S1.wav'])
    const lines = entries.map((e) => pcm(e.data as Uint8Array[]))
    // Inside a line the pause stays (1 sample at 1 kHz); the first part's own pause is dropped.
    expect(lines.map((l) => [...l])).toEqual([[1, 2, 0, 3], [4, 5], [6]])
    const stitched = pcm(wavPiecesForTest(parts))
    expect([...stitched]).toEqual([...lines[0], 0, 0, ...lines[1], 0, ...lines[2]])
  })

  it('single mode names files without speakers; a single line needs no zip', () => {
    expect(lineEntries([part(0, 1, [1]), part(1, 1, [2])], 1000, false).map((e) => e.name)).toEqual(['001.wav', '002.wav'])
    expect(linesZip([part(0, 1, [1]), part(0, 1, [2])], 1000, false)).toBeNull()
  })

  it('pads names to the whole job when it stopped early', () => {
    expect(lineEntries([part(0, 1, [1]), part(1, 2, [2])], 1000, true, 1200).map((e) => e.name)).toEqual(['0001-S1.wav', '0002-S2.wav'])
  })
})
