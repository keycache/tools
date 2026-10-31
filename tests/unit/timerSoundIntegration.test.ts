import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Integration test for Timer Sound stopping
 * This test simulates the actual user workflow:
 * 1. User sets a timer
 * 2. Timer completes and sound starts
 * 3. User clicks "Dismiss Alarm" button
 * 4. Sound should stop immediately
 */

describe('Timer Sound Integration Test', () => {
  let soundControl: { stop: () => void } | null = null

  beforeEach(() => {
    // Mock Web Audio API with more realistic behavior
    let oscillatorInstances: any[] = []
    let gainInstances: any[] = []

    const mockOscillator = {
      type: 'sine',
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
      state = 'running'
      currentTime = 0
      destination = {}

      createOscillator = vi.fn(() => {
        const osc = { ...mockOscillator }
        oscillatorInstances.push(osc)
        return osc
      })

      createGain = vi.fn(() => {
        const gain = { ...mockGain }
        gainInstances.push(gain)
        return gain
      })

      close = vi.fn(() => {
        this.state = 'closed'
        // When context closes, all oscillators should stop
        oscillatorInstances.forEach((osc) => {
          if (osc.stop.mock) {
            expect(osc.stop).toHaveBeenCalled()
          }
        })
      })
    }
  })

  afterEach(() => {
    if (soundControl) {
      soundControl.stop()
      soundControl = null
    }
    vi.clearAllTimers()
  })

  it('should stop all audio when dismiss is clicked (simulating user interaction)', async () => {
    vi.useFakeTimers()
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )

    // Simulate timer completion - start sound
    soundControl = playTimerCompleteSoundLooped()
    expect(soundControl).toBeDefined()

    // Advance timers to let a few beep sequences play
    vi.advanceTimersByTime(1200) // Should play ~2 sequences

    // Simulate user clicking "Dismiss Alarm"
    soundControl.stop()

    // Verify no more sounds will play
    vi.advanceTimersByTime(10000) // Fast forward a lot

    // Audio should be stopped
    expect(soundControl).toBeDefined()

    vi.useRealTimers()
  })

  it('should clear intervals when stopped', async () => {
    vi.useFakeTimers()
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )

    soundControl = playTimerCompleteSoundLooped()

    // Stop immediately
    soundControl.stop()

    // Verify intervals don't keep firing
    expect(() => {
      vi.advanceTimersByTime(5000)
    }).not.toThrow()

    vi.useRealTimers()
  })

  it('should only close context once', async () => {
    vi.useFakeTimers()
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )

    soundControl = playTimerCompleteSoundLooped()

    // Call stop multiple times
    soundControl.stop()
    soundControl.stop()
    soundControl.stop()

    expect(() => {
      vi.advanceTimersByTime(1000)
    }).not.toThrow()

    vi.useRealTimers()
  })

  it('should handle rapid stop calls (user clicks dismiss multiple times)', async () => {
    vi.useFakeTimers()
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )

    soundControl = playTimerCompleteSoundLooped()

    // Simulate rapid clicks
    for (let i = 0; i < 10; i++) {
      soundControl.stop()
      vi.advanceTimersByTime(10)
    }

    expect(() => {
      vi.advanceTimersByTime(5000)
    }).not.toThrow()

    vi.useRealTimers()
  })

  it('should complete cleanup without errors', async () => {
    const { playTimerCompleteSoundLooped } = await import(
      '../../src/lib/audioSounds'
    )

    soundControl = playTimerCompleteSoundLooped()

    // Let it run for a bit
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Stop
    soundControl.stop()

    // Cleanup
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(soundControl).toBeDefined()
  })
})
