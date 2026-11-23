import { Unzip, UnzipInflate, unzipSync } from 'fflate'
import { crc32 } from '@/lib/crc32'
import type { ArchiveEntry, OfficeFormat, OfficePart } from './protocol'

export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 1000
const MAX_OFFICE_BYTES = 2 * 1024 * 1024

function entryCrc(data: Uint8Array, index: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557)) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === data.length) break
    end--
  }
  if (end < Math.max(0, data.length - 65557)) throw new Error('ZIP directory not found.')
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 10, true) === 0xffff) {
    throw new Error('Split and ZIP64 archives are not supported for extraction.')
  }
  let offset = view.getUint32(end + 16, true)
  for (let current = 0; current <= index; current++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.')
    if (current === index) {
      if (view.getUint16(offset + 8, true) & 1) throw new Error('Encrypted ZIP entries cannot be previewed or extracted.')
      return view.getUint32(offset + 16, true)
    }
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  throw new Error('ZIP directory entry not found.')
}

export function listZip(data: Uint8Array): ArchiveEntry[] {
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('ZIP and Office previews are limited to 16 MiB compressed.')
  const entries: ArchiveEntry[] = []
  unzipSync(data, {
    filter(file) {
      if (entries.length >= MAX_ENTRIES) throw new Error('Archive previews are limited to 1,000 entries.')
      entries.push({ index: entries.length, name: file.name, size: file.originalSize, compressedSize: file.size, compression: file.compression })
      return false
    },
  })
  return entries
}

export function extractZipEntry(data: Uint8Array, entries: ArchiveEntry[], index: number, limit = MAX_ENTRY_BYTES): Uint8Array<ArrayBuffer> {
  const entry = entries[index]
  if (!entry || !Number.isInteger(index)) throw new Error('Archive entry not found.')
  if (entries.filter((item) => item.name === entry.name).length !== 1) throw new Error('Extraction of duplicate archive paths is not supported.')
  if (entry.name.endsWith('/')) throw new Error('Select a file, not a directory.')
  if (entry.size > limit) throw new Error(`This entry exceeds the ${limit / 1024 / 1024} MiB extraction limit.`)
  if (entry.compression !== 0 && entry.compression !== 8) throw new Error('Only stored and DEFLATE ZIP entries can be extracted.')
  const expectedCrc = entryCrc(data, index)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  let finished = false
  const unzip = new Unzip((file) => {
    if (file.name !== entry.name) { file.terminate(); return }
    file.ondata = (error, bytes, final) => {
      if (error) throw error
      length += bytes.length
      if (length > limit) throw new Error('Expanded archive data exceeds the extraction limit.')
      chunks.push(Uint8Array.from(bytes))
      finished = final
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // Small compressed pushes also bound each decompressor output allocation.
  for (let offset = 0; offset < data.length && !finished; offset += 256) {
    unzip.push(data.subarray(offset, offset + 256), offset + 256 >= data.length)
  }
  if (!finished || length !== entry.size) throw new Error('Archive entry is incomplete or its size does not match the ZIP directory.')
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  if (crc32(output) !== expectedCrc) throw new Error('Archive entry checksum mismatch.')
  return output
}

export function readOfficeParts(data: Uint8Array, format: OfficeFormat): { parts: OfficePart[]; truncated: boolean } {
  const entries = listZip(data)
  const pattern = format === 'docx' ? /^word\/document\.xml$/
    : format === 'xlsx' ? /^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/
      : /^ppt\/slides\/slide\d+\.xml$/
  const matching = entries.filter((entry) => pattern.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const selected = matching.slice(0, 24)
  if (!selected.length) throw new Error('No supported document content was found in this Office package.')
  let remaining = MAX_OFFICE_BYTES
  const parts = selected.map((entry) => {
    const bytes = extractZipEntry(data, entries, entry.index, remaining)
    remaining -= bytes.length
    return { name: entry.name, xml: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  })
  return { parts, truncated: matching.length > selected.length }
}
