import { ArrowLeft } from 'lucide-react'
import { useHashRoute } from '@/lib/useHashRoute'
import { TOOLS } from '@/tools'
import { Hero } from '@/components/Hero'
import { ToolList } from '@/components/ToolList'

function App() {
  const route = useHashRoute()
  const tool = TOOLS.find((t) => t.id === route)

  if (tool) {
    const Tool = tool.component
    if (tool.layout === 'full-height') {
      return (
        <main className="flex h-screen supports-[height:100dvh]:h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
          <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
            <a href="#/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> All tools
            </a>
            <h1 className="text-lg font-semibold">{tool.name}</h1>
          </header>
          <div className="min-h-0 flex-1">
            <Tool />
          </div>
        </main>
      )
    }

    return (
      <main className="mx-auto max-w-6xl space-y-6 p-4">
        <a
          href="#/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All tools
        </a>
        <h1 className="text-2xl font-semibold">{tool.name}</h1>
        <Tool />
      </main>
    )
  }

  return (
    <main className="pb-16">
      <Hero />
      <ToolList />
    </main>
  )
}

export default App
