import { listOpfsEntries, clearOpfsDir, isOpfsSupported, opfsDir, type EntryMeta } from '@/lib/transformers/opfsCache'
import { isCurrentOrtRuntime, pruneStaleOrtRuntime } from '@/lib/transformers/runtime'
import { isTtsFileFor, type TtsDtype } from './constants'

/** Speak's model files (+ the ORT runtime) live here, separate from Gemma's `gemma-models`. */
export const TTS_OPFS_DIR = 'tts-models'
export const ttsDir = opfsDir(TTS_OPFS_DIR)

export interface TtsCacheInfo {
  /** Everything stored for Speak (model files + default voice + ONNX runtime). */
  bytes: number
  files: number
}

/** Per dtype: bytes of the files a load would read from storage — decides "stored" vs "download". */
export type TtsReadyBytes = Record<TtsDtype, number>

export interface TtsCacheDetails {
  info: TtsCacheInfo
  ready: TtsReadyBytes
}

export const EMPTY_TTS_CACHE: TtsCacheDetails = { info: { bytes: 0, files: 0 }, ready: { q4f16: 0, q4: 0 } }

/**
 * Bytes stored for exactly the files a `dtype` load needs (that dtype's language model, the fp32 sessions,
 * configs/tokenizer/default voice at the pinned revision, the current ORT runtime). Other dtypes, revisions and stale
 * runtimes don't count, so the gate never claims "stored" while a needed file is missing.
 */
export function ttsReadyBytesFor(entries: EntryMeta[], dtype: TtsDtype): number {
  return entries.reduce((sum, e) => (isTtsFileFor(e.url, dtype) || isCurrentOrtRuntime(e.url) ? sum + e.size : sum), 0)
}

/** Stored size and per-dtype ready bytes; deletes ORT runtime files of an older build first. */
export async function getTtsCacheDetails(): Promise<TtsCacheDetails> {
  if (!isOpfsSupported()) return EMPTY_TTS_CACHE
  await pruneStaleOrtRuntime(ttsDir).catch(() => [])
  const entries = await listOpfsEntries(ttsDir)
  return {
    info: { bytes: entries.reduce((s, e) => s + e.size, 0), files: entries.length },
    ready: { q4f16: ttsReadyBytesFor(entries, 'q4f16'), q4: ttsReadyBytesFor(entries, 'q4') },
  }
}

export function clearTtsCache(): Promise<void> {
  return clearOpfsDir(TTS_OPFS_DIR)
}
