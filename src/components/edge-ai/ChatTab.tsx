import { Cpu } from 'lucide-react'
import { ModelGate, type ModelSource } from '@/components/edge-ai/ModelGate'
import { formatBytes } from '@/lib/cactus/media'
import { GEMMA_MODEL_ID, GEMMA_SIZES, gemmaTotalBytes } from '@/lib/gemma/constants'
import type { Capability } from '@/lib/gemma/capability'
import { useGemmaCapability, type GemmaCacheState } from '@/lib/gemma/hooks'

interface Props {
  /** Whether the Chat tab is visible (drives auto-load later). */
  active: boolean
  /** Becomes true the first time the tab is opened; capability detection only runs from then on. */
  visited: boolean
  cache: GemmaCacheState
}

export function ChatTab({ active, visited, cache }: Props) {
  const capability = useGemmaCapability(visited, cache.bytes)
  return (
    <>
      <ModelGate source={gemmaSource(capability)} active={active} />
      <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">Chat with Gemma is being built. The conversation view arrives next.</p>
        {capability && <DeviceSummary capability={capability} />}
      </div>
    </>
  )
}

function gemmaSource(capability: Capability | null): ModelSource {
  const dtype = capability?.dtype ?? 'q4f16'
  const base: ModelSource = {
    name: 'Gemma 4 E2B',
    blurb: 'Chat with text, images and audio. Runs on your GPU via WebGPU.',
    href: `https://huggingface.co/${GEMMA_MODEL_ID}`,
    sizeBytes: capability?.totalBytes || gemmaTotalBytes(dtype),
    sizeNote: `+${formatBytes(GEMMA_SIZES[dtype].audio)} for audio`,
    status: 'checking',
    cached: false,
    downloadBytes: capability?.downloadBytes ?? gemmaTotalBytes(dtype),
    origin: 'huggingface.co',
    unavailableNote: 'Model download arrives with the chat view in the next update.',
  }
  if (!capability) return base
  if (capability.unsupported) return { ...base, status: 'unsupported', unsupported: capability.unsupported }
  return { ...base, status: 'idle', cached: capability.downloadBytes === 0, blocked: capability.blocked }
}

function DeviceSummary({ capability: c }: { capability: Capability }) {
  const items = [
    `WebGPU ${c.webgpu ? '✓' : '✗'}`,
    c.webgpu && `16-bit floats ${c.shaderF16 ? '✓' : '✗'}`,
    c.dtype && `weights: ${c.dtype}`,
    c.storage && `storage free: ${formatBytes(Math.max(0, c.storage.quota - c.storage.usage))}`,
    c.storage && (c.storage.persisted ? 'persistent storage ✓' : 'persistent storage: not yet granted'),
  ].filter(Boolean) as string[]
  return (
    <p className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Cpu className="size-3.5" />
      {items.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </p>
  )
}
