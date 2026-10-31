import { describe, expect, it } from 'vitest'
import { v1, v3, v4, v5, v6, v7 } from 'uuid'

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('UUID Generation', () => {
  it('generates valid v1 UUID', () => {
    const id = v1()
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates valid v3 UUID', () => {
    const id = v3('example.com', NAMESPACE_DNS)
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates valid v4 UUID', () => {
    const id = v4()
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates valid v5 UUID', () => {
    const id = v5('example.com', NAMESPACE_DNS)
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates valid v6 UUID', () => {
    const id = v6()
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates valid v7 UUID', () => {
    const id = v7()
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates different UUIDs on repeated calls for random versions (v4)', () => {
    const id1 = v4()
    const id2 = v4()
    expect(id1).not.toBe(id2)
  })

  it('generates consistent UUIDs for same namespace and name (v5)', () => {
    const id1 = v5('example.com', NAMESPACE_DNS)
    const id2 = v5('example.com', NAMESPACE_DNS)
    expect(id1).toBe(id2)
  })

  it('generates different UUIDs for different names (v5)', () => {
    const id1 = v5('example.com', NAMESPACE_DNS)
    const id2 = v5('different.com', NAMESPACE_DNS)
    expect(id1).not.toBe(id2)
  })
})
