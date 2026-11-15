import { useCallback } from 'react'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { DeviceSummary } from '@/components/edge-ai/shared'
import { useOnline } from '@/components/edge-ai/useOnline'
import type { Capability } from '@/lib/transformers/capability'
import { ORT_RUNTIME_BYTES } from '@/lib/transformers/constants'
import { tts, useTts, type TtsState } from '@/lib/tts/client'
import { DEFAULT_VOICE_BYTES, TTS_MODEL_ID, ttsTotalBytes } from '@/lib/tts/constants'
import { useTtsCapability, type TtsCacheState } from '@/lib/tts/hooks'

interface Props {
  /** Whether the Speak tab is visible (drives auto-load from storage). */
  active: boolean
  /** Becomes true the first time the tab is opened; capability detection only runs from then on. */
  visited: boolean
  cache: TtsCacheState
}

/** Speak tab (Chatterbox text-to-speech). Phase S2: model gate + engine; text input and playback follow in S3. */
export function SpeakTab({ active, visited, cache }: Props) {
  const capability = useTtsCapability(visited, cache.ready)
  const state = useTts()
  const online = useOnline()
  const device = capability?.device
  const dtype = capability?.dtype
  const load = useCallback(() => {
    if (device === 'webgpu' && dtype) tts.load(device, dtype).catch(() => {})
  }, [device, dtype])

  return (
    <>
      <ModelGate source={ttsSource(capability, state, load, online)} active={active} />
      <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        <p>
          {state.status === 'ready'
            ? 'Speak is ready with the default voice. Typing text and playing it back arrives in the next update.'
            : 'Turn text into natural speech, optionally in your own voice — generated entirely on this device.'}
        </p>
      </div>
      <div className="text-xs text-muted-foreground">{capability && <DeviceSummary capability={capability} />}</div>
    </>
  )
}

function ttsSource(capability: Capability | null, state: TtsState, load: () => void, online: boolean): ModelSource {
  const dtype = capability?.dtype ?? 'q4f16'
  const total = capability?.totalBytes || ttsTotalBytes(dtype)
  const base: ModelSource = {
    name: 'Chatterbox',
    blurb: 'Natural English text-to-speech with voice cloning (0.5B). Runs on your GPU via WebGPU.',
    href: `https://huggingface.co/${TTS_MODEL_ID}`,
    sizeBytes: total,
    status: 'checking',
    cached: false,
    downloadBytes: capability?.downloadBytes ?? total,
    origin: 'huggingface.co',
  }
  if (!capability) return base
  if (capability.unsupported) return { ...base, status: 'unsupported', unsupported: capability.unsupported }
  const cached = capability.downloadBytes === 0
  const offline = !online && !cached ? "You're offline. Connect to the internet to download Speak — files that already finished downloading are kept." : undefined
  const source: ModelSource = { ...base, status: 'idle', cached, blocked: offline ?? capability.blocked, load }
  if (state.status === 'ready') return { ...source, status: 'ready', warning: state.warning }
  if (state.status === 'error') return { ...source, status: 'error', error: state.error }
  if (state.status === 'loading') {
    // Progress events cover the model files only (the runtime wasm and default voice are fetched separately), and
    // their total grows as files start; use the known size as a floor so the bar doesn't jump backwards.
    const expected = total - ORT_RUNTIME_BYTES - DEFAULT_VOICE_BYTES
    const p = state.progress
    return { ...source, status: 'loading', progress: p ? { loaded: p.loaded, total: Math.max(p.total, expected), fromCache: cached } : undefined }
  }
  return source
}
