// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ASSETS } from '@/lib/cactus/assets'
import { CACTUS_SPEECH, CACTUS_TEXT, CACTUS_VISION, CactusEngine, withDateFact, type CactusModule } from '@/lib/cactus/engine'
import { EXTRACT_PRESETS, SCENE_FORM, TOOL_PRESETS } from '@/lib/cactus/presets'

const DIR = path.resolve(import.meta.dirname, '../../public/models/cactus')
const read = (file: string) => new Uint8Array(readFileSync(path.join(DIR, file)))

let engine: CactusEngine

beforeAll(async () => {
  // package.json is "type": "module", so Node won't treat cactus.js as CommonJS; evaluate it as such.
  const source = readFileSync(path.join(DIR, 'cactus.js'), 'utf8')
  const factory = new Function('module', 'exports', 'require', '__dirname', '__filename', `${source}\nreturn createCactus`)
  const createCactus = factory({}, {}, createRequire(import.meta.url), DIR, path.join(DIR, 'cactus.js')) as (o: {
    wasmBinary: Uint8Array
  }) => Promise<CactusModule>
  engine = new CactusEngine(await createCactus({ wasmBinary: read('cactus.wasm') }))
}, 60_000)

describe('deployed assets', () => {
  it('match the sizes recorded in the asset registry', () => {
    for (const asset of Object.values(ASSETS)) expect(readFileSync(path.join(DIR, asset.file)).byteLength, asset.file).toBe(asset.bytes)
  })
})

describe('CactusEngine (real wasm)', () => {
  it('loads all three models side by side', () => {
    expect(engine.load(read(ASSETS.needle.file))).toBe(CACTUS_TEXT)
    expect(engine.load(read(ASSETS.whistle.file))).toBe(CACTUS_TEXT | CACTUS_SPEECH)
    expect(engine.load(read(ASSETS.mirage.file))).toBe(CACTUS_TEXT | CACTUS_SPEECH | CACTUS_VISION)
  }, 60_000)

  it('turns a request into ordered tool calls', () => {
    const r = engine.complete({
      system: withDateFact(''),
      tools: TOOL_PRESETS[0].tools,
      text: 'turn off the kitchen lights and set a 10 minute timer',
    })
    expect(r.function_calls.map((c) => c.name)).toEqual(['set_lights', 'set_timer'])
    expect(r.function_calls[0].arguments).toMatchObject({ room: 'kitchen', on: false })
    expect(r.function_calls[1].arguments).toMatchObject({ minutes: 10 })
  }, 30_000)

  it('is stateless between turns', () => {
    const tools = TOOL_PRESETS[0].tools
    engine.complete({ tools, text: 'lock the front door' })
    const r = engine.complete({ tools, text: 'set the heating to 21 degrees' })
    expect(r.function_calls.map((c) => c.name)).toEqual(['set_thermostat'])
  }, 30_000)

  it('extracts structured fields with a single-tool schema', () => {
    const preset = EXTRACT_PRESETS.find((p) => p.id === 'receipt')!
    const r = engine.complete({ tools: [preset.schema], text: preset.sample })
    const args = (r.function_calls[0] ?? r.suppressed_calls?.[0])?.arguments
    expect(args).toMatchObject({ amount: 23.8 })
    expect(String(args?.merchant)).toMatch(/blue bottle/i)
  }, 30_000)

  it('extracts every preset shape from its sample text', () => {
    for (const preset of EXTRACT_PRESETS) {
      const r = engine.complete({ system: withDateFact(''), tools: [preset.schema], text: preset.sample })
      const args = (r.function_calls[0] ?? r.suppressed_calls?.[0])?.arguments
      expect(args, `${preset.id}: ${r.reasoning}`).toBeTruthy()
      for (const key of preset.schema.parameters.required ?? []) expect(args, `${preset.id}.${key}`).toHaveProperty(key)
    }
  }, 60_000)

  it('returns an empty transcript for silence', () => {
    const r = engine.transcribe(new Float32Array(16_000), { wordTimestamps: true })
    expect(r.text).toBe('')
  }, 30_000)

  it('describes an image and fills a form', () => {
    const width = 64
    const height = 48
    const rgb = new Uint8Array(width * height * 3).fill(200)
    const described = engine.describe(rgb, width, height)
    expect(described).toHaveProperty('objects')

    const form = SCENE_FORM
    const filled = engine.describe(rgb, width, height, { form }) as { form: Record<string, { value: unknown; probabilities?: Record<string, number> }> }
    expect(Object.keys(filled.form)).toEqual(Object.keys(form))
    expect(['indoor', 'outdoor', '-', null]).toContain(filled.form.setting.value)
  }, 60_000)

  it('rejects mismatched RGB buffers', () => {
    expect(() => engine.describe(new Uint8Array(5), 2, 2)).toThrow(/width \* height \* 3/)
  })
})

describe('withDateFact', () => {
  const now = new Date(2026, 10, 11, 20, 5)
  it('prefixes the local date', () => {
    expect(withDateFact('', now)).toBe('date: 2026-11-11 Wed 20:05')
    expect(withDateFact('Be brief', now)).toBe('date: 2026-11-11 Wed 20:05; Be brief')
  })
  it('keeps a caller-supplied date', () => {
    expect(withDateFact('date: 2020-01-01', now)).toBe('date: 2020-01-01')
  })
})
