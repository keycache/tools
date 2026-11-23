// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/check-deploy-size.mjs', import.meta.url))
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tools-deploy-size-'))
  await mkdir(path.join(directory, 'dist', 'nested'), { recursive: true })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('branch deployment size guard', () => {
  it.each([
    { bytes: 100 * 1024 ** 2 - 1, allowed: true },
    { bytes: 100 * 1024 ** 2, allowed: false },
  ])('checks nested assets at the 100 MiB boundary: $bytes bytes', async ({ bytes, allowed }) => {
    const file = await open(path.join(directory, 'dist', 'nested', 'model.onnx'), 'w')
    try { await file.truncate(bytes) } finally { await file.close() }
    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(allowed ? 0 : 1)
    if (!allowed) {
      expect(result.stderr).toContain(path.join('nested', 'model.onnx'))
      expect(result.stderr).toContain('below 100 MiB')
    }
  })
})
