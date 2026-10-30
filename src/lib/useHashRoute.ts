import { useSyncExternalStore } from 'react'
import { parseHash } from '@/lib/route'

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, () => parseHash(window.location.hash))
}
