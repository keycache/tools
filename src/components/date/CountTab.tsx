import { useState } from 'react'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  countDays,
  countBusinessDays,
  countWeeks,
  formatDate,
  formatDateForInput,
  parseDateFromInput,
} from '@/lib/dateCalculations'

export function CountTab() {
  const today = new Date()
  const [startDate, setStartDate] = useState(formatDateForInput(today))
  const [endDate, setEndDate] = useState(formatDateForInput(today))
  const [includeStartDate, setIncludeStartDate] = useState(false)
  const [includeEndDate, setIncludeEndDate] = useState(false)
  const [result, setResult] = useState<{ type: string; value: number } | null>(null)

  const handleCountDays = () => {
    const start = parseDateFromInput(startDate)
    const end = parseDateFromInput(endDate)

    if (start > end) {
      alert('Start date must be before or equal to end date')
      return
    }

    const days = countDays({
      start,
      end,
      includeStart: includeStartDate,
      includeEnd: includeEndDate,
    })

    setResult({ type: 'days', value: days })
  }

  const handleCountBusinessDays = () => {
    const start = parseDateFromInput(startDate)
    const end = parseDateFromInput(endDate)

    if (start > end) {
      alert('Start date must be before or equal to end date')
      return
    }

    const businessDays = countBusinessDays({
      start,
      end,
      includeStart: includeStartDate,
      includeEnd: includeEndDate,
    })

    setResult({ type: 'businessDays', value: businessDays })
  }

  const handleCountWeeks = () => {
    const start = parseDateFromInput(startDate)
    const end = parseDateFromInput(endDate)

    if (start > end) {
      alert('Start date must be before or equal to end date')
      return
    }

    const weeks = countWeeks({
      start,
      end,
      includeStart: includeStartDate,
      includeEnd: includeEndDate,
    })

    setResult({ type: 'weeks', value: weeks })
  }

  const resultLabel = {
    days: 'Days',
    businessDays: 'Business Days',
    weeks: 'Weeks',
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        <p>
          <strong>Count the difference between two dates.</strong> Select start and end dates, then
          choose whether to include them in the calculation.
        </p>
      </div>

      {/* Start Date */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Start Date</label>
        <div className="space-y-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeStartDate}
              onChange={(e) => setIncludeStartDate(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-muted-foreground">Include this date</span>
          </label>
        </div>
      </div>

      {/* End Date */}
      <div className="space-y-2">
        <label className="text-sm font-medium">End Date</label>
        <div className="space-y-2">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeEndDate}
              onChange={(e) => setIncludeEndDate(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-muted-foreground">Include this date</span>
          </label>
        </div>
      </div>

      {/* Buttons */}
      <div className="grid grid-cols-3 gap-3">
        <Button onClick={handleCountDays} variant="outline" className="gap-2">
          <Calendar className="size-4" />
          Days
        </Button>
        <Button onClick={handleCountBusinessDays} variant="outline" className="gap-2">
          <Calendar className="size-4" />
          Business Days
        </Button>
        <Button onClick={handleCountWeeks} variant="outline" className="gap-2">
          <Calendar className="size-4" />
          Weeks
        </Button>
      </div>

      {/* Result */}
      {result && (
        <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-muted-foreground mb-1">Result</p>
          <div className="text-3xl font-bold text-blue-700 dark:text-blue-200">
            {result.value} {resultLabel[result.type as keyof typeof resultLabel]}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            From {formatDate(parseDateFromInput(startDate))} to{' '}
            {formatDate(parseDateFromInput(endDate))}
          </p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
        <p>
          <strong>Note:</strong> Business days count Monday through Friday only, excluding weekends.
          All calculations are based on the Gregorian calendar.
        </p>
      </div>
    </div>
  )
}
