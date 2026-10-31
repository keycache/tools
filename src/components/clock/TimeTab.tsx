import { useState, useEffect } from 'react'
import { X, Plus, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface SavedTimezone {
  id: string
  name: string
  timezone: string
}

export function TimeTab() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [savedTimezones, setSavedTimezones] = useState<SavedTimezone[]>([])
  const [selectedTimezone, setSelectedTimezone] = useState('America/New_York')
  const [customName, setCustomName] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('saved_timezones')
    if (stored) {
      try {
        setSavedTimezones(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to parse saved timezones:', e)
      }
    }
  }, [])

  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Save to localStorage whenever savedTimezones changes
  useEffect(() => {
    localStorage.setItem('saved_timezones', JSON.stringify(savedTimezones))
  }, [savedTimezones])

  const defaultTimezones = [
    { name: 'New York', timezone: 'America/New_York' },
    { name: 'Los Angeles', timezone: 'America/Los_Angeles' },
    { name: 'London', timezone: 'Europe/London' },
    { name: 'Mumbai', timezone: 'Asia/Kolkata' },
    { name: 'Tokyo', timezone: 'Asia/Tokyo' },
    { name: 'Sydney', timezone: 'Australia/Sydney' },
    { name: 'Dubai', timezone: 'Asia/Dubai' },
    { name: 'Singapore', timezone: 'Asia/Singapore' },
    { name: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
    { name: 'Toronto', timezone: 'America/Toronto' },
  ]

  const formatTime = (date: Date, timezone: string): { date: string; time: string } => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })

      const parts = formatter.formatToParts(date)
      const dateStr = parts
        .filter((p) => ['month', 'day', 'year'].includes(p.type))
        .map((p) => p.value)
        .join(' ')

      const timeParts = parts.filter((p) => ['hour', 'minute', 'second', 'dayPeriod'].includes(p.type))
      const hour = timeParts.find((p) => p.type === 'hour')?.value || ''
      const minute = timeParts.find((p) => p.type === 'minute')?.value || ''
      const second = timeParts.find((p) => p.type === 'second')?.value || ''
      const period = timeParts.find((p) => p.type === 'dayPeriod')?.value || ''
      const timeStr = `${hour}:${minute}:${second} ${period}`

      return { date: dateStr, time: timeStr }
    } catch {
      return { date: 'Invalid', time: 'Timezone' }
    }
  }

  const handleAddTimezone = () => {
    if (!customName.trim()) {
      alert('Please enter a name for this timezone')
      return
    }

    const newTimezone: SavedTimezone = {
      id: Date.now().toString(),
      name: customName,
      timezone: selectedTimezone,
    }

    setSavedTimezones([...savedTimezones, newTimezone])
    setCustomName('')
    setShowAddForm(false)
    setSelectedTimezone('America/New_York')
  }

  const handleRemoveTimezone = (id: string) => {
    setSavedTimezones(savedTimezones.filter((tz) => tz.id !== id))
  }

  // Combine default and saved timezones, removing duplicates
  const allTimezones = [
    ...defaultTimezones,
    ...savedTimezones.map((tz) => ({ name: tz.name, timezone: tz.timezone })),
  ]
  const uniqueTimezones = Array.from(
    new Map(allTimezones.map((tz) => [tz.timezone, tz])).values()
  )

  const currentTimeData = formatTime(currentTime, Intl.DateTimeFormat().resolvedOptions().timeZone)

  return (
    <div className="space-y-6">
      {/* Current Time */}
      <Card className="p-6 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900 dark:to-indigo-800 border-indigo-200 dark:border-indigo-700">
        <div className="text-center">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 mb-2">Your Current Time</p>
          <p className="text-lg font-semibold text-indigo-900 dark:text-indigo-100">{currentTimeData.date}</p>
          <p className="text-4xl font-bold text-indigo-700 dark:text-indigo-200 font-mono mt-1">
            {currentTimeData.time}
          </p>
        </div>
      </Card>

      {/* Add Timezone Form */}
      <div className="space-y-3">
        {!showAddForm ? (
          <Button onClick={() => setShowAddForm(true)} variant="outline" className="w-full gap-2">
            <Plus className="size-4" />
            Add Timezone
          </Button>
        ) : (
          <Card className="p-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">Timezone</label>
              <div className="relative">
                <select
                  value={selectedTimezone}
                  onChange={(e) => setSelectedTimezone(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background text-foreground appearance-none cursor-pointer"
                >
                  {defaultTimezones.map((tz) => (
                    <option key={tz.timezone} value={tz.timezone}>
                      {tz.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 size-4 pointer-events-none text-muted-foreground" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">Display Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., Home, Office, Friend's Place"
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAddTimezone} className="flex-1">
                Add
              </Button>
              <Button
                onClick={() => {
                  setShowAddForm(false)
                  setCustomName('')
                }}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Saved Timezones Grid (2 columns, responsive) */}
      {savedTimezones.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Saved Timezones</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedTimezones.map((tz) => {
              const timeData = formatTime(currentTime, tz.timezone)
              return (
                <Card key={tz.id} className="p-4 relative space-y-3">
                  <Button
                    onClick={() => handleRemoveTimezone(tz.id)}
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 size-6 p-0 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <X className="size-4 text-muted-foreground hover:text-red-600" />
                  </Button>

                  <div>
                    <p className="font-bold text-lg text-foreground">{tz.name}</p>
                  </div>

                  <div className="flex justify-between items-baseline gap-2">
                    <p className="text-sm text-muted-foreground">{timeData.date}</p>
                    <p className="text-base font-mono font-bold text-foreground">{timeData.time}</p>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* All Timezones (Defaults + Saved) */}
      {uniqueTimezones.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <h3 className="font-semibold text-sm">All Available Timezones</h3>
          <div className="max-h-96 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {uniqueTimezones.map((tz) => {
                const timeData = formatTime(currentTime, tz.timezone)
                const isSaved = savedTimezones.some((saved) => saved.timezone === tz.timezone)
                return (
                  <div
                    key={tz.timezone}
                    className={`p-3 border rounded-md space-y-2 ${
                      isSaved
                        ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="font-bold text-base text-foreground">{tz.name}</p>
                    <div className="flex justify-between items-baseline gap-2">
                      <p className="text-sm text-muted-foreground">{timeData.date}</p>
                      <p className="text-base font-mono text-foreground">{timeData.time}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>How to use:</strong> Your current time is displayed at the top based on your local timezone. Use
          "Add Timezone" to save your favorite timezones with custom names. Saved timezones will persist when you come
          back.
        </p>
      </div>
    </div>
  )
}
