import { useState, useRef } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  playAlarmSound,
  playBeepSound,
  playTimerCompleteSound,
  playTimerCompleteSoundLooped,
} from '@/lib/audioSounds'

interface SoundOption {
  id: string
  name: string
  description: string
  play: () => void
}

interface SoundTabProps {
  selectedSound: string
  onSoundChange: (soundId: string) => void
}

export function SoundTab({ selectedSound, onSoundChange }: SoundTabProps) {
  const [playingSound, setPlayingSound] = useState<string | null>(null)
  const soundStopControlRef = useRef<{ stop: () => void } | null>(null)

  const sounds: SoundOption[] = [
    {
      id: 'alarm',
      name: 'Alarm (Quick)',
      description: 'Sharp two-beep alarm sound',
      play: () => playAlarmSound(),
    },
    {
      id: 'beep',
      name: 'Beep (Gentle)',
      description: 'Soft sine wave beep that fades out',
      play: () => playBeepSound(0.5, 800),
    },
    {
      id: 'high-beep',
      name: 'High Beep (Alert)',
      description: 'High-frequency alert beep',
      play: () => playBeepSound(0.5, 1200),
    },
    {
      id: 'timer-complete',
      name: 'Timer Chime',
      description: 'Ascending three-tone chime',
      play: () => playTimerCompleteSound(),
    },
    {
      id: 'timer-looped',
      name: 'Timer Looped (60s)',
      description: 'Ascending three-tone chime, repeats for 60 seconds',
      play: () => {
        soundStopControlRef.current = playTimerCompleteSoundLooped()
        setPlayingSound('timer-looped')
        // Auto-clear playing state after 60 seconds
        setTimeout(() => {
          setPlayingSound(null)
          soundStopControlRef.current = null
        }, 60000)
      },
    },
  ]

  const handlePlaySound = (soundId: string) => {
    // Stop any currently playing looped sound
    if (soundStopControlRef.current) {
      soundStopControlRef.current.stop()
      soundStopControlRef.current = null
    }

    const sound = sounds.find((s) => s.id === soundId)
    if (sound) {
      sound.play()
      setPlayingSound(soundId === 'timer-looped' ? soundId : null)
    }
  }

  const handleStopLoopedSound = () => {
    if (soundStopControlRef.current) {
      soundStopControlRef.current.stop()
      soundStopControlRef.current = null
    }
    setPlayingSound(null)
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p>
          <strong>Select a sound</strong> to use for alarms and timers. Your selection is saved automatically. Click
          play to preview the sound.
        </p>
      </div>

      {/* Sound Selection Grid */}
      <div className="space-y-3">
        {sounds.map((sound) => (
          <div
            key={sound.id}
            className={`p-4 border rounded-lg cursor-pointer transition-colors ${
              selectedSound === sound.id
                ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700'
                : 'bg-background border-border hover:bg-muted'
            }`}
            onClick={() => onSoundChange(sound.id)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      selectedSound === sound.id
                        ? 'bg-blue-500 border-blue-600'
                        : 'border-muted-foreground'
                    }`}
                  />
                  <h3 className="font-semibold text-sm">{sound.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground">{sound.description}</p>
              </div>
              <Button
                size="sm"
                variant={playingSound === sound.id ? 'destructive' : 'outline'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (playingSound === sound.id) {
                    handleStopLoopedSound()
                  } else {
                    handlePlaySound(sound.id)
                  }
                }}
                className="gap-1 flex-shrink-0"
              >
                {playingSound === sound.id ? (
                  <>
                    <span className="size-4">⏹</span>
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Play
                  </>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Selection Indicator */}
      <div className="bg-muted p-3 rounded text-sm">
        <p>
          <strong>Current Selection:</strong>{' '}
          {sounds.find((s) => s.id === selectedSound)?.name || 'Alarm (Quick)'}
        </p>
      </div>

      {/* Info */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded space-y-2">
        <p>
          <strong>How it works:</strong> The selected sound will be used by the Alarm and Timer tabs. Your choice is
          automatically saved to your browser's local storage.
        </p>
        <p>
          <strong>Looped Sounds:</strong> The "Timer Looped" sound will play for 60 seconds. Click the Stop button to
          stop it early.
        </p>
      </div>
    </div>
  )
}
