/**
 * Splits long text into chunks that each fit one Chatterbox generate call (see MAX_CHUNK_CHARS). Pure.
 * docs/SPECIFICATIONS.md §S6.
 */
import { MAX_CHUNK_CHARS } from './constants'

export type PauseKind = 'paragraph' | 'sentence'

export interface TextChunk {
  text: string
  /** Silence inserted before this chunk when joining (none before the first). */
  pause: PauseKind
}

/** Seconds of silence before a chunk, by kind. */
export const PAUSE_SECONDS: Record<PauseKind, number> = { sentence: 0.15, paragraph: 0.4 }

/** Words that end with a period without ending the sentence (compared lower-case, without the period). */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'al', 'inc', 'ltd', 'co',
  'corp', 'no', 'nos', 'fig', 'vol', 'ch', 'p', 'pp', 'approx', 'dept', 'est', 'gen', 'gov', 'capt', 'lt', 'col', 'sgt',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'a.m', 'p.m', 'u.s', 'u.k',
])

/** Sentence terminators (incl. trailing quotes/brackets) followed by whitespace or the end of the text. */
const TERMINATOR = /[.!?…]+["'”’)\]]*(?=\s|$)/g

/** Splits one paragraph into sentences; abbreviations, initials ("J. R. R.") and decimals don't end a sentence. */
export function splitSentences(paragraph: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const m of paragraph.matchAll(TERMINATOR)) {
    const end = m.index + m[0].length
    if (m[0] === '.') {
      const word = paragraph.slice(start, m.index).match(/(\S+)$/)?.[1] ?? ''
      const bare = word.replace(/^["'“‘([]+/, '').toLowerCase()
      if (ABBREVIATIONS.has(bare) || /^[a-z]$/i.test(bare)) continue
    }
    const s = paragraph.slice(start, end).trim()
    if (s) sentences.push(s)
    start = end
  }
  const rest = paragraph.slice(start).trim()
  if (rest) sentences.push(rest)
  return sentences
}

/**
 * Splits text that's too long for one chunk: at the last clause break (`,;:—–`) before `max` (if it leaves a
 * reasonably long first part), else at the last space, else hard at `max`.
 */
export function splitLong(text: string, max = MAX_CHUNK_CHARS): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const head = rest.slice(0, max + 1)
    let cut = -1
    for (const m of head.matchAll(/[,;:—–](?=\s)|\s[—–](?=\s)/g)) if (m.index + 1 >= max / 3 && m.index + 1 <= max) cut = m.index + 1
    if (cut < 0) cut = head.lastIndexOf(' ', max)
    if (cut <= 0) cut = max
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/**
 * Paragraphs (blank lines) → sentences → clause splits for sentences over `maxChars`. Consecutive short sentences in
 * a paragraph are merged up to `maxChars`: every chunk is a separate generate call, so fewer chunks finish sooner.
 */
export function splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS): TextChunk[] {
  const chunks: TextChunk[] = []
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  for (const paragraph of paragraphs) {
    let current = ''
    let first = true
    const flush = () => {
      if (!current) return
      chunks.push({ text: current, pause: first ? 'paragraph' : 'sentence' })
      first = false
      current = ''
    }
    for (const sentence of splitSentences(paragraph)) {
      for (const piece of splitLong(sentence, maxChars)) {
        if (current && current.length + 1 + piece.length <= maxChars) current = `${current} ${piece}`
        else {
          flush()
          current = piece
        }
      }
    }
    flush()
  }
  return chunks
}

/**
 * Splits a chunk that hit the token cap into two halves near the middle — at a clause break if there's one in the
 * middle half, else at the space closest to the middle. Null if it can't be split (no space).
 */
export function splitInHalf(text: string): [string, string] | null {
  const t = text.trim()
  const mid = t.length / 2
  let best = -1
  for (const m of t.matchAll(/[,;:—–](?=\s)/g)) {
    const at = m.index + 1
    if (Math.abs(at - mid) <= t.length / 4 && (best < 0 || Math.abs(at - mid) < Math.abs(best - mid))) best = at
  }
  if (best < 0) {
    for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  }
  if (best <= 0) return null
  const a = t.slice(0, best).trim()
  const b = t.slice(best).trim()
  return a && b ? [a, b] : null
}
