import { useEffect } from 'react'
import { Play, Pause, RotateCcw, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Lap } from '@/components/ClockTool'

interface StopwatchTabProps {
  time: number
  setTime: (time: number) => void
  isRunning: boolean
  setIsRunning: (running: boolean) => void
  laps: Lap[]
  setLaps: (laps: Lap[]) => void
  lapCounter: number
  setLapCounter: (counter: number) => void
}

export function StopwatchTab({
  time,
  setTime,
  isRunning,
  setIsRunning,
  laps,
  setLaps,
  lapCounter,
  setLapCounter,
}: StopwatchTabProps) {
  // Elapsed time is anchored to the wall clock instead of adding 10ms per tick, so it stays correct when
  // a hidden tab throttles setInterval (see TimerTab for the same fix).
  useEffect(() => {
    if (!isRunning) return
    const startedAt = Date.now() - time
    const tick = () => setTime(Date.now() - startedAt)
    const intervalId = setInterval(tick, 10)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', tick)
    }
    // `time` is only the starting offset; re-running on every tick would reset the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, setTime])

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const milliseconds = Math.floor((ms % 1000) / 10)

    const mins = minutes.toString().padStart(2, '0')
    const secs = seconds.toString().padStart(2, '0')
    const millis = milliseconds.toString().padStart(2, '0')

    return `${mins}:${secs}.${millis}`
  }

  const handleStart = () => setIsRunning(true)
  const handlePause = () => setIsRunning(false)

  const handleLap = () => {
    if (laps.length < 100) {
      const totalTime = time
      let splitTime = time

      if (laps.length > 0) {
        // Calculate split time as difference from previous lap
        splitTime = time - laps[laps.length - 1].duration
      }

      setLaps([
        ...laps,
        {
          id: lapCounter,
          splitTime: formatTime(splitTime),
          totalTime: formatTime(totalTime),
          duration: totalTime,
        },
      ])
      setLapCounter(lapCounter + 1)
    }
  }

  const handleReset = () => {
    setTime(0)
    setIsRunning(false)
    setLaps([])
    setLapCounter(0)
  }

  return (
    <div className="space-y-6">
      {/* Display */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-8 rounded-lg text-center">
        <div className="text-6xl font-mono font-bold text-slate-900 dark:text-slate-100 tracking-wide">
          {formatTime(time)}
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center flex-wrap">
        {!isRunning ? (
          <Button onClick={handleStart} size="lg" className="gap-2">
            <Play className="size-5" />
            Start
          </Button>
        ) : (
          <Button onClick={handlePause} size="lg" variant="secondary" className="gap-2">
            <Pause className="size-5" />
            Pause
          </Button>
        )}

        <Button onClick={handleLap} size="lg" variant="outline" disabled={!isRunning} className="gap-2">
          <Flag className="size-5" />
          Lap
        </Button>

        <Button onClick={handleReset} size="lg" variant="outline" className="gap-2">
          <RotateCcw className="size-5" />
          Reset
        </Button>
      </div>

      {/* Laps List */}
      {laps.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Laps ({laps.length}/100)</h3>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {/* Header Row */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-muted rounded font-semibold text-xs text-muted-foreground">
              <div>Lap</div>
              <div className="text-right">Split Time</div>
              <div className="text-right">Total Time</div>
            </div>

            {/* Lap Rows */}
            {[...laps].reverse().map((lap, idx) => (
              <div key={lap.id} className="grid grid-cols-3 gap-3 p-3 bg-muted rounded text-sm">
                <div className="font-medium">Lap {laps.length - idx}</div>
                <div className="text-right font-mono">{lap.splitTime}</div>
                <div className="text-right font-mono">{lap.totalTime}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>How to use:</strong> Click Start to begin timing. Use Lap to record split times (up to 100 laps).
          Pause to pause, and Reset to clear everything. Stopwatch state persists when switching tabs.
        </p>
        <p className="mt-1">
          <strong>Columns:</strong> Split Time is how long the lap took from the previous lap. Total Time is the
          cumulative time.
        </p>
      </div>
    </div>
  )
}
