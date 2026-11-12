import { useState, useEffect, useCallback } from 'react'
import { Clock, Bell, Zap, Globe, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AlarmTab } from '@/components/clock/AlarmTab'
import { StopwatchTab } from '@/components/clock/StopwatchTab'
import { TimerTab } from '@/components/clock/TimerTab'
import { TimeTab } from '@/components/clock/TimeTab'
import { SoundTab } from '@/components/clock/SoundTab'

type TabType = 'alarm' | 'stopwatch' | 'timer' | 'time' | 'sound'

export interface Lap {
  id: number
  splitTime: string
  totalTime: string
  duration: number
}

export function ClockTool() {
  const [activeTab, setActiveTab] = useState<TabType>('alarm')
  const showAlarm = useCallback(() => setActiveTab('alarm'), [])
  const showTimer = useCallback(() => setActiveTab('timer'), [])
  const [selectedSound, setSelectedSound] = useState(() => {
    return localStorage.getItem('selectedSound') || 'alarm'
  })
  
  // Stopwatch state at parent level (persisted across tabs)
  const [stopwatchTime, setStopwatchTime] = useState(0)
  const [stopwatchIsRunning, setStopwatchIsRunning] = useState(false)
  const [stopwatchLaps, setStopwatchLaps] = useState<Lap[]>([])
  const [stopwatchLapCounter, setStopwatchLapCounter] = useState(0)

  // Save selected sound to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('selectedSound', selectedSound)
  }, [selectedSound])

  const tabs = [
    { id: 'alarm' as TabType, label: 'Alarm', icon: Bell },
    { id: 'stopwatch' as TabType, label: 'Stopwatch', icon: Zap },
    { id: 'timer' as TabType, label: 'Timer', icon: Clock },
    { id: 'time' as TabType, label: 'Time', icon: Globe },
    { id: 'sound' as TabType, label: 'Sound', icon: Volume2 },
  ]

  return (
    <div className="space-y-6">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          All-in-one clock tool with alarm, stopwatch, timer, and world time zone support. All data is saved locally in
          your browser.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={activeTab === id ? 'default' : 'outline'}
            onClick={() => setActiveTab(id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {/* All panels stay mounted (inactive ones hidden) so the timer, stopwatch and alarm keep running
          while another clock tab is open. A ringing timer/alarm brings its own tab forward. */}
      <div hidden={activeTab !== 'alarm'}>
        <AlarmTab selectedSound={selectedSound} onAlert={showAlarm} />
      </div>
      <div hidden={activeTab !== 'stopwatch'}>
        <StopwatchTab
          time={stopwatchTime}
          setTime={setStopwatchTime}
          isRunning={stopwatchIsRunning}
          setIsRunning={setStopwatchIsRunning}
          laps={stopwatchLaps}
          setLaps={setStopwatchLaps}
          lapCounter={stopwatchLapCounter}
          setLapCounter={setStopwatchLapCounter}
        />
      </div>
      <div hidden={activeTab !== 'timer'}>
        <TimerTab selectedSound={selectedSound} onAlert={showTimer} />
      </div>
      <div hidden={activeTab !== 'time'}>
        <TimeTab />
      </div>
      <div hidden={activeTab !== 'sound'}>
        <SoundTab selectedSound={selectedSound} onSoundChange={setSelectedSound} />
      </div>
    </div>
  )
}
