import { useState } from 'react'
import { Ear, Eye, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActTab } from '@/components/edge-ai/ActTab'
import { ListenTab } from '@/components/edge-ai/ListenTab'
import { ModelGate } from '@/components/edge-ai/ModelGate'
import { SeeTab } from '@/components/edge-ai/SeeTab'
import { isCacheSupported, type ModelId } from '@/lib/cactus/assets'
import { useCacheInfo } from '@/lib/cactus/client'
import { formatBytes } from '@/lib/cactus/media'

type TabId = 'act' | 'listen' | 'see'

const TABS: { id: TabId; label: string; model: ModelId; icon: typeof Wand2 }[] = [
  { id: 'act', label: 'Act', model: 'needle', icon: Wand2 },
  { id: 'listen', label: 'Listen', model: 'whistle', icon: Ear },
  { id: 'see', label: 'See', model: 'mirage', icon: Eye },
]

export function EdgeAiStudioTool() {
  const [active, setActive] = useState<TabId>('act')
  const cache = useCacheInfo()

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Tiny AI models running entirely in your browser via WebAssembly. Turn requests into tool calls, transcribe speech,
        and understand images — no server, no uploads, works offline once downloaded.
      </p>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Edge AI Studio tasks">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            role="tab"
            id={`edge-tab-${id}`}
            aria-selected={active === id}
            aria-controls={`edge-panel-${id}`}
            variant={active === id ? 'default' : 'outline'}
            onClick={() => setActive(id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {isCacheSupported() ? (
            <>
              <span>Stored in browser: {formatBytes(cache.bytes)}</span>
              {cache.bytes > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1"
                  onClick={() => {
                    if (confirm('Remove downloaded models from browser storage? Models already loaded stay usable on this page.')) void cache.clear()
                  }}
                >
                  <Trash2 /> Clear
                </Button>
              )}
            </>
          ) : (
            <span>Browser storage unavailable here (needs HTTPS) — models will re-download.</span>
          )}
        </div>
      </div>

      {/* Panels stay mounted so each tab keeps its inputs and results when switching. */}
      {TABS.map(({ id, model }) => (
        <div key={id} role="tabpanel" id={`edge-panel-${id}`} aria-labelledby={`edge-tab-${id}`} hidden={active !== id} className="space-y-5">
          <ModelGate model={model} active={active === id} cached={cache.cached} />
          {id === 'act' && <ActTab />}
          {id === 'listen' && <ListenTab />}
          {id === 'see' && <SeeTab />}
        </div>
      ))}
    </div>
  )
}
