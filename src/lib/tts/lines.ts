/**
 * "Download lines (.zip)": the finished parts grouped into one WAV per line — a turn in conversation mode, a paragraph
 * in single mode (see `ScriptChunk.line`). Pauses between lines aren't stored. docs/SPECIFICATIONS.md §S21.
 */
import { wavPieces } from './audio'
import { lineFileName, type SpeakerNumber } from './script'
import { createZip, type ZipEntry } from './zip'

export interface LinePart {
  pcm16: Int16Array
  pauseBefore: number
  line: number
  speaker: SpeakerNumber
}

/**
 * Zip entries in line order; `conversation` adds the speaker to each name (`001-S1.wav`, else `001.wav`). `total` is
 * the job's line count, so a stopped job's partial zip is padded like the full one would be.
 */
export function lineEntries(parts: LinePart[], sampleRate: number, conversation: boolean, total = 0): ZipEntry[] {
  const groups: LinePart[][] = []
  for (const p of parts) {
    const last = groups[groups.length - 1]
    if (last && last[0].line === p.line) last.push(p)
    else groups.push([p])
  }
  const count = Math.max(total, parts.length ? parts[parts.length - 1].line + 1 : 0)
  return groups.map((g) => ({
    name: lineFileName(g[0].line, count, conversation ? g[0].speaker : undefined),
    data: wavPieces(g, sampleRate),
  }))
}

/** The lines zip, or null when there's only one line (the WAV download already covers it). */
export function linesZip(parts: LinePart[], sampleRate: number, conversation: boolean, total = 0, modified = new Date()): Blob | null {
  const entries = lineEntries(parts, sampleRate, conversation, total)
  return entries.length > 1 ? createZip(entries, modified) : null
}
