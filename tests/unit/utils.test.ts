import { describe, expect, it } from 'vitest'
import { cn } from '../../src/lib/utils'

describe('cn', () => {
  it('joins class names and skips falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })

  it('lets later Tailwind classes override conflicting earlier ones', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })
})
