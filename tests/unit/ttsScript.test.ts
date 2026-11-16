import { describe, expect, it } from 'vitest'
import { PAUSE_SECONDS, splitIntoChunks } from '@/lib/tts/chunk'
import { SECONDS_PER_CHAR, TURN_GAP_SECONDS, formatDuration, hasErrors, lineFileName, parseScript, planChunks } from '@/lib/tts/script'

const conv = (text: string) => parseScript(text, { mode: 'conversation' })
const single = (text: string) => parseScript(text, { mode: 'single' })
const brief = (s: ReturnType<typeof parseScript>) => s.turns.map((t) => [t.speaker, t.text, t.exaggeration, t.pauseBefore, t.line])
const messages = (s: ReturnType<typeof parseScript>) => s.diagnostics.map((d) => `${d.line} ${d.severity}: ${d.message}`)

describe('parseScript — conversation', () => {
  it('parses the documented example', () => {
    const s = conv(`[S1] Hi, did you hear the news?
[S2] [exaggeration 0.8] No! Tell me everything.
[pause 1.5s]
[S1] Well… it's a long story. [pause 500ms] A very long one.`)
    expect(brief(s)).toEqual([
      [1, 'Hi, did you hear the news?', undefined, undefined, 1],
      [2, 'No! Tell me everything.', 0.8, undefined, 2],
      [1, "Well… it's a long story.", undefined, 1.5, 4],
      [1, 'A very long one.', undefined, 0.5, 4],
    ])
    expect(s.speakers).toEqual([1, 2])
    expect(s.diagnostics).toEqual([])
  })

  it('accepts inline tags, any case and loose whitespace; speakers in order of appearance', () => {
    const s = conv('[ s3 ] One. [S1]Two.\n[PAUSE 2 S][s3] [Exaggeration .25] Three.')
    expect(brief(s)).toEqual([
      [3, 'One.', undefined, undefined, 1],
      [1, 'Two.', undefined, undefined, 1],
      [3, 'Three.', 0.25, 2, 2],
    ])
    expect(s.speakers).toEqual([3, 1])
  })

  it('keeps multi-line turns together (paragraphs stay inside the turn)', () => {
    expect(brief(conv('[S1] First line\nsecond line.\n\nNew paragraph.\n[S2] Reply.'))).toEqual([
      [1, 'First line\nsecond line.\n\nNew paragraph.', undefined, undefined, 1],
      [2, 'Reply.', undefined, undefined, 5],
    ])
  })

  it('reports errors for bad speakers and out-of-range or unparsable values', () => {
    const s = conv('[S5] a\n[S0] b\n[S1] [pause 20s] c [pause soon] d\n[exaggeration high] [exaggeration 2] e')
    expect(messages(s)).toEqual([
      '1 error: [S5] — up to 4 speakers ([S1]–[S4])',
      '2 error: [S0] — up to 4 speakers ([S1]–[S4])',
      '3 error: [pause 20s] — a pause is 0–10 s, e.g. [pause 1.5s] or [pause 500ms]',
      '3 error: [pause soon] — a pause is 0–10 s, e.g. [pause 1.5s] or [pause 500ms]',
      '4 error: [exaggeration high] — exaggeration is a number from 0 to 1.5, e.g. [exaggeration 0.8]',
      '4 error: [exaggeration 2] — exaggeration is a number from 0 to 1.5, e.g. [exaggeration 0.8]',
      '1 warning: Text before the first speaker tag is spoken by Speaker 1',
    ].sort((a, b) => parseInt(a) - parseInt(b)))
    expect(hasErrors(s)).toBe(true)
  })

  it('reads unknown markers aloud with a warning', () => {
    const s = conv('[S1] That is funny [laughs] really.')
    expect(s.turns[0].text).toBe('That is funny [laughs] really.')
    expect(messages(s)).toEqual(["1 warning: [laughs] isn't a marker — it will be read aloud"])
    expect(hasErrors(s)).toBe(false)
  })

  it('gives text before the first tag to Speaker 1, with a warning', () => {
    const s = conv('Intro text.\n[S2] Hello.')
    expect(brief(s)).toEqual([
      [1, 'Intro text.', undefined, undefined, 1],
      [2, 'Hello.', undefined, undefined, 2],
    ])
    expect(messages(s)).toEqual(['1 warning: Text before the first speaker tag is spoken by Speaker 1'])
  })

  it('drops empty turns but keeps their pause; adds consecutive pauses; ignores leading / trailing pauses', () => {
    const s = conv('[pause 1s][S1] A.\n[S2] [pause 1s]\n[S1][pause 250ms] B. [pause 2s]')
    expect(brief(s)).toEqual([
      [1, 'A.', undefined, undefined, 1],
      [1, 'B.', undefined, 1.25, 3],
    ])
    expect(s.speakers).toEqual([1])
    expect(messages(s)).toEqual(['1 hint: A pause before the first words has no effect', '3 hint: A pause after the last words has no effect'])
  })

  it('warns about two different exaggeration markers in one turn and uses the last', () => {
    const s = conv('[S1] [exaggeration 0.3] Hi [exaggeration 0.9] there.')
    expect(s.turns[0].exaggeration).toBe(0.9)
    expect(messages(s)).toEqual(['1 warning: Two exaggeration markers in one turn — using 0.9'])
  })

  it('summarises speakers, turns and an audio estimate', () => {
    const s = conv('[S1] Hello there.\n[S2] Hi.\n[S1] Bye. [pause 2s] Really.')
    const chars = 'Hello there.'.length + 'Hi.'.length + 'Bye.'.length + 'Really.'.length
    expect(s.summary).toEqual({ speakers: 2, turns: 4, chars, estSeconds: chars * SECONDS_PER_CHAR + 2 * TURN_GAP_SECONDS + 2 })
  })
})

describe('parseScript — single mode', () => {
  it('ignores speaker tags with one hint, scopes exaggeration to the line, splits at pauses', () => {
    const s = single('[S1] Hello there.\n[S2] [exaggeration 1.2] Wow! [pause 1s] Amazing.\nPlain line.')
    expect(brief(s)).toEqual([
      [1, 'Hello there.', undefined, undefined, 1],
      [1, 'Wow!', 1.2, undefined, 2],
      [1, 'Amazing.', 1.2, 1, 2],
      [1, 'Plain line.', undefined, undefined, 3],
    ])
    expect(messages(s)).toEqual(["1 hint: [S1] — speaker tags only apply in Conversation mode, so they're ignored here"])
    expect(s.speakers).toEqual([1])
  })

  it('marks lines after a blank line as paragraphs', () => {
    expect(single('One.\n\n\nTwo.\nThree.').turns.map((t) => t.paragraph)).toEqual([false, true, false])
  })
})

describe('planChunks', () => {
  const texts = [
    'Hello there. How are you today?',
    'First paragraph has two sentences. Here is the second one.\n\nSecond paragraph.\nIt continues on the next line.',
    `${'A long sentence that goes on and on, '.repeat(6)}until it ends.\n\n\nAfter several blank lines.`,
  ]

  it.each(texts)('chunks marker-free text exactly like splitIntoChunks (%#)', (text) => {
    const expected = splitIntoChunks(text).map((c, i) => ({ text: c.text, pause: i === 0 ? 0 : PAUSE_SECONDS[c.pause] }))
    expect(planChunks(single(text), 0.5).map(({ text, pause }) => ({ text, pause }))).toEqual(expected)
  })

  it('uses speaker-change, same-speaker and [pause] gaps, and per-turn / per-speaker exaggeration', () => {
    const s = conv('[S1] One. [S2] Two. [S2] Three. [pause 3s] [S1] [exaggeration 1.1] Four.')
    expect(planChunks(s, (n) => (n === 1 ? 0.4 : 0.6))).toEqual([
      { text: 'One.', speaker: 1, exaggeration: 0.4, pause: 0, turn: 0, line: 0 },
      { text: 'Two.', speaker: 2, exaggeration: 0.6, pause: TURN_GAP_SECONDS, turn: 1, line: 1 },
      { text: 'Three.', speaker: 2, exaggeration: 0.6, pause: PAUSE_SECONDS.paragraph, turn: 2, line: 2 },
      { text: 'Four.', speaker: 1, exaggeration: 1.1, pause: 3, turn: 3, line: 3 },
    ])
  })

  it('keeps lines with different settings apart in single mode', () => {
    const s = single('Calm line.\n[exaggeration 1.3] Excited line!\nCalm again.')
    expect(planChunks(s, 0.5).map((c) => [c.text, c.exaggeration, c.pause])).toEqual([
      ['Calm line.', 0.5, 0],
      ['Excited line!', 1.3, PAUSE_SECONDS.sentence],
      ['Calm again.', 0.5, PAUSE_SECONDS.sentence],
    ])
  })

  it('splits long turns into ≤ maxChars chunks with sentence pauses inside the turn', () => {
    const s = conv(`[S1] ${'Sentence number one is here. '.repeat(3)}[S2] Short.`)
    const chunks = planChunks(s, 0.5, 40)
    expect(chunks.every((c) => c.text.length <= 40)).toBe(true)
    expect(chunks.filter((c) => c.speaker === 1).slice(1).every((c) => c.pause === PAUSE_SECONDS.sentence)).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ text: 'Short.', pause: TURN_GAP_SECONDS })
  })
})

describe('zip lines', () => {
  it('one line per turn in conversation, even when a turn has several chunks or paragraphs', () => {
    const s = conv(`[S1] ${'A sentence that is fairly long. '.repeat(3)}\n\nSecond paragraph. [S2] Reply. [pause 1s] After the pause.`)
    const chunks = planChunks(s, 0.5, 40)
    expect(chunks.filter((c) => c.speaker === 1).every((c) => c.line === 0)).toBe(true)
    expect(chunks.filter((c) => c.speaker === 2).map((c) => [c.text, c.line])).toEqual([
      ['Reply.', 1],
      ['After the pause.', 2],
    ])
  })

  it('one line per paragraph in single mode, across merged lines and marker splits', () => {
    const s = single(`${'Long sentence number one goes here. '.repeat(3)}\nSame paragraph.\n\nNew paragraph. [pause 1s] Split.\n[exaggeration 1] Own line.`)
    expect(planChunks(s, 0.5, 40).map((c) => c.line)).toEqual([0, 0, 0, 0, 1, 2, 3])
  })

  it('names files in order, padded to the line count (at least 3 digits)', () => {
    expect([lineFileName(0, 5, 1), lineFileName(4, 5, 3), lineFileName(0, 5), lineFileName(41, 1200, 2)]).toEqual(['001-S1.wav', '005-S3.wav', '001.wav', '0042-S2.wav'])
  })
})

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect([formatDuration(0.2), formatDuration(42.4), formatDuration(60), formatDuration(100)]).toEqual(['1 s', '42 s', '1 min', '1 min 40 s'])
  })
})
