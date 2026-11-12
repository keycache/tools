import { useState, useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { playSoundById } from '@/lib/audioSounds'

interface TimerTabProps {
  selectedSound: string
  /** Called when the countdown finishes, so the parent can bring this tab into view. */
  onAlert?: () => void
}

export function TimerTab({ selectedSound, onAlert }: TimerTabProps) {
  const [duration, setDuration] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [customHours, setCustomHours] = useState<string>('')
  const [customMinutes, setCustomMinutes] = useState<string>('')
  const [customSeconds, setCustomSeconds] = useState<string>('')
  const soundControlRef = useRef<{ stop: () => void } | null>(null)
  const soundStartedRef = useRef(false)
  /** Epoch ms when the running timer reaches zero; null while paused/stopped. */
  const endAtRef = useRef<number | null>(null)

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundControlRef.current) {
        soundControlRef.current.stop()
        soundControlRef.current = null
      }
    }
  }, [])

  // Start sound when timer completes
  useEffect(() => {
    if (isCompleted && !soundStartedRef.current) {
      soundStartedRef.current = true
      onAlert?.()
      const soundControl = playSoundById(selectedSound)
      if (soundControl) {
        soundControlRef.current = soundControl
      }
    }
  }, [isCompleted, selectedSound, onAlert])

  // Timer tick effect. Remaining time is derived from a wall-clock deadline rather than decremented per
  // tick: background tabs throttle setInterval (≥1s, or ~1/min in Chrome after a while), which made a
  // decrementing timer crawl while the tab was hidden.
  useEffect(() => {
    if (!isRunning || endAtRef.current == null) return
    const endAt = endAtRef.current

    const tick = () => {
      const remaining = Math.max(0, endAt - Date.now())
      setTimeLeft(remaining)
      if (remaining === 0) {
        setIsRunning(false)
        setIsCompleted(true)
      }
    }

    const intervalId = setInterval(tick, 100)
    // A one-shot timeout isn't subject to Chrome's intensive throttling of repeating timers, so the
    // alarm still fires on time while the tab is hidden.
    const finishId = setTimeout(tick, Math.max(0, endAt - Date.now()))
    document.addEventListener('visibilitychange', tick)

    return () => {
      clearInterval(intervalId)
      clearTimeout(finishId)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [isRunning])

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  const handlePresetClick = (milliseconds: number) => {
    endAtRef.current = null
    setDuration(milliseconds)
    setTimeLeft(milliseconds)
    setIsRunning(false)
    setIsCompleted(false)
    soundStartedRef.current = false
    setCustomHours('')
    setCustomMinutes('')
    setCustomSeconds('')
  }

  const handleSetCustomTimer = () => {
    const h = parseInt(customHours || '0', 10)
    const m = parseInt(customMinutes || '0', 10)
    const s = parseInt(customSeconds || '0', 10)

    if (isNaN(h) || isNaN(m) || isNaN(s) || h < 0 || m < 0 || s < 0 || m > 59 || s > 59) {
      alert('Please enter valid hours, minutes (0-59), and seconds (0-59)')
      return
    }

    if (h === 0 && m === 0 && s === 0) {
      alert('Please enter a time greater than 0')
      return
    }

    const milliseconds = (h * 3600 + m * 60 + s) * 1000
    handlePresetClick(milliseconds)
  }

  const handleStart = () => {
    if (duration > 0 && !isCompleted && timeLeft > 0) {
      endAtRef.current = Date.now() + timeLeft
      setIsRunning(true)
    }
  }

  const handlePause = () => {
    if (endAtRef.current != null) setTimeLeft(Math.max(0, endAtRef.current - Date.now()))
    endAtRef.current = null
    setIsRunning(false)
  }

  const handleReset = () => {
    endAtRef.current = null
    setIsRunning(false)
    setTimeLeft(duration)
    setIsCompleted(false)
    soundStartedRef.current = false
    // Stop any playing sound
    if (soundControlRef.current) {
      soundControlRef.current.stop()
      soundControlRef.current = null
    }
  }

  const handleDismissAlarm = () => {
    setIsCompleted(false)
    soundStartedRef.current = false
    // Stop the looped sound
    if (soundControlRef.current) {
      soundControlRef.current.stop()
      soundControlRef.current = null
    }
  }

  const presets = [
    { label: '10s', ms: 10 * 1000 },
    { label: '15s', ms: 15 * 1000 },
    { label: '30s', ms: 30 * 1000 },
    { label: '1m', ms: 1 * 60 * 1000 },
    { label: '2m', ms: 2 * 60 * 1000 },
    { label: '5m', ms: 5 * 60 * 1000 },
    { label: '10m', ms: 10 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '30m', ms: 30 * 60 * 1000 },
    { label: '1h', ms: 1 * 60 * 60 * 1000 },
    { label: '2h', ms: 2 * 60 * 60 * 1000 },
    { label: '5h', ms: 5 * 60 * 60 * 1000 },
  ]

  const presetCategories = [
    { title: 'Seconds', presets: presets.slice(0, 3) },
    { title: 'Minutes', presets: presets.slice(3, 9) },
    { title: 'Hours', presets: presets.slice(9) },
  ]

  return (
    <div className="space-y-6">
      {/* Display */}
      <div
        className={`p-8 rounded-lg transition-all ${
          isCompleted
            ? 'bg-green-50 dark:bg-green-950 relative'
            : 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800'
        }`}
      >
        {isCompleted && (
          <div className="absolute top-3 right-4 text-sm font-semibold text-green-700 dark:text-green-300">
            Time's up!
          </div>
        )}
        <div className="text-6xl font-mono font-bold tracking-wide text-slate-900 dark:text-slate-100 text-center">
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-between items-center">
        {isCompleted && (
          <Button onClick={handleDismissAlarm} size="lg" variant="default" className="gap-2">
            <X className="size-5" />
            Dismiss Alarm
          </Button>
        )}

        <div className="flex gap-3 ml-auto">
          <Button
            onClick={handleReset}
            size="lg"
            variant="outline"
            disabled={duration === 0}
            className="gap-2"
          >
            <RotateCcw className="size-5" />
            Reset
          </Button>

          {!isRunning ? (
            <Button
              onClick={handleStart}
              size="lg"
              disabled={duration === 0}
              className="gap-2"
            >
              <Play className="size-5" />
              Start
            </Button>
          ) : (
            <Button onClick={handlePause} size="lg" variant="secondary" className="gap-2">
              <Pause className="size-5" />
              Pause
            </Button>
          )}
        </div>
      </div>

      {/* Current Duration Display */}
      {duration > 0 && (
        <div className="text-center text-sm text-muted-foreground">
          Selected: {formatTime(duration)}
        </div>
      )}

      {/* Custom Timer Input */}
      <div className="space-y-3 border-t pt-4 border-b pb-4">
        <h3 className="font-semibold text-sm text-muted-foreground">Custom Duration</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Hours</label>
            <input
              type="number"
              min="0"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              placeholder="HH"
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-center"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Minutes</label>
            <input
              type="number"
              min="0"
              max="59"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="MM"
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-center"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Seconds</label>
            <input
              type="number"
              min="0"
              max="59"
              value={customSeconds}
              onChange={(e) => setCustomSeconds(e.target.value)}
              placeholder="SS"
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-center"
            />
          </div>
          <Button onClick={handleSetCustomTimer} className="px-6">
            Set
          </Button>
        </div>
      </div>

      {/* Preset Categories */}
      <div className="space-y-4">
        {presetCategories.map((category) => (
          <div key={category.title}>
            <h3 className="font-semibold text-sm mb-2 text-muted-foreground">{category.title}</h3>
            <div className="grid grid-cols-3 gap-2">
              {category.presets.map((preset) => (
                <Button
                  key={preset.label}
                  variant={duration === preset.ms ? 'default' : 'outline'}
                  onClick={() => handlePresetClick(preset.ms)}
                  className="text-sm"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>How to use:</strong> Click a preset time or enter a custom duration, then click Start. The timer
          will count down and play a sound when complete. Pause to temporarily stop, and Reset to return to the
          original duration.
        </p>
      </div>
    </div>
  )
}
