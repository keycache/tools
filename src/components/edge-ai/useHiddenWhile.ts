import { useEffect, useRef, useSyncExternalStore } from 'react'

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

function subscribeVisibility(fn: () => void) {
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}

/** `document.hidden`, kept up to date. */
export function usePageHidden(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false)
}
