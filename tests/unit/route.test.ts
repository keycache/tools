import { describe, expect, it } from 'vitest'
import { parseHash } from '../../src/lib/route'

describe('parseHash', () => {
  it('returns an empty string for no route', () => {
    expect(parseHash('')).toBe('')
    expect(parseHash('#')).toBe('')
    expect(parseHash('#/')).toBe('')
  })

  it('extracts the tool id', () => {
    expect(parseHash('#/aspect-resize')).toBe('aspect-resize')
    expect(parseHash('#aspect-resize/')).toBe('aspect-resize')
  })
})
