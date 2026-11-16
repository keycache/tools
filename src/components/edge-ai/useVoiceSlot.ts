import { useEffect, useRef, useState } from 'react'
import type { CapturedAudio } from '@/components/edge-ai/useAudioCapture'
import type { ReferenceClip } from '@/components/edge-ai/VoiceSelect'
import { encodeWav } from '@/lib/cactus/media'
import { isSilent, trimTo } from '@/lib/tts/audio'
import { TtsError, tts } from '@/lib/tts/client'
import { DEFAULT_VOICE_ID, MAX_REFERENCE_SECONDS, SAMPLE_RATE } from '@/lib/tts/constants'
import { CUSTOM_VOICE, builtinVoice, builtinVoiceKey, builtinVoiceUrl, loadVoiceChoice, saveVoiceChoice, type VoiceChoice } from '@/lib/tts/voices'

/** The user's reference voice: PCM kept so it can be re-encoded if the worker restarts (e.g. after GPU loss). */
interface CustomVoice {
  id: string
  pcm: Float32Array
  clip: ReferenceClip
  encoded: boolean
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The worker takes one job at a time, so every slot's encodes run through one queue. */
let encodeQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = encodeQueue.then(job, job)
  encodeQueue = next
  return next
}

export interface VoiceSlot {
  choice: VoiceChoice
  changeChoice: (choice: VoiceChoice) => void
  clip: ReferenceClip | null
  addVoice: (audio: CapturedAudio) => void
  removeVoice: () => void
  status: 'idle' | 'preparing' | 'ready'
  error: string | null
  preparing: boolean
  /** False while "Your voice…" is chosen without a clip. */
  usable: boolean
  /** "default voice", "your voice" or e.g. "Female · Scottish voice". */
  label: string
  /** Worker voice id for the choice, preparing it first if needed (`force` re-encodes a custom clip); null on failure. */
  ensure: (force?: boolean) => Promise<string | null>
}

interface Options {
  /** Slot name for ids and `localStorage` (e.g. 'single', 's2'). */
  name: string
  storageKey: string
  fallback: VoiceChoice
  /** The model is loaded. */
  ready: boolean
  /** The slot is in use (shown): its built-in voice is prepared eagerly. */
  active: boolean
  announce: (message: string) => void
}

/**
 * One voice choice — the model's default, a built-in voice or the user's own clip — and getting it into the worker.
 * Single mode has one slot; conversation mode one per speaker. docs/SPECIFICATIONS.md §S18, §S20.
 */
export function useVoiceSlot({ name, storageKey, fallback, ready, active, announce }: Options): VoiceSlot {
  const [choice, setChoice] = useState<VoiceChoice>(() => loadVoiceChoice(globalThis.localStorage, storageKey, fallback))
  /** Built-in voice the worker has encoded (for the "Voice ready" note; Speak still re-checks with the worker). */
  const [builtinReady, setBuiltinReady] = useState<string | null>(null)
  const choiceRef = useRef(choice)
  useEffect(() => {
    choiceRef.current = choice
  }, [choice])
  const [voice, setVoice] = useState<CustomVoice | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voiceSeq = useRef(0)
  /** Latest clip for async callbacks (an encode may finish after the clip was replaced or removed). */
  const voiceRef = useRef<CustomVoice | null>(null)
  useEffect(() => {
    voiceRef.current = voice
  }, [voice])
  useEffect(() => {
    if (!voice) return
    return () => URL.revokeObjectURL(voice.clip.url)
  }, [voice])

  const custom = choice === CUSTOM_VOICE

  /** Encodes `v` in the worker (speaker cache keyed by id). Returns false if it failed or the clip was replaced. */
  function prepareVoice(v: CustomVoice): Promise<boolean> {
    return enqueue(async () => {
      if (voiceRef.current?.id !== v.id) return false
      setPreparing(true)
      setError(null)
      try {
        // The PCM buffer is transferred to the worker, so send a copy and keep ours for re-encoding.
        await tts.encodeVoice(v.id, v.pcm.slice())
        if (voiceRef.current?.id !== v.id) return false
        const encoded = { ...v, encoded: true }
        voiceRef.current = encoded
        setVoice(encoded)
        return true
      } catch (err) {
        if (voiceRef.current?.id === v.id) setError(`Couldn't prepare this voice: ${errorText(err)}`)
        return false
      } finally {
        setPreparing(false)
      }
    })
  }

  /**
   * Makes built-in voice `id` available in the worker (fetched and stored on first use, then encoded once per worker).
   * On failure it shows why and falls back to the default voice. `eager` prepares are skipped once another voice is
   * chosen (arrowing through the dropdown queues one per option).
   */
  function prepareBuiltin(id: string, eager = false): Promise<boolean> {
    const v = builtinVoice(id)
    if (!v) return Promise.resolve(false)
    return enqueue(async () => {
      if (eager && choiceRef.current !== id) return false
      setPreparing(true)
      try {
        await tts.encodeBuiltin(builtinVoiceKey(id), builtinVoiceUrl(v))
        setBuiltinReady(id)
        return true
      } catch (err) {
        setChoice((c) => (c === id ? DEFAULT_VOICE_ID : c))
        const why =
          err instanceof TtsError && err.code === 'network'
            ? `it downloads (${Math.round(v.bytes / 1000)} KB) the first time it's used — check your connection`
            : errorText(err).replace(/\.$/, '')
        setError(`Couldn't load the ${v.label} voice: ${why}. Using the default voice.`)
        return false
      } finally {
        setPreparing(false)
      }
    })
  }

  // Prepare the chosen built-in voice as soon as the model is ready, so Speak starts without the extra step.
  useEffect(() => {
    if (ready && active && builtinVoice(choice) && builtinReady !== choice) void prepareBuiltin(choice, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, active, choice])

  const builtin = builtinVoice(choice)
  return {
    choice,
    changeChoice(next) {
      setChoice(next)
      saveVoiceChoice(next, globalThis.localStorage, storageKey)
      setError(null)
    },
    clip: voice?.clip ?? null,
    addVoice(audio) {
      URL.revokeObjectURL(audio.url)
      if (isSilent(audio.pcm)) {
        setError('This clip is silent — check the microphone or pick another file.')
        return
      }
      const trimmed = audio.seconds > MAX_REFERENCE_SECONDS
      const pcm = trimTo(audio.pcm, SAMPLE_RATE, MAX_REFERENCE_SECONDS).slice()
      const v: CustomVoice = {
        id: `voice-${name}-${++voiceSeq.current}`,
        pcm,
        clip: { url: URL.createObjectURL(encodeWav(pcm, SAMPLE_RATE)), name: audio.name, seconds: pcm.length / SAMPLE_RATE, trimmed },
        encoded: false,
      }
      setError(null)
      setVoice(v)
      voiceRef.current = v
      announce(`Voice clip added, ${v.clip.seconds.toFixed(1)} seconds${trimmed ? `, first ${MAX_REFERENCE_SECONDS} seconds used` : ''}.`)
      if (ready) void prepareVoice(v)
    },
    removeVoice() {
      setVoice(null)
      voiceRef.current = null
      setError(null)
    },
    status: preparing ? 'preparing' : custom ? (voice?.encoded ? 'ready' : 'idle') : builtin && builtinReady === choice && ready ? 'ready' : 'idle',
    error,
    preparing,
    usable: !custom || !!voice,
    label: custom ? 'your voice' : builtin ? `${builtin.label} voice` : 'default voice',
    async ensure(force = false) {
      if (custom) {
        const v = voiceRef.current
        if (!v) return null
        if ((force || !v.encoded) && !(await prepareVoice(v))) return null
        return v.id
      }
      if (builtin) return (await prepareBuiltin(choice)) ? builtinVoiceKey(choice) : null
      return DEFAULT_VOICE_ID
    },
  }
}
