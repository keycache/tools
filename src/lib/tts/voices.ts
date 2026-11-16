/**
 * Speak's built-in reference voices (docs/SPECIFICATIONS.md §S17–S18). The manifest is bundled with the app so the
 * list works offline without a loading state; the clips are site assets in `public/voices/`, fetched by the worker
 * on first use and stored in Speak's OPFS cache.
 */
import manifest from './voices.json'
import { DEFAULT_VOICE_ID, DEFAULT_VOICE_URL } from './constants'

export interface BuiltinVoice {
  id: string
  /** Shown in the dropdown, e.g. "Female · Scottish". */
  label: string
  gender: 'female' | 'male'
  accent: string
  pitch: 'low' | 'mid' | 'high'
  age?: number
  description: string
  file: string
  seconds: number
  bytes: number
  /** First 16 hex chars of the clip's SHA-256; versions the clip URL so a replaced clip isn't served from storage. */
  sha256: string
  source: { dataset: string; speaker: string; utterances: string[] }
  licence: string
}

export const BUILTIN_VOICES = manifest as BuiltinVoice[]

/** The dropdown's choice: the model's default voice, a built-in voice id, or the user's own clip. */
export type VoiceChoice = string
export const CUSTOM_VOICE: VoiceChoice = 'custom'

/** What the dropdown shows for the model's own sample voice (encoded at load as `default`). */
export const DEFAULT_VOICE_INFO = { label: 'Default', description: "Chatterbox's sample voice", seconds: 7.44 } as const

export function builtinVoice(id: string): BuiltinVoice | undefined {
  return BUILTIN_VOICES.find((v) => v.id === id)
}

/** Speaker-cache id in the worker. */
export function builtinVoiceKey(id: string): string {
  return `builtin:${id}`
}

/** Absolute URL of a built-in clip (the worker needs an absolute URL; also the OPFS cache key). */
export function builtinVoiceUrl(v: BuiltinVoice, base = import.meta.env.BASE_URL, origin = globalThis.location?.href ?? 'http://localhost/'): string {
  return new URL(`${base}voices/${v.file}?v=${v.sha256}`, origin).href
}

/** True for a stored built-in clip URL that no longer matches the manifest (an older version or a removed voice). */
export function isStaleVoiceUrl(url: string, current: readonly string[]): boolean {
  return /\/voices\/[^/]+\.wav\?v=/.test(url) && !current.includes(url)
}

/** Preview audio for a choice; null for the custom voice (its own player shows the clip). */
export function voicePreviewUrl(choice: VoiceChoice): string | null {
  if (choice === DEFAULT_VOICE_ID) return DEFAULT_VOICE_URL
  const v = builtinVoice(choice)
  return v ? builtinVoiceUrl(v) : null
}

/** Remembered dropdown choice (built-in or default only — uploaded audio is never stored). */
export const VOICE_STORAGE_KEY = 'edge-ai-speak:voice'

export function loadVoiceChoice(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): VoiceChoice {
  try {
    const id = storage?.getItem(VOICE_STORAGE_KEY)
    return id && builtinVoice(id) ? id : DEFAULT_VOICE_ID
  } catch {
    return DEFAULT_VOICE_ID
  }
}

export function saveVoiceChoice(choice: VoiceChoice, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (builtinVoice(choice)) storage?.setItem(VOICE_STORAGE_KEY, choice)
    else if (choice === DEFAULT_VOICE_ID) storage?.removeItem(VOICE_STORAGE_KEY)
  } catch {
    // Private mode / storage disabled: the choice just isn't remembered.
  }
}
