import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { playBeepSound, playSoundById } from '@/lib/audioSounds'

interface AlarmPreset {
  time: string
  label: string
  isActive: boolean
  dateTime: Date
}

interface AlarmTabProps {
  selectedSound: string
  /** Called when the alarm starts ringing, so the parent can bring this tab into view. */
  onAlert?: () => void
}

export function AlarmTab({ selectedSound, onAlert }: AlarmTabProps) {
  const [presets, setPresets] = useState<AlarmPreset[]>([])
  const [activeAlarm, setActiveAlarm] = useState<string | null>(null)
  const [customHours, setCustomHours] = useState<string>('')
  const [customMinutes, setCustomMinutes] = useState<string>('')
  const [alarmTriggered, setAlarmTriggered] = useState(false)
  const [alarmDateTime, setAlarmDateTime] = useState<Date | null>(null)
  const [alarmSounding, setAlarmSounding] = useState(false)
  const soundControlRef = useRef<{ stop: () => void } | null>(null)

  // Calculate preset alarms for next 4 hours
  useEffect(() => {
    const now = new Date()
    const newPresets: AlarmPreset[] = []

    for (let i = 1; i <= 4; i++) {
      const time = new Date(now.getTime() + i * 60 * 60 * 1000)
      const hours = time.getHours() % 12 || 12
      const minutes = time.getMinutes().toString().padStart(2, '0')
      const period = time.getHours() >= 12 ? 'PM' : 'AM'
      const timeStr = `${hours}:${minutes} ${period}`

      newPresets.push({
        time: timeStr,
        label: `+${i}h`,
        isActive: false,
        dateTime: time,
      })
    }

    setPresets(newPresets)
  }, [])

  // Monitor alarm time and trigger when reached
  useEffect(() => {
    if (!alarmDateTime || alarmTriggered) {
      return
    }

    const checkAlarm = setInterval(() => {
      // ">= start of the alarm minute" rather than "same hour and minute": a hidden tab may only get
      // one timer tick per minute, which could skip past the matching minute entirely.
      const due = new Date(alarmDateTime)
      due.setSeconds(0, 0)
      if (Date.now() >= due.getTime() && !alarmTriggered) {
        setAlarmTriggered(true)
        setAlarmSounding(true)
        onAlert?.()
        // Play selected sound for 60 seconds
        soundControlRef.current = playSoundById(selectedSound)
      }
    }, 1000) // Check every second

    return () => clearInterval(checkAlarm)
  }, [alarmDateTime, alarmTriggered, selectedSound, onAlert])

  const handleSetAlarm = (timeStr: string, dateTime?: Date) => {
    setActiveAlarm(timeStr)
    setAlarmTriggered(false)
    if (dateTime) {
      setAlarmDateTime(dateTime)
    }
    // Short one-off confirmation chirp. (playSoundById returns the 60s *looping* alarm sound, which
    // made the alarm appear to go off the moment it was set, with nothing to dismiss it.)
    playBeepSound(0.15, 880)
  }

  const handleSetCustomAlarm = () => {
    const h = customHours ? parseInt(customHours, 10) : null
    const m = customMinutes ? parseInt(customMinutes, 10) : null

    // At least one field must be filled
    if (h === null && m === null) {
      alert('Please enter at least hours or minutes')
      return
    }

    // Validate ranges
    if ((h !== null && (isNaN(h) || h < 0 || h > 23)) || (m !== null && (isNaN(m) || m < 0 || m > 59))) {
      alert('Please enter valid hours (0-23) and minutes (0-59)')
      return
    }

    // Get current time
    const now = new Date()
    let alarmDate = new Date(now)

    // If only minutes provided, use current hour
    if (h === null) {
      alarmDate.setMinutes(m as number)
      alarmDate.setSeconds(0)
      // If time is in the past, move to next hour
      if (alarmDate <= now) {
        alarmDate.setHours(alarmDate.getHours() + 1)
      }
    } else {
      // Both hours and minutes provided
      alarmDate.setHours(h)
      alarmDate.setMinutes(m ?? 0)
      alarmDate.setSeconds(0)
      // If time is in the past, move to next occurrence
      if (alarmDate <= now) {
        alarmDate.setDate(alarmDate.getDate() + 1)
      }
    }

    // Format time string
    const displayHours = alarmDate.getHours() % 12 || 12
    const displayMinutes = alarmDate.getMinutes().toString().padStart(2, '0')
    const period = alarmDate.getHours() >= 12 ? 'PM' : 'AM'
    const timeStr = `${displayHours}:${displayMinutes} ${period}`
    handleSetAlarm(timeStr, alarmDate)
  }

  const handleDismissAlarm = () => {
    // Stop the sound
    if (soundControlRef.current) {
      soundControlRef.current.stop()
      soundControlRef.current = null
    }
    // Clear everything
    setActiveAlarm(null)
    setAlarmDateTime(null)
    setAlarmTriggered(false)
    setAlarmSounding(false)
  }

  const handleCancelAlarm = () => {
    handleDismissAlarm()
  }

  const formatAlarmDisplay = (dateTime: Date) => {
    const hours = dateTime.getHours() % 12 || 12
    const minutes = dateTime.getMinutes().toString().padStart(2, '0')
    const period = dateTime.getHours() >= 12 ? 'PM' : 'AM'
    const month = dateTime.toLocaleString('default', { month: 'short' })
    const day = dateTime.getDate()
    const dayName = dateTime.toLocaleString('default', { weekday: 'short' })
    
    return {
      time: `${hours}:${minutes} ${period}`,
      date: `${dayName}, ${month} ${day}`
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p><strong>Set an alarm for a specific time.</strong> Use preset times (+1h to +4h from now) or enter a custom time. Enter just minutes to set an alarm for that minute in the current or next hour.</p>
      </div>

      {/* Active Alarm Display */}
      {activeAlarm && !alarmSounding && alarmDateTime && (
        <Card className="p-4 bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-orange-900 dark:text-orange-100">Alarm Set</p>
              <p className="text-2xl font-bold text-orange-700 dark:text-orange-200">{formatAlarmDisplay(alarmDateTime).time}</p>
              <p className="text-xs text-orange-600 dark:text-orange-300 mt-1">{formatAlarmDisplay(alarmDateTime).date}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancelAlarm} className="gap-2">
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Alarm Sounding Display */}
      {alarmSounding && alarmDateTime && (
        <Card className="p-6 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-900 dark:text-green-100">Time's Up!</p>
              <p className="text-3xl font-bold text-green-700 dark:text-green-200 mt-2">{formatAlarmDisplay(alarmDateTime).time}</p>
              <p className="text-sm text-green-600 dark:text-green-300 mt-2">{formatAlarmDisplay(alarmDateTime).date}</p>
            </div>
            <Button 
              onClick={handleDismissAlarm}
              variant="default"
              className="gap-2 bg-green-700 hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-700"
            >
              <X className="size-4" />
              Dismiss Alarm
            </Button>
          </div>
        </Card>
      )}

      {/* Preset Alarms Grid */}
      <div>
        <h3 className="font-semibold text-sm mb-3 text-muted-foreground">Preset Times</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {presets.map((preset, idx) => (
            <Button
              key={idx}
              variant={activeAlarm === preset.time ? 'default' : 'outline'}
              onClick={() => handleSetAlarm(preset.time, preset.dateTime)}
              className="flex flex-col items-center gap-1 h-auto py-3"
            >
              <span className="text-lg font-semibold">{preset.time}</span>
              <span className="text-xs text-muted-foreground">{preset.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Custom Alarm Input */}
      <div>
        <h3 className="font-semibold text-sm mb-3 text-muted-foreground">Custom Time</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Hours (0-23) <span className="text-xs text-gray-400">optional</span></label>
            <input
              type="number"
              min="0"
              max="23"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              placeholder="HH"
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground text-center"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Minutes (0-59)</label>
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
          <Button onClick={handleSetCustomAlarm} className="px-6">
            Set
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded space-y-2">
        <p>
          <strong>How to use:</strong> Click any preset time or enter a custom time to set an alarm. You can enter
          just minutes, just hours, or both.
        </p>
        <p>
          <strong>Examples:</strong>
          <br />• "50" mins → alarm at XX:50 (next occurrence, e.g., 2:50 PM if now is 2:45 PM)
          <br />• "14" hours → alarm at 2:00 PM
          <br />• "14:30" → alarm at 2:30 PM
          <br />• "15" hours → alarm at 3:00 PM (next day if 3 PM already passed)
        </p>
        <p>
          <strong>Note:</strong> Alarms use the Web Audio API to play a sound. The alarm will sound when the time is
          reached (this requires the page to stay open).
        </p>
      </div>
    </div>
  )
}
