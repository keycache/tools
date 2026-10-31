// Web Audio API utility functions for sound generation

export function playAlarmSound() {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContext) return

  const ctx = new AudioContext()
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'square'
  osc.frequency.setValueAtTime(880, now) // High pitch (A5 note)

  gain.gain.setValueAtTime(0, now)

  // First Beep
  gain.gain.setValueAtTime(0.3, now + 0.05)
  gain.gain.setValueAtTime(0, now + 0.20)

  // Second Beep
  gain.gain.setValueAtTime(0.3, now + 0.30)
  gain.gain.setValueAtTime(0, now + 0.45)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.5)
}

export function playBeepSound(duration: number = 0.5, frequency: number = 800) {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContext) return

  const ctx = new AudioContext()
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, now)
  gain.gain.setValueAtTime(0.2, now)
  gain.gain.exponentialRampToValueAtTime(0.01, now + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + duration)
}

// Helper to loop any sound for 60 seconds
function playLoopedSound(soundFn: () => void, durationMs: number = 60000): { stop: () => void } {
  let isPlaying = true
  let soundInterval: ReturnType<typeof setInterval> | null = null
  let soundStopTimer: ReturnType<typeof setTimeout> | null = null

  const play = () => {
    if (isPlaying) {
      soundFn()
    }
  }

  const stopSound = () => {
    isPlaying = false
    
    if (soundInterval) {
      clearInterval(soundInterval)
      soundInterval = null
    }
    
    if (soundStopTimer) {
      clearTimeout(soundStopTimer)
      soundStopTimer = null
    }
  }

  // Start playing immediately
  play()

  // Play every 500ms (alarm sound is ~500ms long, timer beep is ~300ms)
  soundInterval = setInterval(play, 500)

  // Stop after 60 seconds
  soundStopTimer = setTimeout(stopSound, durationMs)

  return { stop: stopSound }
}

// Play sound by ID - used for selected sound preference
export function playSoundById(soundId: string): { stop: () => void } {
  switch (soundId) {
    case 'alarm':
      return playLoopedSound(() => playAlarmSound())
    case 'beep':
      return playLoopedSound(() => playBeepSound(0.5, 800))
    case 'high-beep':
      return playLoopedSound(() => playBeepSound(0.5, 1200))
    case 'timer-complete':
      return playLoopedSound(() => playTimerCompleteSound())
    case 'timer-looped':
      return playTimerCompleteSoundLooped()
    default:
      return playLoopedSound(() => playAlarmSound())
  }
}

export function playTimerCompleteSound() {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContext) return

  const ctx = new AudioContext()
  const now = ctx.currentTime

  // Play a ascending beep pattern
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(700 + i * 200, now + i * 0.2)

    gain.gain.setValueAtTime(0.3, now + i * 0.2)
    gain.gain.setValueAtTime(0, now + i * 0.2 + 0.15)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now + i * 0.2)
    osc.stop(now + i * 0.2 + 0.15)
  }
}

export function playTimerCompleteSoundLooped() {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext
  
  let ctx: AudioContext | null = null
  let soundStopTimer: ReturnType<typeof setTimeout> | null = null
  let soundInterval: ReturnType<typeof setInterval> | null = null
  let isPlaying = false
  let masterGain: GainNode | null = null
  let contextClosed = false

  if (!AudioContext) {
    return {
      stop: () => {
        // noop
      },
    }
  }

  const playBeepSequence = () => {
    if (!ctx) {
      ctx = new AudioContext()
      masterGain = ctx.createGain()
      masterGain.connect(ctx.destination)
    }

    if (contextClosed || !isPlaying) {
      return
    }

    const now = ctx.currentTime

    // Play ascending beep pattern (3 beeps)
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(700 + i * 200, now + i * 0.2)

      gain.gain.setValueAtTime(0.3, now + i * 0.2)
      gain.gain.setValueAtTime(0, now + i * 0.2 + 0.15)

      osc.connect(gain)
      gain.connect(masterGain!)

      osc.start(now + i * 0.2)
      osc.stop(now + i * 0.2 + 0.15)
    }
  }

  const startLoopedSound = () => {
    isPlaying = true
    const durationMs = 60000 // 60 seconds
    const intervalMs = 600 // Play beep sequence every 600ms

    playBeepSequence()

    soundInterval = setInterval(() => {
      if (isPlaying && ctx && ctx.state === 'running' && !contextClosed) {
        playBeepSequence()
      }
    }, intervalMs)

    // Stop after 60 seconds
    soundStopTimer = setTimeout(() => {
      stopSound()
    }, durationMs)
  }

  const stopSound = () => {
    isPlaying = false
    
    // Clear the interval FIRST - prevent new sounds from being scheduled
    if (soundInterval) {
      clearInterval(soundInterval)
      soundInterval = null
    }
    
    // Clear the timeout
    if (soundStopTimer) {
      clearTimeout(soundStopTimer)
      soundStopTimer = null
    }
    
    // Close the context immediately - this stops all audio
    if (ctx && ctx.state !== 'closed' && !contextClosed) {
      try {
        contextClosed = true
        ctx.close()
      } catch (e) {
        // Already closed or error closing
      }
    }
    
    ctx = null
    masterGain = null
  }

  startLoopedSound()

  // Return a function to manually stop the sound
  return {
    stop: stopSound,
  }
}
