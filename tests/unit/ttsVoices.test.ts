// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWav } from '@/lib/tts/audio'
import { MAX_REFERENCE_SECONDS, SAMPLE_RATE } from '@/lib/tts/constants'

// Built-in voices (Phase S9, docs/SPECIFICATIONS.md §S17.3): the manifest must match the shipped clips.
interface VoiceEntry {
  id: string
  label: string
  gender: 'female' | 'male'
  accent: string
  pitch: 'low' | 'mid' | 'high'
  age?: number
  description: string
  file: string
  seconds: number
  bytes: number
  source: { dataset: string; speaker: string; utterances: string[] }
  licence: string
}

const dir = 'public/voices'
const voices = JSON.parse(readFileSync(`${dir}/voices.json`, 'utf8')) as VoiceEntry[]

describe('built-in voices manifest', () => {
  it('lists 8–10 distinct, URL-safe voices of both genders, not the model default', () => {
    expect(voices.length).toBeGreaterThanOrEqual(8)
    expect(voices.length).toBeLessThanOrEqual(10)
    const ids = voices.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
    expect(ids).not.toContain('default')
    expect(new Set(voices.map((v) => v.gender))).toEqual(new Set(['female', 'male']))
  })

  it('ships exactly the listed clips', () => {
    const wavs = readdirSync(dir).filter((f) => f.endsWith('.wav')).sort()
    expect(wavs).toEqual(voices.map((v) => v.file).sort())
  })

  it.each(voices.map((v) => [v.id, v] as const))('%s: 24 kHz mono 16-bit clip matching its entry', (_, v) => {
    const buf = readFileSync(`${dir}/${v.file}`)
    expect(buf.byteLength).toBe(v.bytes)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    expect(new DataView(ab).getUint16(34, true)).toBe(16)
    const { pcm, sampleRate } = parseWav(ab)
    expect(sampleRate).toBe(SAMPLE_RATE)
    expect(pcm.length / SAMPLE_RATE).toBeCloseTo(v.seconds, 1)
    // The worker uses at most MAX_REFERENCE_SECONDS of a reference.
    expect(v.seconds).toBeGreaterThanOrEqual(8)
    expect(v.seconds).toBeLessThanOrEqual(MAX_REFERENCE_SECONDS)
    let peak = 0
    for (const x of pcm) peak = Math.max(peak, Math.abs(x))
    expect(peak).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-3)
  })

  it.each(voices.map((v) => [v.id, v] as const))('%s: licensed and attributed', (_, v) => {
    expect(v.licence).toBe('CC BY 4.0')
    expect(['VCTK 0.92', 'LibriTTS-R']).toContain(v.source.dataset)
    expect(v.source.speaker).not.toBe('')
    expect(v.source.utterances.length).toBeGreaterThan(0)
    expect(v.label).toMatch(/^(Female|Male) · /)
    expect(v.description.trim()).not.toBe('')
  })
})
