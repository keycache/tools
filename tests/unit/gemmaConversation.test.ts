import { describe, expect, it } from 'vitest'
import { IMAGE_TOKENS, classifyError, collectImages, parseOutput, toTemplateMessages, trimTurns } from '@/lib/gemma/conversation'
import type { ChatTurn } from '@/lib/gemma/protocol'

const words = (t: string) => t.split(/\s+/).filter(Boolean).length
const u = (text: string): ChatTurn => ({ role: 'user', text })
const a = (text: string): ChatTurn => ({ role: 'assistant', text })
const a_ = a

describe('toTemplateMessages', () => {
  it('maps user turns to content parts and assistant turns to strings', () => {
    expect(toTemplateMessages([u('hi'), a('hello')])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: 'hello' },
    ])
  })
})

describe('images', () => {
  const img = (name: string) => new Blob([name], { type: 'image/png' })

  it('puts image placeholders before the text', () => {
    expect(toTemplateMessages([{ role: 'user', text: 'what is this?', images: [img('a'), img('b')] }])).toEqual([
      { role: 'user', content: [{ type: 'image' }, { type: 'image' }, { type: 'text', text: 'what is this?' }] },
    ])
  })

  it('collects images across turns in prompt order', async () => {
    const [a, b, c] = [img('a'), img('b'), img('c')]
    const turns: ChatTurn[] = [{ role: 'user', text: '1', images: [a] }, a_('ok'), { role: 'user', text: '2', images: [b, c] }]
    expect(collectImages(turns)).toEqual([a, b, c])
  })

  it('counts image tokens when trimming and drops images with their turn', () => {
    const turns: ChatTurn[] = [{ role: 'user', text: 'x', images: [img('a')] }, a_('y'), u('z')]
    const roomy = trimTurns(turns, words, IMAGE_TOKENS + 100)
    expect(collectImages(roomy.kept)).toHaveLength(1)
    const tight = trimTurns(turns, words, IMAGE_TOKENS - 1)
    expect(tight.kept).toEqual([u('z')])
    expect(collectImages(tight.kept)).toHaveLength(0)
  })
})

describe('trimTurns', () => {
  it('keeps everything that fits', () => {
    const turns = [u('one two'), a('three'), u('four')]
    expect(trimTurns(turns, words, 1000)).toEqual({ kept: turns, dropped: 0 })
  })

  it('drops the oldest turns first and starts on a user turn', () => {
    const turns = [u('a a a a a a a a a a'), a('b b b b b b b b b b'), u('c c'), a('d d'), u('e')]
    // costs incl. 6 overhead: 16, 16, 8, 8, 7 → budget 25 fits e+d+c (23)
    const { kept, dropped } = trimTurns(turns, words, 25)
    expect(kept.map((t) => t.text)).toEqual(['c c', 'd d', 'e'])
    expect(dropped).toBe(2)
  })

  it("doesn't start the history on an assistant turn", () => {
    const turns = [u('x x x x x x x x x x'), a('y'), u('z')]
    // budget fits z (7) + y (7) but not x → would start on assistant; must advance to the user turn
    const { kept } = trimTurns(turns, words, 15)
    expect(kept).toEqual([u('z')])
  })

  it('always keeps the latest turn, even if it alone exceeds the budget', () => {
    const turns = [u('old'), a('reply'), u('w '.repeat(50))]
    expect(trimTurns(turns, words, 10).kept).toEqual([turns[2]])
  })

  it('handles an empty conversation', () => {
    expect(trimTurns([], words, 10)).toEqual({ kept: [], dropped: 0 })
  })
})

describe('parseOutput', () => {
  it('passes plain answers through and strips end-of-turn tokens', () => {
    expect(parseOutput('Paris is the capital.<turn|>')).toEqual({ answer: 'Paris is the capital.', thinking: '', inThinking: false })
  })

  it('separates the thinking channel from the answer', () => {
    const raw = '<|channel>thought\nThe user wants X.\nSo Y.<channel|>The answer is Y.<turn|><eos>'
    expect(parseOutput(raw)).toEqual({ answer: 'The answer is Y.', thinking: 'The user wants X.\nSo Y.', inThinking: false })
  })

  it('reports an open thinking channel while streaming', () => {
    expect(parseOutput('<|channel>thought\nWorking on')).toEqual({ answer: '', thinking: 'Working on', inThinking: true })
  })

  it('holds back a half-received marker instead of showing it', () => {
    expect(parseOutput('Hello <|chan').answer).toBe('Hello ')
    expect(parseOutput('<|channel>thought\nhmm <chan').thinking).toBe('hmm')
  })

  it('handles an empty thought channel when thinking is off', () => {
    expect(parseOutput('<|channel>thought\n<channel|>Hi!')).toEqual({ answer: 'Hi!', thinking: '', inThinking: false })
  })
})

describe('classifyError', () => {
  it('maps common failures to actionable codes', () => {
    expect(classifyError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })).code).toBe('quota')
    expect(classifyError(new Error('GPUDevice was lost: out of memory')).code).toBe('device-lost')
    expect(classifyError(new Error('Failed to fetch')).code).toBe('network')
    expect(classifyError('weird').code).toBe('unknown')
  })
})
