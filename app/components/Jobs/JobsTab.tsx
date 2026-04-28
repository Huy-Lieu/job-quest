'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Briefcase, Loader2, RefreshCw, Trash2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { JobWithScore } from '@/lib/types'
import { SOURCE_LABELS, AVAILABLE_SOURCES } from '@/app/dashboard/jobs/constants'
import { JobListRow, JobDetailEmptyState } from '@/app/components/Jobs/JobListRow'
import { JobDetailPane } from '@/app/components/Jobs/JobDetailPane'

interface JobsTabProps {
  jobs:            JobWithScore[]
  total:           number
  offset:          number
  loadingJobs:     boolean
  jobsError:       string
  minScore:        number
  source:          string
  jobType:         string
  recommendedOnly: boolean
  selectedIds:     Set<string>
  bulkDeleting:    boolean
  activeJobId:     string | null
  detailOpenMobile: boolean
  hasConfigs:      boolean
  LIMIT:           number
  setMinScore:     (v: number) => void
  setSource:       (v: string) => void
  setJobType:      (v: string) => void
  setRecommendedOnly: (v: boolean) => void
  fetchJobs:       (offset?: number, append?: boolean) => void
  openJob:         (id: string) => void
  closeJobMobile:  () => void
  toggleSelect:    (id: string) => void
  clearSelection:  () => void
  deleteOne:       (id: string) => Promise<void>
  deleteBulk:      () => Promise<void>
  setTab:          (tab: 'jobs' | 'configs' | 'runs') => void
}

export function JobsTab({
  jobs, total, offset, loadingJobs, jobsError,
  minScore, source, jobType, recommendedOnly,
  selectedIds, bulkDeleting, activeJobId, detailOpenMobile, hasConfigs, LIMIT,
  setMinScore, setSource, setJobType, setRecommendedOnly,
  fetchJobs, openJob, closeJobMobile, toggleSelect, clearSelection,
  deleteOne, deleteBulk, setTab,
}: JobsTabProps) {
  const activeJob = activeJobId ? jobs.find((j) => j.id === activeJobId) ?? null : null
  const [listCollapsed, setListCollapsed] = useState(false)

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Min score</label>
          <input type="range" min={0} max={90} step={10} value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))} className="w-24" />
          <span className="text-xs w-7 text-center">{minScore}%</span>
        </div>
        <select className="border rounded-md px-2 py-1 text-xs bg-background" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {AVAILABLE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
        </select>
        <select className="border rounded-md px-2 py-1 text-xs bg-background" value={jobType} onChange={(e) => setJobType(e.target.value)}>
          <option value="">All types</option>
          <option value="full_time">Full-time</option>
          <option value="internship">Internship</option>
          <option value="contract">Contract</option>
          <option value="part_time">Part-time</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={recommendedOnly} onChange={(e) => setRecommendedOnly(e.target.checked)} className="rounded" />
          Recommended
        </label>
        <Button variant="ghost" size="sm" className="ml-auto gap-1 text-xs" onClick={() => fetchJobs(0)} disabled={loadingJobs}>
          <RefreshCw className={`h-3 w-3 ${loadingJobs ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {jobsError && <Alert variant="destructive"><AlertDescription>{jobsError}</AlertDescription></Alert>}

      {loadingJobs && !jobs.length && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading scored jobs…
        </div>
      )}

      {!loadingJobs && !jobs.length && !jobsError && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
            <p className="font-semibold">No jobs yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Click <strong>Run Search</strong> to trigger your first scrape. Upload a resume to get AI fit scores.
            </p>
            {!hasConfigs && (
              <p className="text-sm text-muted-foreground mt-2">
                You need a <button className="underline" onClick={() => setTab('configs')}>search config</button> first.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {jobs.length > 0 && (
        <>
          {/* Selection bar / job count row — includes collapse toggle on desktop */}
          <div className="flex items-center justify-between">
            {selectedIds.size > 0 ? (
              <div className="flex items-center justify-between w-full rounded-lg border border-primary/40 bg-primary/5 px-4 py-2">
                <p className="text-sm font-medium">{selectedIds.size} selected</p>
                <div className="flex items-center gap-2">
                  <Button variant="destructive" size="sm" onClick={deleteBulk} disabled={bulkDeleting} className="gap-1">
                    {bulkDeleting
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Removing…</>
                      : <><Trash2 className="h-3.5 w-3.5" /> Remove {selectedIds.size}</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>Cancel</Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{total} jobs found</p>
            )}

            {/* Collapse toggle — desktop only */}
            <button
              onClick={() => setListCollapsed(c => !c)}
              className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-3 flex-shrink-0"
              title={listCollapsed ? 'Show job list' : 'Hide job list'}
            >
              {listCollapsed
                ? <><PanelLeftOpen className="h-4 w-4" /> Show list</>
                : <><PanelLeftClose className="h-4 w-4" /> Hide list</>
              }
            </button>
          </div>

          {/* Desktop split layout */}
          <div className={`hidden lg:grid gap-4 h-[calc(100vh-280px)] min-h-[520px] transition-all duration-300 ${
            listCollapsed
              ? 'grid-cols-[0px_1fr]'
              : 'grid-cols-[minmax(320px,36%)_1fr]'
          }`}>
            {/* Left panel — job list */}
            <div className={`rounded-lg border overflow-hidden flex flex-col transition-all duration-300 ${
              listCollapsed ? 'opacity-0 pointer-events-none border-0' : 'opacity-100'
            }`}>
              <div className="flex-1 overflow-y-auto">
                {jobs.map((job) => (
                  <JobListRow key={job.id} job={job} active={activeJobId === job.id}
                    selected={selectedIds.has(job.id)} onOpen={openJob}
                    onToggleSelect={toggleSelect} onDelete={deleteOne} />
                ))}
              </div>
            </div>

            {/* Right panel — job detail (full width when list collapsed) */}
            <div className="rounded-lg border overflow-hidden">
              {activeJob
                ? <JobDetailPane job={activeJob} onDelete={deleteOne} />
                : <JobDetailEmptyState />
              }
            </div>
          </div>

          {/* Mobile layout */}
          <div className="lg:hidden rounded-lg border overflow-hidden">
            {jobs.map((job) => (
              <JobListRow key={job.id} job={job} active={activeJobId === job.id}
                selected={selectedIds.has(job.id)} onOpen={openJob}
                onToggleSelect={toggleSelect} onDelete={deleteOne} />
            ))}
          </div>
          {detailOpenMobile && activeJob && (
            <div className="lg:hidden fixed inset-0 bg-background z-50 overflow-hidden">
              <JobDetailPane job={activeJob} onDelete={deleteOne} onClose={closeJobMobile} />
            </div>
          )}

          {offset + LIMIT < total && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => fetchJobs(offset + LIMIT, true)} disabled={loadingJobs} className="gap-2">
                {loadingJobs ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</> : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
