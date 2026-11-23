import { useEffect, useState } from 'react'

export function useObjectUrl(blob: Blob | null): string | null {
  const [value, setValue] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    // The effect owns this external resource, including Strict Mode cleanup.
    // oxlint-disable-next-line react/set-state-in-effect
    setValue({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return value?.blob === blob ? value.url : null
}
