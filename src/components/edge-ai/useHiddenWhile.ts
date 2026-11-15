import { useEffect, useRef } from 'react'

/** Tracks whether the page was hidden at any point while `active` is true (browsers throttle background GPU work). */
export function useHiddenWhile(active: boolean) {
  const hidden = useRef(false)
  useEffect(() => {
    if (!active) return
    hidden.current = document.hidden
    const onChange = () => {
      if (document.hidden) hidden.current = true
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [active])
  return hidden
}
