import { describe, expect, it } from 'vitest'
import { joinWithPauses, toPcm16, wavFromParts } from '@/lib/tts/audio'
import { encodeWav } from '@/lib/cactus/media'
import { DEFAULT_RTF, MAX_START_WAIT_SECONDS, SECONDS_PER_CHAR, measuredRtf, playbackStartAt, playbackStartDelay, type PlannedChunk } from '@/lib/tts/playback'

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

describe('playbackStartAt (S8 start cap)', () => {
  it('caps the wait for long texts', () => {
    // ~120 parts of ~5.5 s each at rtf 1.8: gap-free would start after ~9 minutes.
    const plan = [done(5.5, 9.9, 9.9), ...Array.from({ length: 119 }, () => todo(5.5))]
    expect(playbackStartDelay(plan)).toBeGreaterThan(500)
    expect(playbackStartAt(plan)).toBe(MAX_START_WAIT_SECONDS)
  })

  it('keeps the gap-free start when it is earlier', () => {
    const plan = [done(4, 6, 6), todo(4)]
    expect(playbackStartAt(plan)).toBeCloseTo(playbackStartDelay(plan), 9)
    expect(playbackStartAt(plan)).toBeLessThan(MAX_START_WAIT_SECONDS)
  })

  it('never starts before the first part is ready', () => {
    const plan = [done(8, 26, 26), ...Array.from({ length: 40 }, () => todo(8))]
    expect(playbackStartAt(plan)).toBe(26)
  })
})

describe('wavFromParts (S8 memory)', () => {
  it('is byte-identical to encodeWav(joinWithPauses(...))', async () => {
    const a = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
    const b = new Float32Array([0.1, -0.9, 0.3])
    const c = new Float32Array([-0.2])
    const floats = [
      { pcm: a, pauseBefore: 0.3 },
      { pcm: b, pauseBefore: 0.5 },
      { pcm: c, pauseBefore: 0.5 },
    ]
    const expected = new Uint8Array(await encodeWav(joinWithPauses(floats, 4), 4).arrayBuffer())
    const actual = new Uint8Array(await wavFromParts(floats.map((f) => ({ pcm16: toPcm16(f.pcm), pauseBefore: f.pauseBefore })), 4).arrayBuffer())
    expect(actual).toEqual(expected)
  })

  it('stores half the bytes of Float32', () => {
    expect(toPcm16(new Float32Array(1000)).byteLength).toBe(2000)
  })
})
