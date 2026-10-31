// Date calculation utilities for DateMath tool

export interface DateRange {
  start: Date
  end: Date
  includeStart: boolean
  includeEnd: boolean
}

// Count days between two dates (inclusive or exclusive based on checkboxes)
export function countDays(range: DateRange): number {
  const start = new Date(range.start)
  const end = new Date(range.end)

  if (start > end) return 0

  // Start from the day after if not including start
  if (!range.includeStart) {
    start.setDate(start.getDate() + 1)
  }

  // End at the day before if not including end
  if (!range.includeEnd) {
    end.setDate(end.getDate() - 1)
  }

  // Calculate difference in days
  const diffTime = Math.abs(end.getTime() - start.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return Math.max(0, diffDays + 1) // +1 because both endpoints should count if included
}

// Count business days (Monday-Friday only)
export function countBusinessDays(range: DateRange): number {
  let start = new Date(range.start)
  const end = new Date(range.end)

  if (start > end) return 0

  // Start from the day after if not including start
  if (!range.includeStart) {
    start.setDate(start.getDate() + 1)
  }

  // End at the day before if not including end
  if (!range.includeEnd) {
    end.setDate(end.getDate() - 1)
  }

  let count = 0
  const current = new Date(start)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++
    }
    current.setDate(current.getDate() + 1)
  }

  return count
}

// Count weeks between two dates
export function countWeeks(range: DateRange): number {
  const start = new Date(range.start)
  const end = new Date(range.end)

  if (start > end) return 0

  // Start from the day after if not including start
  if (!range.includeStart) {
    start.setDate(start.getDate() + 1)
  }

  // End at the day before if not including end
  if (!range.includeEnd) {
    end.setDate(end.getDate() - 1)
  }

  const diffTime = Math.abs(end.getTime() - start.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(diffDays / 7)

  return weeks
}

// Add days to a date (can be negative for subtraction)
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

// Add weekdays to a date, skipping weekends (can be negative for subtraction)
export function addWeekdays(date: Date, weekdays: number): Date {
  const result = new Date(date)
  let remaining = Math.abs(weekdays)
  const direction = weekdays >= 0 ? 1 : -1

  while (remaining > 0) {
    result.setDate(result.getDate() + direction)
    const dayOfWeek = result.getDay()
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining--
    }
  }

  return result
}

// Format date as "Jan 1, 2026"
export function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
  return date.toLocaleDateString('en-US', options)
}

// Format date for HTML input type="date" (YYYY-MM-DD)
export function formatDateForInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Parse date from HTML input type="date" (YYYY-MM-DD)
export function parseDateFromInput(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}
