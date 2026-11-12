import type { ModelId, Progress } from './assets'
import type { AudioOptions, CompleteRequest, CompleteResult, DescribeResult, TranscribeResult } from './engine'

export type WorkerRequest =
  | { id: number; type: 'load'; model: ModelId }
  | { id: number; type: 'complete'; req: CompleteRequest }
  | { id: number; type: 'transcribe'; pcm: Float32Array; opts: AudioOptions }
  | {
      id: number
      type: 'describe'
      rgb: Uint8Array
      width: number
      height: number
      options: Record<string, unknown>
      language?: string | null
    }

export type WorkerResult = {
  load: { models: number }
  complete: CompleteResult
  transcribe: TranscribeResult
  describe: DescribeResult
}

export type WorkerResponse =
  | { id: number; type: 'ok'; result: unknown; ms: number }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'progress'; model: ModelId; progress: Progress }
