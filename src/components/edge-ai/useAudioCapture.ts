import { useEffect, useRef, useState } from 'react'
import { SAMPLE_RATE, decodeAudio, isAudioFile, startRecording, type Recorder } from '@/lib/cactus/media'

export interface CapturedAudio {
  pcm: Float32Array
  url: string
  name: string
  seconds: number
}

/**
 * Microphone recording + audio file decoding to 16 kHz PCM. Shared by the record/upload buttons and
 * any drop zone, so a layout can place them in different spots while using one capture state.
 */
export function useAudioCapture(onAudio: (audio: CapturedAudio) => void, disabled = false) {
  const recorder = useRef<Recorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!recording) return
    const start = Date.now()
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 200)
    return () => clearInterval(t)
  }, [recording])

  useEffect(() => () => recorder.current?.cancel(), [])

  async function handleBlob(blob: Blob, name: string) {
    setBusy(true)
    setError(null)
    try {
      const pcm = await decodeAudio(blob)
      if (!pcm.length) throw new Error('The audio is empty')
      onAudio({ pcm, url: URL.createObjectURL(blob), name, seconds: pcm.length / SAMPLE_RATE })
    } catch (err) {
      setError(`Could not read audio: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleRecording() {
    setError(null)
    if (recording) {
      setRecording(false)
      const blob = await recorder.current!.stop()
      recorder.current = null
      await handleBlob(blob, 'Recording')
      return
    }
    try {
      recorder.current = await startRecording()
      setElapsed(0)
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone unavailable: ${String(err)}`)
    }
  }

  function handleFiles(files: FileList | null | undefined) {
    const file = files?.[0]
    if (!file) return
    if (!isAudioFile(file)) {
      setError(`"${file.name}" isn't an audio file. Try .wav, .mp3, .m4a, .ogg, .flac or .webm.`)
      return
    }
    void handleBlob(file, file.name)
  }

  return {
    recording,
    elapsed,
    busy,
    error,
    disabled,
    /** Whether a drop (or new capture) would be accepted right now. */
    canAccept: !disabled && !busy && !recording,
    toggleRecording,
    handleFiles,
  }
}

export type AudioCapture = ReturnType<typeof useAudioCapture>
