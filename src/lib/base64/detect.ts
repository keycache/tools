import { fileTypeFromBlob } from 'file-type'
import { INLINE_CHARS } from './codec'
import { detectText, type DetectedFormat } from './format'

export async function detectFormat(source: Blob): Promise<DetectedFormat | null> {
  if (!source.size) return null
  const binary = await fileTypeFromBlob(source, { maxBufferSize: 512 * 1024 })
  if (binary && !['xml', 'svg'].includes(binary.ext)) return { ...binary, method: 'signature' }
  const sample = new Uint8Array(await source.slice(0, INLINE_CHARS).arrayBuffer())
  return detectText(sample, source.size <= INLINE_CHARS) ?? (binary ? { ...binary, method: 'signature' } : null)
}
