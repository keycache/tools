import type { ChatTurn, GemmaErrorCode } from './protocol'

/** Gemma 4 chat-template message (what `processor.apply_chat_template` expects). */
export type TemplateMessage =
  | { role: 'user'; content: ({ type: 'image' } | { type: 'text'; text: string })[] }
  | { role: 'assistant'; content: string }

/**
 * Images go before the text (the model card's order). The processor later replaces each image placeholder, in
 * order, with that image's soft tokens — so images must be passed to it in the same order (see `collectImages`).
 */
export function toTemplateMessages(turns: ChatTurn[]): TemplateMessage[] {
  return turns.map((t) =>
    t.role === 'user'
      ? { role: 'user', content: [...(t.images ?? []).map(() => ({ type: 'image' as const })), { type: 'text' as const, text: t.text }] }
      : { role: 'assistant', content: t.text },
  )
}

/** All images of the given turns, in prompt order. */
export function collectImages(turns: ChatTurn[]): Blob[] {
  return turns.flatMap((t) => (t.role === 'user' ? (t.images ?? []) : []))
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
    const cost = countTokens(turns[i].text) + TURN_OVERHEAD_TOKENS + (turns[i].images?.length ?? 0) * IMAGE_TOKENS
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
