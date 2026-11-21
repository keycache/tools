import { ChatTab } from '@/components/pocket-chat/ChatTab'
import { StorageMenu } from '@/components/edge-ai/StorageMenu'
import { isCacheSupported } from '@/lib/cactus/assets'
import { useChatStorage, useGemmaCache } from '@/lib/gemma/hooks'

export function PocketChatTool() {
  const gemmaCache = useGemmaCache()
  const chats = useChatStorage()

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {isCacheSupported() ? (
          <StorageMenu
            entries={[
              { id: 'gemma', label: 'Chat model (Gemma)', bytes: gemmaCache.bytes, clear: gemmaCache.clear },
              {
                id: 'chats',
                label: `Saved chats (${chats.conversations})`,
                bytes: chats.bytes,
                clear: chats.clear,
                preselect: false,
              },
            ]}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Browser storage unavailable here (needs HTTPS) — models will re-download.</span>
        )}
      </div>
      <ChatTab active visited cache={gemmaCache} />
    </div>
  )
}
