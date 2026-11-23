import { decodeBlob, encodeBlob } from './codec'
import { detectFormat } from './detect'
import { extractZipEntry, listZip, MAX_ARCHIVE_BYTES, readOfficeParts } from './archive'
import type { Base64Request, Base64Response, Base64Result } from './protocol'

const scope = self as typeof self & { postMessage(message: Base64Response): void }

scope.onmessage = async ({ data }: MessageEvent<Base64Request>) => {
  const { id, command } = data
  let lastPercent = -1
  const progress = (percent: number) => {
    if (percent !== lastPercent) scope.postMessage({ id, type: 'progress', percent })
    lastPercent = percent
  }
  try {
    let result: Base64Result
    if (command.type === 'encode') result = { kind: 'encoded', blob: await encodeBlob(command.source, progress) }
    else if (command.type === 'decode') result = { kind: 'decoded', blob: await decodeBlob(command.source, progress) }
    else if (command.type === 'detect') result = { kind: 'detected', format: await detectFormat(command.source) }
    else {
      if (command.source.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP and Office previews are limited to 16 MiB compressed. The original file is still downloadable.')
      const bytes = new Uint8Array(await command.source.arrayBuffer())
      if (command.type === 'office') result = { kind: 'office', ...readOfficeParts(bytes, command.format) }
      else {
        const entries = listZip(bytes)
        result = command.type === 'archive' ? { kind: 'archive', entries }
          : { kind: 'extracted', blob: new Blob([extractZipEntry(bytes, entries, command.index)], { type: 'application/octet-stream' }), name: entries[command.index].name }
      }
    }
    scope.postMessage({ id, type: 'result', result })
  } catch (error) {
    scope.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
