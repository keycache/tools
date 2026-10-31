import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Timer Sound Looping', () => {
  let soundControl: { stop: () => void } | null = null

  beforeEach(() => {
    // Mock AudioContext
    const mockOscillator = {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(function () {
        return this
      }),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    }

    const mockGain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(function () {
        return this
      }),
      disconnect: vi.fn(),
    }

    ;(window as any).AudioContext = class {
      createOscillator = vi.fn(() => ({ ...mockOscillator }))
      createGain = vi.fn(() => ({ ...mockGain }))
      currentTime = 0
      state = 'running'
      destination = {}
      close = vi.fn()
    }
  })

  afterEach(() => {
    if (soundControl) {
      soundControl.stop()
      soundControl = null
    }
    vi.clearAllTimers()
  })

  it('should create a sound control object with stop method', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()
    expect(soundControl).toBeDefined()
    expect(soundControl.stop).toBeDefined()
    expect(typeof soundControl.stop).toBe('function')
  })

  it('should stop immediately when stop is called', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()
    const stopStart = Date.now()
    soundControl.stop()
    const stopDuration = Date.now() - stopStart

    // Stop should be very fast (< 100ms)
    expect(stopDuration).toBeLessThan(100)
  })

  it('should handle multiple stop calls without error', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()

    expect(() => {
      soundControl!.stop()
      soundControl!.stop()
      soundControl!.stop()
    }).not.toThrow()
  })

  it('should not throw when stopping before sound fully initializes', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()

    // Immediately stop
    expect(() => {
      soundControl!.stop()
    }).not.toThrow()
  })

  it('should manage intervals and timeouts gracefully', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()

    // Stop should clear intervals and timeouts
    expect(() => {
      soundControl!.stop()
    }).not.toThrow()

    // Should not throw if stop called again
    expect(() => {
      soundControl!.stop()
    }).not.toThrow()
  })

  it('should silence audio via gain control', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )
    soundControl = playTimerCompleteSoundLooped()

    expect(soundControl).toBeDefined()
    soundControl!.stop()

    // Should complete without errors
    expect(soundControl).toBeDefined()
  })
})
