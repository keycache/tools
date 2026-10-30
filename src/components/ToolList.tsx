import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TOOLS } from '@/tools'

export function ToolList() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 sm:grid-cols-2">
      {TOOLS.map((tool) => (
        <a key={tool.id} href={`#/${tool.id}`} className="block">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>{tool.name}</CardTitle>
              <CardDescription>{tool.description}</CardDescription>
            </CardHeader>
          </Card>
        </a>
      ))}
    </div>
  )
}
