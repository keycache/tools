import { describe, expect, it } from 'vitest'
import { PAUSE_SECONDS, splitInHalf, splitIntoChunks, splitLong, splitSentences } from '@/lib/tts/chunk'
import { MAX_CHUNK_CHARS } from '@/lib/tts/constants'

describe('splitSentences', () => {
  it('splits on . ! ? … and keeps closing quotes', () => {
    expect(splitSentences('Hello there. How are you? "Fine!" she said… Okay')).toEqual(['Hello there.', 'How are you?', '"Fine!"', 'she said…', 'Okay'])
  })

  it('ignores abbreviations, initials and decimals', () => {
    expect(splitSentences('Mr. Smith met Dr. Jones at 3.5 p.m. on Main St. today. J. R. R. Tolkien wrote it, e.g. The Hobbit.')).toEqual([
      'Mr. Smith met Dr. Jones at 3.5 p.m. on Main St. today.',
      'J. R. R. Tolkien wrote it, e.g. The Hobbit.',
    ])
  })
})

describe('splitLong', () => {
  it('prefers clause breaks, then spaces, and never exceeds the limit', () => {
    const s = 'This is a long sentence that keeps going, with a clause break here, and another one later on; then it ends.'
    const parts = splitLong(s, 50)
    expect(parts.every((p) => p.length <= 50)).toBe(true)
    expect(parts[0]).toBe('This is a long sentence that keeps going,')
    expect(parts.join(' ')).toBe(s)
  })

  it('hard-cuts text without spaces', () => {
    expect(splitLong('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  })
})

describe('splitIntoChunks', () => {
  it('returns nothing for empty input', () => {
    expect(splitIntoChunks('  \n\n ')).toEqual([])
  })

  it('merges short sentences, splits paragraphs and marks pauses', () => {
    const text = 'One. Two. Three.\n\nA new paragraph starts here. It has a second sentence.\r\n\r\nLast.'
    expect(splitIntoChunks(text, 40)).toEqual([
      { text: 'One. Two. Three.', pause: 'paragraph' },
      { text: 'A new paragraph starts here.', pause: 'paragraph' },
      { text: 'It has a second sentence.', pause: 'sentence' },
      { text: 'Last.', pause: 'paragraph' },
    ])
  })

  it('keeps every chunk within the limit and loses no words', () => {
    const para = 'The city had been empty for years, and rain fell on cracked pavement while weeds grew through the sidewalks and silence filled every room of every building on every street. '
    const text = `${para.repeat(3)}\n\n${'Short one. '.repeat(30)}`
    const chunks = splitIntoChunks(text)
    expect(chunks.every((c) => c.text.length <= MAX_CHUNK_CHARS)).toBe(true)
    expect(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim())
  })

  it('collapses whitespace inside paragraphs', () => {
    expect(splitIntoChunks('Line one\nline two.')).toEqual([{ text: 'Line one line two.', pause: 'paragraph' }])
  })

  it('has longer paragraph pauses than sentence pauses', () => {
    expect(PAUSE_SECONDS.paragraph).toBeGreaterThan(PAUSE_SECONDS.sentence)
  })
})

describe('splitInHalf', () => {
  it('uses a clause break near the middle', () => {
    expect(splitInHalf('The fox ran over the hill, and the dog followed it home.')).toEqual(['The fox ran over the hill,', 'and the dog followed it home.'])
  })

  it('falls back to the space closest to the middle', () => {
    expect(splitInHalf('aa bb cc dd')).toEqual(['aa bb', 'cc dd'])
  })

  it('returns null when there is nowhere to split', () => {
    expect(splitInHalf('word')).toBeNull()
  })
})
