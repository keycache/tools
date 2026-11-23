import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await checkDirectory(file)
    } else {
      if (!entry.isFile()) throw new Error(`Cannot publish non-regular file: ${file}`)
      const { size } = await stat(file)
      if (size >= 100 * 1024 * 1024) {
        throw new Error(`${file} is ${(size / 1024 ** 2).toFixed(2)} MiB. Branch deployment requires every file to be below 100 MiB. Compress the asset or use the Actions artifact workflow.`)
      }
    }
  }
}

await checkDirectory('dist')
console.log('Deployment size check passed: every file is below 100 MiB.')
