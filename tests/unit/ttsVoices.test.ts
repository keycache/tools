// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWav } from '@/lib/tts/audio'
import { DEFAULT_VOICE_ID, MAX_REFERENCE_SECONDS, SAMPLE_RATE } from '@/lib/tts/constants'
import { BUILTIN_VOICES, VOICE_STORAGE_KEY, builtinVoiceUrl, isStaleVoiceUrl, loadVoiceChoice, saveVoiceChoice } from '@/lib/tts/voices'

// Built-in voices (Phase S9/S10, docs/SPECIFICATIONS.md §S17–S18): the bundled manifest must match the shipped clips.
const dir = 'public/voices'
const voices = BUILTIN_VOICES

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
    expect(createHash('sha256').update(buf).digest('hex').slice(0, 16)).toBe(v.sha256)
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

describe('built-in voice helpers', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
  }

  it('remembers a built-in choice, forgets it for the default, and never stores the custom voice', () => {
    const s = memory()
    saveVoiceChoice(voices[0].id, s)
    expect(loadVoiceChoice(s)).toBe(voices[0].id)
    saveVoiceChoice('custom', s)
    expect(loadVoiceChoice(s)).toBe(voices[0].id)
    saveVoiceChoice(DEFAULT_VOICE_ID, s)
    expect(s.m.has(VOICE_STORAGE_KEY)).toBe(false)
    expect(loadVoiceChoice(s)).toBe(DEFAULT_VOICE_ID)
  })

  it('falls back to the default for a removed voice or unavailable storage', () => {
    const s = memory()
    s.setItem(VOICE_STORAGE_KEY, 'f-klingon-1')
    expect(loadVoiceChoice(s)).toBe(DEFAULT_VOICE_ID)
    expect(loadVoiceChoice({ getItem: () => { throw new Error('denied') } })).toBe(DEFAULT_VOICE_ID)
  })

  it('versions clip URLs by content and flags outdated stored clips', () => {
    const url = builtinVoiceUrl(voices[0], '/tools/', 'https://example.org/tools/#/edge-ai-studio')
    expect(url).toBe(`https://example.org/tools/voices/${voices[0].file}?v=${voices[0].sha256}`)
    const current = [url]
    expect(isStaleVoiceUrl(url, current)).toBe(false)
    expect(isStaleVoiceUrl(url.replace(/v=\w+/, 'v=0000'), current)).toBe(true)
    expect(isStaleVoiceUrl('https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/x/default_voice.wav', current)).toBe(false)
  })
})
