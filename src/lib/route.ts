// Hash routing keeps this working on GitHub Pages without 404 rewrites.
export function parseHash(hash: string): string {
  return hash.replace(/^#\/?/, '').replace(/\/+$/, '')
}
