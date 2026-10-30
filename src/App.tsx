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
