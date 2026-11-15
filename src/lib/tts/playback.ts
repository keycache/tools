/**
 * Progressive playback of generated chunks (docs/SPECIFICATIONS.md §S7). Generation is slower than playback
 * (S0: ~1.5–1.8× real time), so playing the first chunk right away would stall before every later one. The planner
 * picks the earliest start that keeps every chunk ready before it's due; the player schedules chunks back to back on
 * one AudioContext and records any stall that happens anyway.
 */

/** S0: 4.64 s / 69 chars, 9.28 s / 147 chars. */
export const SECONDS_PER_CHAR = 0.066
/** Generation time ÷ audio length before any chunk has been measured (S0/S3: 1.45–1.8). */
export const DEFAULT_RTF = 1.7
/** Extra slack on the start time, for jitter in chunk generation times. */
export const START_MARGIN_SECONDS = 0.5

export interface PlannedChunk {
  /** Seconds of silence before this chunk (0 for the first). */
  pause: number
  /** Known once generated. */
  done?: { seconds: number; /** Seconds since generation started. */ readyAt: number; genSeconds: number }
  /** For chunks not generated yet. */
  chars: number
}

/** Measured generation time ÷ audio length over finished chunks, else DEFAULT_RTF. */
export function measuredRtf(chunks: PlannedChunk[]): number {
  let gen = 0
  let audio = 0
  for (const c of chunks) {
    if (!c.done) continue
    gen += c.done.genSeconds
    audio += c.done.seconds
  }
  return audio > 0 ? gen / audio : DEFAULT_RTF
}

/**
 * Earliest playback start (seconds after generation started) such that every chunk is projected to be ready by the
 * time playback reaches it: D ≥ ready(k) − position(k) for all k, where position(k) is where chunk k starts in the
 * joined audio. Finished chunks use their real ready time and length; later ones are projected from the text length
 * and the measured RTF, generated one after another starting when the last finished chunk was ready.
 */
export function playbackStartDelay(chunks: PlannedChunk[], margin = START_MARGIN_SECONDS): number {
  const rtf = measuredRtf(chunks)
  let ready = 0
  let position = 0
  let delay = 0
  for (const [i, c] of chunks.entries()) {
    const seconds = c.done ? c.done.seconds : c.chars * SECONDS_PER_CHAR
    ready = c.done ? c.done.readyAt : ready + rtf * seconds
    if (i > 0) position += c.pause
    delay = Math.max(delay, ready - position)
    position += seconds
  }
  return delay + (chunks.length > 1 ? margin : 0)
}

/** Schedules chunks back to back (with pauses) on one AudioContext; chunks may be added while playing. */
export class SpeechPlayer {
  private ctx: AudioContext
  private queue: { pcm: Float32Array; pause: number }[] = []
  private sources: AudioBufferSourceNode[] = []
  private nextAt = 0
  private scheduled = 0
  private started = false
  private closed = false
  /** Times playback had to wait for a chunk that wasn't ready (a gap longer than the planned pause). */
  stalls = 0
  stallSeconds = 0
  onEnded?: () => void
  private readonly sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.ctx = new AudioContext({ sampleRate })
  }

  /** Call from the click handler that starts generation, so the browser allows audio. */
  unlock(): void {
    void this.ctx.resume().catch(() => {})
  }

  get isStarted(): boolean {
    return this.started
  }

  /** Seconds of audio scheduled but not yet played. */
  get buffered(): number {
    return this.started ? Math.max(0, this.nextAt - this.ctx.currentTime) : 0
  }

  push(pcm: Float32Array, pause: number): void {
    if (this.closed) return
    this.queue.push({ pcm, pause })
    if (this.started) this.flush()
  }

  start(): void {
    if (this.started || this.closed) return
    this.started = true
    void this.ctx.resume().catch(() => {})
    this.nextAt = this.ctx.currentTime + 0.05
    this.flush()
  }

  private flush(): void {
    for (const { pcm, pause } of this.queue) {
      const due = this.nextAt + (this.scheduled === 0 ? 0 : pause)
      const at = Math.max(due, this.ctx.currentTime + 0.02)
      if (this.scheduled > 0 && at - due > 0.02) {
        this.stalls++
        this.stallSeconds += at - due
      }
      const buffer = this.ctx.createBuffer(1, pcm.length, this.sampleRate)
      buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
      const src = this.ctx.createBufferSource()
      src.buffer = buffer
      src.connect(this.ctx.destination)
      src.onended = () => {
        this.sources = this.sources.filter((s) => s !== src)
        if (!this.sources.length && !this.queue.length) this.onEnded?.()
      }
      src.start(at)
      this.sources.push(src)
      this.nextAt = at + buffer.duration
      this.scheduled++
    }
    this.queue = []
  }

  stop(): void {
    if (this.closed) return
    this.closed = true
    for (const s of this.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.sources = []
    this.queue = []
    void this.ctx.close().catch(() => {})
  }
}
