'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GraduationCap, Loader2, ExternalLink } from 'lucide-react'
import type { JobWithScore, SearchConfig } from '@/lib/types'
import { FitScoreBadge } from '@/app/components/ui/FitScoreBadge'

interface Props {
  jobs:           JobWithScore[]
  total:          number
  offset:         number
  loadingJobs:    boolean
  jobsError:      string
  minScore:       number
  setMinScore:    (v: number) => void
  source:         string
  setSource:      (v: string) => void
  jobType:        string
  setJobType:     (v: string) => void
  recommendedOnly: boolean
  setRecommendedOnly: (v: boolean) => void
  fetchJobs:      (offset?: number, append?: boolean) => void
  LIMIT:          number
  configs:        SearchConfig[]
  setTab:         (t: 'jobs' | 'configs' | 'runs' | 'watchlist') => void
}

export function PhDJobsTab({
  jobs, total, offset, loadingJobs, jobsError,
  minScore, setMinScore, source, setSource,
  jobType, setJobType, recommendedOnly, setRecommendedOnly,
  fetchJobs, LIMIT, configs, setTab,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="border rounded-md px-3 py-1.5 text-sm bg-background">
          <option value={0}>All scores</option>
          <option value={50}>50+</option>
          <option value={70}>70+</option>
          <option value={80}>80+</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-background">
          <option value="">All sources</option>
          <option value="phd">PhD Boards</option>
          <option value="linkedin">LinkedIn</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={recommendedOnly} onChange={(e) => setRecommendedOnly(e.target.checked)} />
          Recommended only
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{total} positions</span>
      </div>

      {jobsError && <p className="text-sm text-red-500">{jobsError}</p>}

      {loadingJobs && jobs.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading positions…
        </div>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <GraduationCap className="h-12 w-12 text-muted-foreground mb-3 opacity-30" />
            <p className="font-semibold text-lg">No PhD positions yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              {configs.length === 0
                ? 'Add a search config to start scraping academic job boards.'
                : 'Run a search to pull in positions from academic boards.'}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setTab(configs.length === 0 ? 'configs' : 'jobs')}>
              {configs.length === 0 ? 'Set up a config' : 'Refresh'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {jobs.map((job) => {
              const score    = job.job_scores?.[0]
              const applyUrl = job.job_sources?.[0]?.source_url
              return (
                <Card key={job.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-4 px-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{job.canonical_title}</p>
                          {score?.fit_score != null && <FitScoreBadge score={score.fit_score} />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
                        {score?.fit_reason && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{score.fit_reason}</p>
                        )}
                      </div>
                      {applyUrl && (
                        <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors">
                          Apply <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {offset + LIMIT < total && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => fetchJobs(offset + LIMIT, true)} disabled={loadingJobs}>
                {loadingJobs ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
