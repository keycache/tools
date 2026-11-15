/**
 * Returns a URL normaliser that maps `huggingface.co/<modelId>/resolve/main/…` to the pinned `revision`.
 *
 * Transformers.js 4.3.2 checks `tokenizer_config.json` via `get_file_metadata(model, file, {})` without the
 * `revision` option, i.e. at `resolve/main/`. That misses the pinned-revision cache entry and goes to the network on
 * every load — which breaks loading offline. Applying this in the cache (`match` and `put`) makes it a cache hit.
 * URLs of other models pass through unchanged.
 */
export function pinRevision(modelId: string, revision: string): (url: string) => string {
  const from = `/${modelId}/resolve/main/`
  const to = `/${modelId}/resolve/${revision}/`
  return (url) => url.replace(from, to)
}
