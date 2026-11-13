import { useState } from 'react'
import { Ear, Eye, MessagesSquare, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActTab } from '@/components/edge-ai/ActTab'
import { ChatTab } from '@/components/edge-ai/ChatTab'
import { ListenTab } from '@/components/edge-ai/ListenTab'
import { CactusModelGate } from '@/components/edge-ai/ModelGate'
import { SeeTab } from '@/components/edge-ai/SeeTab'
import { StorageMenu } from '@/components/edge-ai/StorageMenu'
import { isCacheSupported, type ModelId } from '@/lib/cactus/assets'
import { useCacheInfo } from '@/lib/cactus/client'
import { useGemmaCache } from '@/lib/gemma/hooks'

type TabId = 'listen' | 'see' | 'act' | 'chat'

const TABS: { id: TabId; label: string; icon: typeof Wand2; model?: ModelId }[] = [
  { id: 'listen', label: 'Listen', model: 'whistle', icon: Ear },
  { id: 'see', label: 'See', model: 'mirage', icon: Eye },
  { id: 'act', label: 'Act', model: 'needle', icon: Wand2 },
  // Gemma runs on its own engine (Transformers.js); its gate lives inside ChatTab.
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
]

export function EdgeAiStudioTool() {
  const [active, setActive] = useState<TabId>(TABS[0].id)
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([TABS[0].id]))
  const cache = useCacheInfo()
  const gemmaCache = useGemmaCache()

  const open = (id: TabId) => {
    setActive(id)
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)))
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        AI models running entirely in your browser. Transcribe speech, understand images, turn requests into tool calls,
        and chat — no server, no uploads, works offline once downloaded.
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
            onClick={() => open(id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
        <div className="ml-auto">
          {isCacheSupported() ? (
            <StorageMenu
              entries={[
                { id: 'cactus', label: 'Listen · See · Act models', bytes: cache.bytes, clear: cache.clear },
                { id: 'gemma', label: 'Chat model (Gemma)', bytes: gemmaCache.bytes, clear: gemmaCache.clear },
              ]}
            />
          ) : (
            <span className="text-xs text-muted-foreground">Browser storage unavailable here (needs HTTPS) — models will re-download.</span>
          )}
        </div>
      </div>

      {/* Panels stay mounted so each tab keeps its inputs and results when switching. */}
      {TABS.map(({ id, model }) => (
        <div key={id} role="tabpanel" id={`edge-panel-${id}`} aria-labelledby={`edge-tab-${id}`} hidden={active !== id} className="space-y-5">
          {model && <CactusModelGate model={model} active={active === id} cached={cache.cached} />}
          {id === 'listen' && <ListenTab />}
          {id === 'see' && <SeeTab />}
          {id === 'act' && <ActTab />}
          {id === 'chat' && <ChatTab active={active === 'chat'} visited={visited.has('chat')} cache={gemmaCache} />}
        </div>
      ))}
    </div>
  )
}
