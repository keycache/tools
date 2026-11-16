/**
 * Script markers for Speak (docs/SPECIFICATIONS.md §S19): `[S1]`–`[S4]` speaker tags, `[pause 1.5s]` /
 * `[pause 500ms]` and `[exaggeration 0.8]`. Pure: `parseScript` → turns + diagnostics, `planChunks` → generate calls.
 */
import { MAX_CHUNK_CHARS } from './constants'
import { PAUSE_SECONDS, splitIntoChunks } from './chunk'

export type ScriptMode = 'single' | 'conversation'
export type SpeakerNumber = 1 | 2 | 3 | 4

export const MAX_SPEAKERS = 4
export const MAX_PAUSE_SECONDS = 10
export const EXAGGERATION_MARKER_RANGE = [0, 1.5] as const
/** Silence between turns of different speakers (unless a `[pause]` sets it). */
export const TURN_GAP_SECONDS = 0.5
/** Rough audio length per character of text (S0 measurements). */
export const SECONDS_PER_CHAR = 0.066

export interface Turn {
  speaker: SpeakerNumber
  /** Spoken text, markers removed (unknown `[…]` are kept — they're read aloud). */
  text: string
  /** From an `[exaggeration X]` marker in the turn; otherwise the speaker's / slider's value applies. */
  exaggeration?: number
  /** From `[pause …]` markers right before this text; replaces the automatic gap. */
  pauseBefore?: number
  /** 1-based line where the text starts. */
  line: number
  /** Single mode: the line follows a blank line (a paragraph break). */
  paragraph: boolean
}

export interface Diagnostic {
  line: number
  severity: 'error' | 'warning' | 'hint'
  message: string
}

export interface ParsedScript {
  mode: ScriptMode
  turns: Turn[]
  /** Speakers in order of first appearance. */
  speakers: SpeakerNumber[]
  diagnostics: Diagnostic[]
  summary: { speakers: number; turns: number; chars: number; estSeconds: number }
}

const MARKER = /\[([^[\]\n]*)\]/g
const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)`
const PAUSE = new RegExp(String.raw`^${NUMBER}\s*(ms|milliseconds?|s|secs?|seconds?)?$`, 'i')

type Marker =
  | { kind: 'speaker'; n: number }
  | { kind: 'pause'; seconds: number | null }
  | { kind: 'exaggeration'; value: number | null }
  | { kind: 'unknown' }

function classify(body: string): Marker {
  const b = body.trim().replace(/\s+/g, ' ')
  const speaker = b.match(/^s ?(\d+)$/i)
  if (speaker) return { kind: 'speaker', n: Number(speaker[1]) }
  const pause = b.match(/^pause\b ?(.*)$/i)
  if (pause) {
    const m = pause[1].match(PAUSE)
    const v = m ? Number(m[1]) / (m[2]?.toLowerCase().startsWith('m') ? 1000 : 1) : NaN
    return { kind: 'pause', seconds: Number.isFinite(v) && v >= 0 && v <= MAX_PAUSE_SECONDS ? v : null }
  }
  const ex = b.match(/^exaggeration\b ?(.*)$/i)
  if (ex) {
    const v = /^\d*\.?\d+$|^\d+\.$/.test(ex[1]) ? Number(ex[1]) : NaN
    const [lo, hi] = EXAGGERATION_MARKER_RANGE
    return { kind: 'exaggeration', value: Number.isFinite(v) && v >= lo && v <= hi ? v : null }
  }
  return { kind: 'unknown' }
}

interface Piece {
  text: string
  line: number
  pauseBefore?: number
}

interface RawTurn {
  speaker: SpeakerNumber
  /** Conversation: text before the first speaker tag (spoken by Speaker 1). */
  implicit: boolean
  paragraph: boolean
  exaggeration?: number
  pieces: Piece[]
}

/** Parses `text` into turns. Single mode: each line is a turn (the scope of `[exaggeration]`); speaker tags are ignored. */
export function parseScript(text: string, { mode }: { mode: ScriptMode }): ParsedScript {
  const src = text.replace(/\r\n?/g, '\n')
  const diagnostics: Diagnostic[] = []
  const raw: RawTurn[] = []
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1)
  const lineAt = (index: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  let cur: RawTurn | null = null
  let pending: { seconds: number; line: number } | null = null
  // Single mode: whether the current line has had anything yet, and whether a blank line came before the next turn.
  let lineEmpty = true
  let blankBefore = false
  let speakerHinted = false

  const startTurn = (speaker: SpeakerNumber, at: number, implicit = false) => {
    cur = { speaker, implicit, paragraph: mode === 'single' && blankBefore, pieces: [{ text: '', line: lineAt(at) }] }
    blankBefore = false
    raw.push(cur)
    return cur
  }
  const turnForContent = (at: number): RawTurn => cur ?? startTurn(1, at, mode === 'conversation')

  const addText = (s: string, at: number) => {
    if (!s) return
    const lead = s.search(/\S/)
    if (lead < 0) {
      if (cur) cur.pieces[cur.pieces.length - 1].text += s
      return
    }
    lineEmpty = false
    const turn = turnForContent(at + lead)
    let piece = turn.pieces[turn.pieces.length - 1]
    if (pending) {
      if (piece.text.trim()) {
        piece = { text: '', line: lineAt(at + lead) }
        turn.pieces.push(piece)
      }
      piece.pauseBefore = (piece.pauseBefore ?? 0) + pending.seconds
      pending = null
    }
    if (!piece.text.trim()) piece.line = lineAt(at + lead)
    piece.text += s
  }

  const handleText = (s: string, at: number) => {
    if (mode === 'conversation') return addText(s, at)
    let offset = 0
    for (const [i, part] of s.split('\n').entries()) {
      if (i > 0) {
        if (lineEmpty) blankBefore = true
        lineEmpty = true
        cur = null
      }
      addText(part, at + offset)
      offset += part.length + 1
    }
  }

  const handleMarker = (body: string, whole: string, at: number) => {
    const line = lineAt(at)
    const m = classify(body)
    if (m.kind !== 'unknown') lineEmpty = false
    switch (m.kind) {
      case 'speaker':
        if (mode === 'single') {
          if (!speakerHinted) diagnostics.push({ line, severity: 'hint', message: `${whole.trim()} — speaker tags only apply in Conversation mode, so they're ignored here` })
          speakerHinted = true
        } else if (m.n < 1 || m.n > MAX_SPEAKERS) {
          diagnostics.push({ line, severity: 'error', message: `${whole} — up to ${MAX_SPEAKERS} speakers ([S1]–[S${MAX_SPEAKERS}])` })
        } else startTurn(m.n as SpeakerNumber, at)
        return
      case 'pause':
        if (m.seconds === null) diagnostics.push({ line, severity: 'error', message: `${whole} — a pause is 0–${MAX_PAUSE_SECONDS} s, e.g. [pause 1.5s] or [pause 500ms]` })
        else pending = { seconds: (pending?.seconds ?? 0) + m.seconds, line: pending?.line ?? line }
        return
      case 'exaggeration': {
        const [lo, hi] = EXAGGERATION_MARKER_RANGE
        if (m.value === null) {
          diagnostics.push({ line, severity: 'error', message: `${whole} — exaggeration is a number from ${lo} to ${hi}, e.g. [exaggeration 0.8]` })
          return
        }
        const turn = turnForContent(at)
        if (turn.exaggeration !== undefined && turn.exaggeration !== m.value)
          diagnostics.push({ line, severity: 'warning', message: `Two exaggeration markers in one ${mode === 'single' ? 'line' : 'turn'} — using ${m.value}` })
        turn.exaggeration = m.value
        return
      }
      case 'unknown':
        addText(whole, at)
        diagnostics.push({ line, severity: 'warning', message: `${whole} isn't a marker — it will be read aloud` })
    }
  }

  let pos = 0
  for (const m of src.matchAll(MARKER)) {
    handleText(src.slice(pos, m.index), pos)
    handleMarker(m[1], m[0], m.index)
    pos = m.index + m[0].length
  }
  handleText(src.slice(pos), pos)

  const turns: Turn[] = []
  for (const r of raw) {
    const spoken = r.pieces.filter((p) => p.text.trim())
    if (r.implicit && spoken.length)
      diagnostics.push({ line: spoken[0].line, severity: 'warning', message: 'Text before the first speaker tag is spoken by Speaker 1' })
    for (const [i, p] of spoken.entries()) {
      const turn: Turn = { speaker: r.speaker, text: p.text.trim(), line: p.line, paragraph: i === 0 && r.paragraph }
      if (r.exaggeration !== undefined) turn.exaggeration = r.exaggeration
      if (p.pauseBefore !== undefined) turn.pauseBefore = p.pauseBefore
      turns.push(turn)
    }
  }
  if (turns[0]?.pauseBefore !== undefined) {
    diagnostics.push({ line: turns[0].line, severity: 'hint', message: 'A pause before the first words has no effect' })
    delete turns[0].pauseBefore
  }
  // Re-bind: TS narrows `pending` to null after the loop because it's only assigned inside closures.
  const trailing = pending as { seconds: number; line: number } | null
  if (trailing && turns.length) diagnostics.push({ line: trailing.line, severity: 'hint', message: 'A pause after the last words has no effect' })

  const speakers: SpeakerNumber[] = []
  for (const t of turns) if (!speakers.includes(t.speaker)) speakers.push(t.speaker)
  const chars = turns.reduce((n, t) => n + t.text.length, 0)
  let gaps = 0
  for (let i = 1; i < turns.length; i++) gaps += turns[i].pauseBefore ?? (mode === 'conversation' ? (turns[i].speaker !== turns[i - 1].speaker ? TURN_GAP_SECONDS : PAUSE_SECONDS.paragraph) : 0)
  diagnostics.sort((a, b) => a.line - b.line)
  return {
    mode,
    turns,
    speakers: mode === 'single' ? (turns.length ? [1] : []) : speakers,
    diagnostics,
    summary: { speakers: speakers.length, turns: turns.length, chars, estSeconds: chars * SECONDS_PER_CHAR + gaps },
  }
}

export function hasErrors(script: ParsedScript): boolean {
  return script.diagnostics.some((d) => d.severity === 'error')
}

/** One generate call. */
export interface ScriptChunk {
  text: string
  speaker: SpeakerNumber
  exaggeration: number
  /** Silence before this chunk in seconds (0 for the first). */
  pause: number
  /** Index into `script.turns` of the turn (single mode: first turn of a merged run) this chunk belongs to. */
  turn: number
}

/**
 * Turns → generate calls. Each turn is chunked with `splitIntoChunks` (sentence / paragraph pauses inside it). Between
 * turns: the `[pause]` value, else 0.5 s for a speaker change, 0.4 s for the same speaker (conversation) or the line /
 * paragraph pause (single). Single mode first merges consecutive lines with the same settings, so text without markers
 * is chunked exactly as before.
 */
export function planChunks(
  script: ParsedScript,
  exaggeration: number | ((speaker: SpeakerNumber) => number),
  maxChars = MAX_CHUNK_CHARS,
): ScriptChunk[] {
  const base = typeof exaggeration === 'function' ? exaggeration : () => exaggeration
  const groups: { first: number; turn: Turn; text: string }[] = []
  script.turns.forEach((turn, i) => {
    const last = groups[groups.length - 1]
    if (script.mode === 'single' && last && turn.pauseBefore === undefined && turn.exaggeration === last.turn.exaggeration) {
      last.text += turn.paragraph ? `\n\n${turn.text}` : `\n${turn.text}`
    } else groups.push({ first: i, turn, text: turn.text })
  })
  const out: ScriptChunk[] = []
  groups.forEach(({ first, turn, text }, g) => {
    const prev = groups[g - 1]?.turn
    const gap =
      turn.pauseBefore ??
      (script.mode === 'conversation'
        ? prev && prev.speaker !== turn.speaker
          ? TURN_GAP_SECONDS
          : PAUSE_SECONDS.paragraph
        : PAUSE_SECONDS[turn.paragraph ? 'paragraph' : 'sentence'])
    const ex = turn.exaggeration ?? base(turn.speaker)
    splitIntoChunks(text, maxChars).forEach((c, i) => {
      out.push({ text: c.text, speaker: turn.speaker, exaggeration: ex, pause: out.length === 0 ? 0 : i === 0 ? gap : PAUSE_SECONDS[c.pause], turn: first })
    })
  })
  return out
}

/** "about 1 min 40 s" */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}
