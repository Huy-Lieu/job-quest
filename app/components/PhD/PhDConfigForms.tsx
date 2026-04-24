'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Loader2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import type { SearchConfig } from '@/lib/types'

interface RunSearchPanelProps {
  configs:       SearchConfig[]
  onRunComplete: () => void
}

export function RunSearchPanel({ configs, onRunComplete }: RunSearchPanelProps) {
  const [running, setRunning]       = useState<string | null>(null)
  const [open, setOpen]             = useState(false)

  async function runSearch(config: SearchConfig) {
    setRunning(config.id)
    setOpen(false)
    const tid = toast.loading(`Running ${config.name ?? config.id}…`, { duration: Infinity })
    try {
      const res = await fetch('/api/search/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId: config.id }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        toast.error(`Search failed: ${(d as { error?: string }).error ?? 'Unknown error'}`, { id: tid, duration: 6000 })
        return
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const pl = JSON.parse(line.slice(6)) as { stage?: string; found?: number; unique?: number; scored?: number }
            if (pl.stage === 'complete') {
              toast.success(`Done — ${pl.found ?? 0} found · ${pl.unique ?? 0} new · ${pl.scored ?? 0} scored`, { id: tid, duration: 5000 })
              onRunComplete()
              return
            }
          } catch { /* ignore */ }
        }
      }
    } catch { toast.error('Network error', { id: tid, duration: 6000 }) }
    finally { setRunning(null) }
  }

  if (configs.length === 0) return null

  if (configs.length === 1) {
    const c = configs[0]
    return (
      <Button onClick={() => runSearch(c)} disabled={!!running} className="gap-2">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {running ? 'Running…' : `Run ${c.name ?? 'Search'}`}
      </Button>
    )
  }

  return (
    <div className="relative">
      <Button onClick={() => setOpen((o) => !o)} disabled={!!running} className="gap-2">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {running ? 'Running…' : 'Run Search'} <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-background border rounded-md shadow-lg min-w-[180px]">
          {configs.map((c) => (
            <button
              key={c.id}
              onClick={() => runSearch(c)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              {c.name ?? c.id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
