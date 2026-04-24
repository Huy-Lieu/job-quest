'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Clock, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import type { SearchRun } from '@/lib/types'

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 text-green-500" />
  if (status === 'failed')   return <XCircle className="h-4 w-4 text-red-500" />
  return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
}

interface RunsTabProps {
  runs:        SearchRun[]
  loadingRuns: boolean
  fetchRuns:   () => void
}

export function RunsTab({ runs, loadingRuns, fetchRuns }: RunsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="gap-1" onClick={fetchRuns} disabled={loadingRuns}>
          <RefreshCw className={`h-3.5 w-3.5 ${loadingRuns ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {loadingRuns ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
        </div>
      ) : runs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
            <p className="font-semibold">No search runs yet</p>
            <p className="text-sm text-muted-foreground mt-1">Run a search to see results here.</p>
          </CardContent>
        </Card>
      ) : (
        runs.map((run) => (
          <Card key={run.id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <RunStatusIcon status={run.status} />
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {run.status}
                      {run.search_configs?.name ? ` — ${run.search_configs.name}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(run.started_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                      {run.completed_at && ` · ${Math.round(
                        (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000
                      )}s`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span><span className="font-medium text-foreground">{run.jobs_found}</span> found</span>
                  <span><span className="font-medium text-foreground">{run.jobs_new}</span> new</span>
                  <span><span className="font-medium text-foreground">{run.jobs_scored}</span> scored</span>
                </div>
              </div>
              {run.error_text && <p className="mt-2 text-xs text-red-500">{run.error_text}</p>}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
