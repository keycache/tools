import type { ChatTurn, GemmaErrorCode } from './protocol'

/** Gemma 4 chat-template message (what `processor.apply_chat_template` expects). */
export type TemplateMessage =
  | { role: 'user'; content: ({ type: 'image' } | { type: 'audio' } | { type: 'text'; text: string })[] }
  | { role: 'assistant'; content: string }

/**
 * Media goes before the text, image then audio (the model card's order). The processor later replaces each
 * placeholder, in order, with that item's soft tokens — so images must be passed in the same order
 * (see `collectImages`).
 */
export function toTemplateMessages(turns: ChatTurn[]): TemplateMessage[] {
  return turns.map((t) =>
    t.role === 'user'
      ? {
          role: 'user',
          content: [
            ...(t.images ?? []).map(() => ({ type: 'image' as const })),
            ...(t.audio ? [{ type: 'audio' as const }] : []),
            { type: 'text' as const, text: t.text },
          ],
        }
      : { role: 'assistant', content: t.text },
  )
}

/** All images of the given turns, in prompt order. */
export function collectImages(turns: ChatTurn[]): Blob[] {
  return turns.flatMap((t) => (t.role === 'user' ? (t.images ?? []) : []))
}

/** The (single) audio clip of the given turns — call after `limitAudio`. */
export function collectAudio(turns: ChatTurn[]): Float32Array | null {
  return turns.find((t) => t.audio)?.audio ?? null
}

/**
 * `Gemma4Processor` only uses the first audio clip it's given (`audio_array[0]`), so keep audio on the newest turn
 * that has it and strip it from older turns (their text stays).
 */
export function limitAudio(turns: ChatTurn[]): { turns: ChatTurn[]; dropped: number } {
  let seen = false
  let dropped = 0
  const out = [...turns]
  for (let i = out.length - 1; i >= 0; i--) {
    if (!out[i].audio) continue
    if (seen) {
      out[i] = { ...out[i], audio: undefined }
      dropped++
    }
    seen = true
  }
  return { turns: out, dropped }
}

export const AUDIO_SAMPLE_RATE = 16_000
/** Gemma 4 audio input limit (model card: max 30 s; processor caps at 750 tokens × 40 ms). */
export const MAX_AUDIO_SECONDS = 30

/** Mirrors `Gemma4Processor._compute_audio_num_tokens` (+2 for begin/end-of-audio markers). */
export function audioTokens(samples: number, sampleRate = AUDIO_SAMPLE_RATE): number {
  const frame = Math.round((sampleRate * 20) / 1000)
  const hop = Math.round((sampleRate * 10) / 1000)
  let t = Math.floor((samples + Math.floor(frame / 2) - frame - 1) / hop) + 1
  if (t <= 0) return 0
  for (let i = 0; i < 2; i++) t = Math.floor((t - 1) / 2) + 1
  return Math.min(t, 750) + 2
}

/** Per-turn template overhead (`<|turn>role\n … <turn|>\n`) on top of the text's own tokens. */
const TURN_OVERHEAD_TOKENS = 6
/** Gemma 4 vision: at most 280 soft tokens per image (`max_soft_tokens`) + begin/end-of-image markers. */
export const IMAGE_TOKENS = 282

/**
 * Keeps the newest turns that fit in `budget` tokens. The latest turn (the user's question) is always kept, and
 * the kept history always starts with a user turn so the template stays well-formed. Images count IMAGE_TOKENS
 * each, and are dropped together with their turn.
 */
export function trimTurns(turns: ChatTurn[], countTokens: (text: string) => number, budget: number): { kept: ChatTurn[]; dropped: number } {
  if (!turns.length) return { kept: [], dropped: 0 }
  let used = 0
  let start = turns.length
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost =
      countTokens(turns[i].text) +
      TURN_OVERHEAD_TOKENS +
      (turns[i].images?.length ?? 0) * IMAGE_TOKENS +
      (turns[i].audio ? audioTokens(turns[i].audio!.length) : 0)
    if (i < turns.length - 1 && used + cost > budget) break
    used += cost
    start = i
  }
  while (start < turns.length - 1 && turns[start].role !== 'user') start++
  return { kept: turns.slice(start), dropped: start }
}

/** Special tokens that can appear in raw (special-tokens-kept) output and must not reach the user. */
const STRIP_TOKENS = ['<turn|>', '<|turn>', '<eos>', '<bos>', '<|think|>', '<pad>']
const CHANNEL_OPEN = '<|channel>'
const CHANNEL_CLOSE = '<channel|>'

export interface ParsedOutput {
  answer: string
  thinking: string
  /** The thinking channel is open and not yet closed. */
  inThinking: boolean
}

/**
 * Splits raw model output into reasoning and answer. With thinking enabled Gemma 4 emits
 * `<|channel>thought\n…<channel|>` before the answer; the channel markers are special tokens, so output is decoded
 * with special tokens kept and parsed here. Safe to call on partial (streaming) text: a marker cut in half at
 * the end of the buffer is held back rather than shown.
 */
export function parseOutput(raw: string): ParsedOutput {
  let text = raw
  for (const tok of STRIP_TOKENS) text = text.split(tok).join('')
  let thinking = ''
  let answer = ''
  let inThinking = false
  let rest = text
  while (rest.length) {
    if (inThinking) {
      const close = rest.indexOf(CHANNEL_CLOSE)
      if (close === -1) {
        thinking += holdBackPartial(rest, CHANNEL_CLOSE)
        rest = ''
      } else {
        thinking += rest.slice(0, close)
        rest = rest.slice(close + CHANNEL_CLOSE.length)
        inThinking = false
      }
    } else {
      const open = rest.indexOf(CHANNEL_OPEN)
      if (open === -1) {
        answer += holdBackPartial(rest, CHANNEL_OPEN)
        rest = ''
      } else {
        answer += rest.slice(0, open)
        rest = rest.slice(open + CHANNEL_OPEN.length)
        // The channel name ("thought") precedes the first newline.
        const nl = rest.indexOf('\n')
        rest = nl === -1 ? '' : rest.slice(nl + 1)
        inThinking = true
      }
    }
  }
  return { answer: answer.replace(/^\s+/, ''), thinking: thinking.trim(), inThinking }
}

/** Drops a trailing prefix of `marker` (e.g. "<|chan") so half-received special tokens never flash on screen. */
function holdBackPartial(text: string, marker: string): string {
  for (let n = Math.min(marker.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return text.slice(0, -n)
  }
  return text
}

/** Maps engine/runtime errors to codes the UI can act on. */
export function classifyError(err: unknown): { code: GemmaErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return { code: 'quota', message: 'Browser storage is full. Free up space or clear other site data, then retry.' }
  if (/device (was )?lost|GPUDevice|out of memory|OOM/i.test(message)) return { code: 'device-lost', message: 'The GPU stopped responding (often out of memory). Close other tabs and reload the model.' }
  if (/fetch|network|Failed to load|NetworkError|HTTP/i.test(message)) return { code: 'network', message: `Download failed: ${message}. Check your connection and retry; finished files are kept.` }
  return { code: 'unknown', message }
}
