import type { DetectedFormat } from './format'

export interface ArchiveEntry { index: number; name: string; size: number; compressedSize: number; compression: number }
export interface OfficePart { name: string; xml: string }
export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'
export type Base64Command =
  | { type: 'encode'; source: Blob }
  | { type: 'decode'; source: Blob }
  | { type: 'detect'; source: Blob }
  | { type: 'archive'; source: Blob }
  | { type: 'extract'; source: Blob; index: number }
  | { type: 'office'; source: Blob; format: OfficeFormat }

export type Base64Result =
  | { kind: 'encoded' | 'decoded'; blob: Blob }
  | { kind: 'detected'; format: DetectedFormat | null }
  | { kind: 'archive'; entries: ArchiveEntry[] }
  | { kind: 'extracted'; blob: Blob; name: string }
  | { kind: 'office'; parts: OfficePart[]; truncated: boolean }

export interface Base64Request { id: number; command: Base64Command }
export type Base64Response =
  | { id: number; type: 'progress'; percent: number }
  | { id: number; type: 'result'; result: Base64Result }
  | { id: number; type: 'error'; message: string }
