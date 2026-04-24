'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Square, Zap } from 'lucide-react'
import type { SearchConfig } from '@/lib/types'

interface RunSearchPanelProps {
  configs:          SearchConfig[]
  runningConfigIds: Set<string>
  runSearch:        (configId: string, configName: string, opts?: { switchToRunsTab?: boolean }) => Promise<void>
  stopSearch:       (configId: string) => Promise<void>
}

export function RunSearchPanel({ configs, runningConfigIds, runSearch, stopSearch }: RunSearchPanelProps) {
  const [open, setOpen]             = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')

  const effectiveId = selectedId || configs[0]?.id || ''
  const running     = runningConfigIds.has(effectiveId)

  function handleStart() {
    if (!effectiveId) return
    const name = configs.find((c) => c.id === effectiveId)?.name ?? 'search'
    setOpen(false)
    void runSearch(effectiveId, name)
  }

  function handleStop() {
    if (!effectiveId) return
    void stopSearch(effectiveId)
  }

  return (
    <div className="relative flex items-center gap-2">
      {running ? (
        <Button variant="destructive" className="gap-2" onClick={handleStop}>
          <Square className="h-4 w-4 fill-current" /> Stop Search
        </Button>
      ) : (
        <Button
          onClick={() => setOpen((v) => !v)}
          className="gap-2"
          disabled={configs.length === 0}
          title={configs.length === 0 ? 'Create a search config first' : undefined}
        >
          <Play className="h-4 w-4" /> Run Search
        </Button>
      )}

      {running && (
        <span className="flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
      )}

      {open && !running && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-background border rounded-lg shadow-lg p-4 z-10 space-y-3">
          <p className="text-sm font-medium">Choose a search config to run</p>

          <select
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={effectiveId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.keywords.slice(0, 3).join(', ')}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <Button onClick={handleStart} size="sm" className="gap-1 flex-1">
              <Zap className="h-3.5 w-3.5" /> Start
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Search runs take 30–90 seconds. Results appear in the Jobs tab when complete.
          </p>
        </div>
      )}
    </div>
  )
}
