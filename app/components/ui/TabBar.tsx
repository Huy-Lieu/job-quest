import { Button } from '@/components/ui/button'

interface TabBarProps {
  tabs: string[]
  activeTab: string
  onChange: (tab: string) => void
  className?: string
}

export function TabBar({ tabs, activeTab, onChange, className = '' }: TabBarProps) {
  return (
    <div className={`flex gap-1 bg-muted p-1 rounded-lg w-fit ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab
        return (
          <Button
            key={tab}
            variant={isActive ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onChange(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </Button>
        )
      })}
    </div>
  )
}
