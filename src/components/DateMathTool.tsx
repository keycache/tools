import { useState } from 'react'
import { Calendar, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountTab } from '@/components/date/CountTab'
import { AddTab } from '@/components/date/AddTab'

type TabType = 'count' | 'add'

export function DateMathTool() {
  const [activeTab, setActiveTab] = useState<TabType>('count')

  const tabs = [
    { id: 'count' as TabType, label: 'Count', icon: Calendar },
    { id: 'add' as TabType, label: 'Add', icon: Plus },
  ]

  return (
    <div className="space-y-6">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <p className="text-muted-foreground">
          Calculate date differences, add/subtract days and weekdays, and work with date math
          effortlessly. All calculations are performed locally in your browser.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={activeTab === id ? 'default' : 'outline'}
            onClick={() => setActiveTab(id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'count' && <CountTab />}
      {activeTab === 'add' && <AddTab />}
    </div>
  )
}
