import { describe, expect, it } from 'vitest'
import {
  centeredRect,
  isValidRatio,
  moveRect,
  planRender,
  resizeFromCorner,
} from '../../src/lib/aspect'

describe('isValidRatio', () => {
  it('accepts positive finite numbers only', () => {
    expect(isValidRatio(16, 9)).toBe(true)
    expect(isValidRatio(0, 9)).toBe(false)
    expect(isValidRatio(-1, 9)).toBe(false)
    expect(isValidRatio(NaN, 9)).toBe(false)
  })
})

describe('centeredRect', () => {
  it('crops the sides of a wide image for a narrower ratio', () => {
    expect(centeredRect({ w: 2000, h: 1000 }, 1)).toEqual({ x: 500, y: 0, w: 1000, h: 1000 })
  })

  it('crops the top/bottom of a tall image for a wider ratio', () => {
    expect(centeredRect({ w: 1000, h: 2000 }, 1)).toEqual({ x: 0, y: 500, w: 1000, h: 1000 })
  })

  it('returns the whole image when the ratio already matches', () => {
    expect(centeredRect({ w: 1600, h: 900 }, 16 / 9)).toEqual({ x: 0, y: 0, w: 1600, h: 900 })
  })
})

describe('moveRect', () => {
  const bounds = { w: 100, h: 100 }
  it('moves within bounds', () => {
    expect(moveRect({ x: 10, y: 10, w: 20, h: 20 }, 5, -5, bounds)).toEqual({ x: 15, y: 5, w: 20, h: 20 })
  })

  it('clamps to the image edges', () => {
    expect(moveRect({ x: 10, y: 10, w: 20, h: 20 }, 500, -500, bounds)).toEqual({ x: 80, y: 0, w: 20, h: 20 })
  })
})

describe('resizeFromCorner', () => {
  const bounds = { w: 200, h: 100 }

  it('keeps the ratio and anchors the opposite corner', () => {
    const r = resizeFromCorner({ x: 10, y: 10 }, { x: 70, y: 40 }, 2, bounds)
    expect(r.x).toBe(10)
    expect(r.y).toBe(10)
    expect(r.w / r.h).toBeCloseTo(2)
  })

  it('does not grow past the image bounds', () => {
    const r = resizeFromCorner({ x: 150, y: 50 }, { x: 999, y: 999 }, 1, bounds)
    expect(r.x + r.w).toBeLessThanOrEqual(bounds.w)
    expect(r.y + r.h).toBeLessThanOrEqual(bounds.h)
  })

  it('grows toward the top-left when dragged past the anchor', () => {
    const r = resizeFromCorner({ x: 100, y: 80 }, { x: 40, y: 20 }, 1, bounds)
    expect(r.x + r.w).toBe(100)
    expect(r.y + r.h).toBeCloseTo(80)
  })

  it('respects the minimum width', () => {
    const r = resizeFromCorner({ x: 10, y: 10 }, { x: 11, y: 11 }, 1, bounds, 16)
    expect(r.w).toBe(16)
  })
})

describe('planRender', () => {
  const img = { w: 2000, h: 1000 }

  it('uses the crop box when present', () => {
    const plan = planRender(img, 1, { x: 10.4, y: 20.6, w: 300.2, h: 300.2 }, 'pad')
    expect(plan).toEqual({
      width: 300,
      height: 300,
      source: { x: 10, y: 21, w: 300, h: 300 },
      dest: { x: 0, y: 0, w: 300, h: 300 },
    })
  })

  it('center-crops with no box in crop mode', () => {
    const plan = planRender(img, 1, null, 'crop')
    expect([plan.width, plan.height]).toEqual([1000, 1000])
    expect(plan.source).toEqual({ x: 500, y: 0, w: 1000, h: 1000 })
  })

  it('pads to the smallest canvas containing the image', () => {
    const plan = planRender(img, 1, null, 'pad')
    expect([plan.width, plan.height]).toEqual([2000, 2000])
    expect(plan.dest).toEqual({ x: 0, y: 500, w: 2000, h: 1000 })
    expect(plan.source).toEqual({ x: 0, y: 0, w: 2000, h: 1000 })
  })

  it('stretches the full image keeping the width', () => {
    const plan = planRender(img, 1, null, 'stretch')
    expect([plan.width, plan.height]).toEqual([2000, 2000])
    expect(plan.dest).toEqual({ x: 0, y: 0, w: 2000, h: 2000 })
  })
})
