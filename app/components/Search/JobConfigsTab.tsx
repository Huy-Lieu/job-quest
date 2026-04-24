'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Play, Pencil, Copy, Trash2, MapPin, Building2, Clock, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { SearchConfig } from '@/lib/types'
import { toast } from 'sonner'
import { NewConfigForm } from '@/app/components/Search/NewConfigForm'
import { SOURCE_LABELS, SOURCE_COLORS, AVAILABLE_SOURCES } from '@/app/dashboard/jobs/constants'

interface JobConfigsTabProps {
  configs: SearchConfig[]
  loadingConfigs: boolean
  runningConfigIds: Set<string>
  editingConfig: SearchConfig | null
  setEditingConfig: (c: SearchConfig | null) => void
  onConfigSaved: (c: SearchConfig) => void
  runSearch: (configId: string, name: string, opts?: { switchToRunsTab?: boolean }) => void
  duplicateConfig: (c: SearchConfig) => void
  onDeleteConfig: (id: string) => void
}

export function JobConfigsTab({
  configs,
  loadingConfigs,
  runningConfigIds,
  editingConfig,
  setEditingConfig,
  onConfigSaved,
  runSearch,
  duplicateConfig,
  onDeleteConfig,
}: JobConfigsTabProps) {
  const [createdConfigs, setCreatedConfigs] = useState<SearchConfig[]>([])

  return (
    <div className="space-y-4">
      <NewConfigForm onCreated={(c) => {
        setCreatedConfigs((prev) => [c, ...prev])
      }} />

      {loadingConfigs ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading configs…
        </div>
      ) : configs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Settings2 className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
            <p className="font-semibold">No search configs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a config above to define which jobs Claude should search and score for you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <Card key={config.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{config.name ?? config.keywords.slice(0, 3).join(', ')}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {config.keywords.map((k) => <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>)}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {config.locations.length > 0 && (
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{config.locations.join(', ')}</span>
                      )}
                      {config.target_companies.length > 0 && (
                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />
                          {config.target_companies.slice(0, 3).join(', ')}
                          {config.target_companies.length > 3 && ` +${config.target_companies.length - 3}`}
                        </span>
                      )}
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{config.schedule_interval}</span>
                      {config.last_run_at && (
                        <span>Last run {new Date(config.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {config.sources.map((s) => (
                        <span key={s} className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[s] ?? 'bg-gray-100 text-gray-600'}`}>
                          {SOURCE_LABELS[s]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" className="gap-1" disabled={runningConfigIds.has(config.id)}
                      onClick={() => runSearch(config.id, config.name ?? 'search', { switchToRunsTab: true })}>
                      {runningConfigIds.has(config.id)
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
                        : <><Play className="h-3.5 w-3.5" /> Run now</>}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingConfig(config)} title="Edit" aria-label="Edit config">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground"
                      onClick={() => duplicateConfig(config)} title="Duplicate" aria-label="Duplicate config">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-500"
                      onClick={() => onDeleteConfig(config.id)}
                      title="Delete" aria-label="Delete config">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editingConfig && (
        <NewConfigForm mode="edit" initialValues={editingConfig} onSaved={onConfigSaved} onClose={() => setEditingConfig(null)} />
      )}
    </div>
  )
}
