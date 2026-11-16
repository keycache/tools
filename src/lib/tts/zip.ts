/**
 * Minimal store-only ZIP writer (no compression — WAV barely compresses and storing keeps it instant). Local file
 * headers + data + central directory + end record; CRC-32; UTF-8 names. No ZIP64: callers stay far below 4 GB and
 * 65,535 entries. docs/SPECIFICATIONS.md §S21.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 (IEEE). Pass the previous result as `crc` to continue over more data. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  /** The file's bytes, optionally in pieces (e.g. a WAV header + PCM buffers) — they're never joined. */
  data: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>[]
}

/** MS-DOS time and date fields (local time, 2-second resolution, years 1980–2107). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

const UTF8_FLAG = 0x0800
const VERSION = 20

export function createZip(entries: ZipEntry[], modified = new Date()): Blob {
  if (entries.length > 0xffff) throw new Error('Too many files for a zip without ZIP64.')
  const { time, date } = dosDateTime(modified)
  const enc = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const pieces = Array.isArray(entry.data) ? entry.data : [entry.data]
    let size = 0
    let crc = 0
    for (const p of pieces) {
      size += p.length
      crc = crc32(p, crc)
    }
    if (offset + size + 30 + name.length > 0xffffffff) throw new Error('Too large for a zip without ZIP64.')

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, VERSION, true)
    local.setUint16(6, UTF8_FLAG, true)
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, ...pieces)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, VERSION, true)
    cd.setUint16(6, VERSION, true)
    cd.setUint16(8, UTF8_FLAG, true)
    cd.setUint16(10, 0, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, size, true)
    cd.setUint32(24, size, true)
    cd.setUint16(28, name.length, true)
    // extra, comment, disk start, internal attributes, external attributes: 0
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)

    offset += 30 + name.length + size
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  if (offset + cdSize > 0xffffffff) throw new Error('Too large for a zip without ZIP64.')
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}
