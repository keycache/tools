/** Errors that loading/running a Transformers.js model can classify itself; callers add their own codes. */
export type ModelErrorCode = 'quota' | 'device-lost' | 'network' | 'unknown'

export function classifyError(err: unknown): { code: ModelErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return { code: 'quota', message: 'Browser storage is full. Free up space or clear other site data, then retry.' }
  if (/device (was )?lost|GPUDevice|out of memory|OOM/i.test(message)) return { code: 'device-lost', message: 'The GPU stopped responding (often out of memory). Close other tabs and reload the model.' }
  // Chrome: "Failed to fetch" / "network error" (stream cut mid-download); Firefox: "NetworkError…"; Safari: "Load failed".
  if (/fetch|network|Failed to load|Load failed|NetworkError|ERR_INTERNET|HTTP/i.test(message) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { code: 'network', message: `Download interrupted (${message}). Check your connection and retry — files that finished downloading are kept.` }
  }
  return { code: 'unknown', message }
}

/** User-facing note when model files loaded but couldn't be written to browser storage (see OpfsModelCache.failures). */
export function describeCacheFailures(failures: { error: unknown }[], modelName: string): string | undefined {
  if (!failures.length) return undefined
  const quota = failures.some((f) => classifyError(f.error).code === 'quota')
  const files = failures.length === 1 ? '1 file' : `${failures.length} files`
  return quota
    ? `Loaded, but browser storage is full, so ${files} couldn't be saved — ${modelName} will download again next time. Free up space, then reload to keep it offline.`
    : `Loaded, but ${files} couldn't be saved to browser storage — ${modelName} will download again next time.`
}
