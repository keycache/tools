import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = path.join(root, '.data/models')
const output = path.join(root, 'public/models')
const foduuRevision = 'e75b840dc74b7d213833c4ef5cc1cea63c19e81d'
const swinRevision = '71e28a83cfb61f5dc95bafdeebf2815167914f2b'
const hf = (repo, revision, file) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`
const exists = async (file) => {
  try { await stat(file); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
async function hash(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
async function download(url, destination, expectedHash) {
  if (await exists(destination)) {
    if (expectedHash && await hash(destination) !== expectedHash) throw new Error(`Checksum mismatch: ${destination}. Remove that file and retry.`)
    return
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.part`
  console.log(`Downloading ${url}`)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${url}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
    if (expectedHash && await hash(temporary) !== expectedHash) throw new Error(`Downloaded checksum mismatch: ${url}`)
    await rename(temporary, destination)
  } finally {
    if (await exists(temporary)) await unlink(temporary)
  }
}
async function publish(source, name) {
  const sha256 = await hash(source)
  const file = `${name}-${sha256}.onnx`
  const destination = path.join(output, file)
  if (!await exists(destination) || await hash(destination) !== sha256) await copyFile(source, destination)
  return { file, sha256, bytes: (await stat(source)).size }
}

async function main() {
  await mkdir(output, { recursive: true })
  const checkpoint = path.join(cache, 'foduucom/Watermark_Removal/model.pth')
  const watermark = path.join(cache, 'foduucom/Watermark_Removal/model-fp16.onnx')
  const checkpointHash = 'dfceb0199f80877802c6f0c5abf412f39ee82a634cbbcf072d05ce7c06e33d3b'
  await download(hf('foduucom/Watermark_Removal', foduuRevision, 'model.pth'), checkpoint, checkpointHash)
  const exporter = path.join(root, 'scripts/export-watermark.py')
  const exporterHash = await hash(exporter)
  const requirementsHash = await hash(path.join(root, 'scripts/image-models-requirements.txt'))
  const receiptPath = `${watermark}.json`
  const receipt = await exists(receiptPath) ? JSON.parse(await readFile(receiptPath, 'utf8')) : null
  const currentHash = await exists(watermark) ? await hash(watermark) : null
  const validReceipt = receipt?.checkpointHash === checkpointHash && receipt?.exporterHash === exporterHash
    && receipt?.requirementsHash === requirementsHash && receipt?.sha256 === currentHash
  if (!validReceipt) {
    const localPython = path.join(root, '.venv/bin/python')
    const python = process.env.PYTHON || (await exists(localPython) ? localPython : 'python3')
    const result = spawnSync(python, [exporter, checkpoint, watermark], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('Watermark export failed. Install scripts/image-models-requirements.txt in your Python environment and retry.')
  }
  await writeFile(receiptPath, `${JSON.stringify({ checkpointHash, exporterHash, requirementsHash, sha256: await hash(watermark) }, null, 2)}\n`)
  const upscaler = path.join(cache, 'Xenova/swin2SR-classical-sr-x2-64/onnx/model.onnx')
  await download(hf('Xenova/swin2SR-classical-sr-x2-64', swinRevision, 'onnx/model.onnx'), upscaler, '6dde3fe2440543ccae7c40d175609f83c18aeaa3d8456745c4329ef97ae744bd')
  let previous
  const manifestPath = path.join(output, 'manifest.json')
  if (await exists(manifestPath)) previous = JSON.parse(await readFile(manifestPath, 'utf8'))
  const models = { watermark: await publish(watermark, 'watermark'), upscale: await publish(upscaler, 'upscale') }
  await copyFile(path.join(root, 'public/licenses/Apache-2.0.txt'), path.join(output, 'LICENSE-2.0.txt'))
  await writeFile(`${manifestPath}.part`, `${JSON.stringify({ version: 1, models }, null, 2)}\n`)
  await rename(`${manifestPath}.part`, manifestPath)
  for (const asset of Object.values(previous?.models ?? {})) {
    if (/^(watermark|upscale)-[a-f0-9]{64}\.onnx$/.test(asset.file) && !Object.values(models).some((current) => current.file === asset.file)) {
      const stale = path.join(output, asset.file)
      if (await exists(stale)) await unlink(stale)
    }
  }
  console.log('Prepared content-addressed image models and Apache-2.0 license in public/models.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
