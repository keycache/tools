import { useState } from 'react'
import { Copy, Check, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  addDays,
  addWeekdays,
  formatDate,
  formatDateForInput,
  parseDateFromInput,
} from '@/lib/dateCalculations'

export function AddTab() {
  const today = new Date()
  const [inputDate, setInputDate] = useState(formatDateForInput(today))
  const [numValue, setNumValue] = useState<string>('1')
  const [mode, setMode] = useState<'days' | 'weekdays'>('days')
  const [result, setResult] = useState<{ date: Date; input: number; mode: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCalculate = () => {
    const num = parseInt(numValue, 10)
    if (isNaN(num)) {
      alert('Please enter a valid number')
      return
    }

    const date = parseDateFromInput(inputDate)
    const resultDate = mode === 'days' ? addDays(date, num) : addWeekdays(date, num)

    setResult({ date: resultDate, input: num, mode })
    setCopied(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(formatDate(result!.date))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const modeLabel = mode === 'days' ? 'Day' : 'Weekday'
  const pluralLabel = mode === 'days' ? 'Days' : 'Weekdays'
  const sign = result && result.input >= 0 ? '+' : ''

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p>
          <strong>Add or subtract days/weekdays from a date.</strong> Select a date, enter a number
          (positive or negative), and choose the calculation mode.
        </p>
      </div>

      {/* Input Date */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Date</label>
        <input
          type="date"
          value={inputDate}
          onChange={(e) => setInputDate(e.target.value)}
          className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
        />
      </div>

      {/* Number Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Number (can be negative)</label>
        <input
          type="number"
          value={numValue}
          onChange={(e) => setNumValue(e.target.value)}
          placeholder="Enter number"
          className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
        />
      </div>

      {/* Mode Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Calculate by</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="days"
              checked={mode === 'days'}
              onChange={(e) => setMode(e.target.value as 'days' | 'weekdays')}
            />
            <span className="text-sm">Days</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="weekdays"
              checked={mode === 'weekdays'}
              onChange={(e) => setMode(e.target.value as 'days' | 'weekdays')}
            />
            <span className="text-sm">Weekdays (skips weekends)</span>
          </label>
        </div>
      </div>

      {/* Calculate Button */}
      <Button onClick={handleCalculate} className="w-full gap-2">
        <Calendar className="size-4" />
        Calculate
      </Button>

      {/* Result */}
      {result && (
        <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg space-y-3">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Result Date</p>
            <div className="text-2xl font-bold text-green-700 dark:text-green-200">
              {formatDate(result.date)}
            </div>
          </div>

          <div className="text-xs text-muted-foreground bg-white dark:bg-slate-900 p-2 rounded">
            <p>
              {formatDate(parseDateFromInput(inputDate))} {sign}
              {result.input} {result.input === 1 || result.input === -1 ? modeLabel : pluralLabel} =
              {' '}
              {formatDate(result.date)}
            </p>
          </div>

          <Button
            onClick={handleCopy}
            variant="outline"
            size="sm"
            className="w-full gap-2"
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy Result
              </>
            )}
          </Button>
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>Note:</strong> When using "Weekdays" mode, weekends (Saturday & Sunday) are
          skipped automatically. Negative numbers subtract days/weekdays to go back in time. All
          calculations are based on the Gregorian calendar.
        </p>
      </div>
    </div>
  )
}
