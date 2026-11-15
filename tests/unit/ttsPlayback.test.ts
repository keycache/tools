import { describe, expect, it } from 'vitest'
import { joinWithPauses } from '@/lib/tts/audio'
import { DEFAULT_RTF, SECONDS_PER_CHAR, measuredRtf, playbackStartDelay, type PlannedChunk } from '@/lib/tts/playback'

const done = (seconds: number, readyAt: number, genSeconds = seconds * 1.5): PlannedChunk => ({ pause: 0.15, chars: 0, done: { seconds, readyAt, genSeconds } })
const todo = (seconds: number, pause = 0.15): PlannedChunk => ({ pause, chars: seconds / SECONDS_PER_CHAR })

/** Simulates playback from `delay`: true if every chunk is ready when playback reaches it. */
function noStall(chunks: { seconds: number; ready: number; pause: number }[], delay: number): boolean {
  let at = delay
  return chunks.every((c, i) => {
    if (i > 0) at += c.pause
    const ok = c.ready <= at + 1e-9
    at = Math.max(at, c.ready) + c.seconds
    return ok
  })
}

describe('playbackStartDelay', () => {
  it('plays a single chunk as soon as it is ready', () => {
    expect(playbackStartDelay([done(4, 6)])).toBe(6)
  })

  it('waits long enough that later chunks are never late (rtf 1.5)', () => {
    const plan = [done(4, 6, 6), todo(4), todo(4), todo(4)]
    const delay = playbackStartDelay(plan, 0)
    // Chunks are generated one after another at rtf 1.5: ready at 6, 12, 18, 24.
    const sim = [0, 1, 2, 3].map((i) => ({ seconds: 4, ready: 6 * (i + 1), pause: i ? 0.15 : 0 }))
    expect(noStall(sim, delay)).toBe(true)
    expect(noStall(sim, delay - 0.5)).toBe(false)
    expect(delay).toBeCloseTo(24 - 3 * 4 - 3 * 0.15, 6)
  })

  it('starts with the first chunk when generation is faster than playback', () => {
    expect(playbackStartDelay([done(4, 2, 2), todo(4), todo(4)], 0)).toBe(2)
  })

  it('uses the default rtf before anything is measured and adds the margin for several chunks', () => {
    const a = playbackStartDelay([todo(4, 0), todo(4)], 0)
    expect(a).toBeCloseTo(DEFAULT_RTF * 8 - 4 - 0.15, 6)
    expect(playbackStartDelay([todo(4, 0), todo(4)])).toBeCloseTo(a + 0.5, 6)
  })

  it('measures rtf from finished chunks', () => {
    expect(measuredRtf([done(2, 4, 4), done(2, 6, 2), todo(3)])).toBe(1.5)
    expect(measuredRtf([todo(3)])).toBe(DEFAULT_RTF)
  })
})

describe('joinWithPauses', () => {
  it('inserts silence between parts but not before the first', () => {
    const out = joinWithPauses(
      [
        { pcm: new Float32Array([1, 1]), pauseBefore: 5 },
        { pcm: new Float32Array([2]), pauseBefore: 1 },
        { pcm: new Float32Array([3]), pauseBefore: 0.5 },
      ],
      2,
    )
    expect([...out]).toEqual([1, 1, 0, 0, 2, 0, 3])
  })
})
