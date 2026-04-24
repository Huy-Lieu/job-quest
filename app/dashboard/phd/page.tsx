'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  MapPin, Building2, ExternalLink, Loader2,
  Play, Clock, Settings2, ChevronDown, ChevronUp, CheckCircle2,
  XCircle, RefreshCw, Plus, Trash2, Zap, GraduationCap,
} from 'lucide-react'
import type { JobWithScore, SearchConfig, SearchRun, SearchSourceName, ScheduleInterval } from '@/lib/types'
import { SkillPill } from '@/components/ui/SkillPill'

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<SearchSourceName, string> = {
  linkedin:        'LinkedIn',
  indeed:          'Indeed',
  google:          'Google Jobs',
  career_page:     'Career Page',
  greenhouse:      'Greenhouse',
  lever:           'Lever',
  ashby:           'Ashby',
  glassdoor:       'Glassdoor',
  wellfound:       'Wellfound',
  ziprecruiter:    'ZipRecruiter',
  phd:             'PhD Board',
  workday:         'Workday',
  smartrecruiters: 'SmartRecruiters',
  clearancejobs:   'ClearanceJobs',
  hn_hiring:       'HN Hiring',
  yc_waas:         'YC WaaS',
  workable:        'Workable',
  recruitee:       'Recruitee',
  teamtailor:      'Teamtailor',
  personio:        'Personio',
}

const SOURCE_COLORS: Record<SearchSourceName, string> = {
  linkedin:        'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  indeed:          'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  google:          'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  career_page:     'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
  greenhouse:      'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  lever:           'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  ashby:           'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  glassdoor:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  wellfound:       'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  ziprecruiter:    'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  phd:             'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  workday:         'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  smartrecruiters: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  clearancejobs:   'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  hn_hiring:       'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200',
  yc_waas:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-200',
  workable:        'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  recruitee:       'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  teamtailor:      'bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300',
  personio:        'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
}

const AVAILABLE_SOURCES: SearchSourceName[] = ['linkedin', 'indeed', 'google', 'career_page', 'greenhouse', 'phd']

type Tab = 'jobs' | 'configs' | 'runs'

// ─── Score badge ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30' :
    score >= 50 ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30' :
                  'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30'
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {score}%
    </span>
  )
}

// ─── Job card ────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: JobWithScore }) {
  const [expanded, setExpanded] = useState(false)
  const score  = job.job_scores?.[0]
  const source = job.job_sources?.[0]
  const applyUrl = source?.source_url ?? null

  const salaryText = job.salary_min
    ? `$${(job.salary_min / 1000).toFixed(0)}k${job.salary_max ? `–${(job.salary_max / 1000).toFixed(0)}k` : '+'}`
    : null

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base leading-snug">{job.canonical_title}</CardTitle>
              {score && <ScoreBadge score={score.fit_score} />}
              {score?.recommended && (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 text-xs">
                  ✦ Recommended
                </Badge>
              )}
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />{job.company}
              </span>
              {job.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />{job.location}
                </span>
              )}
              {job.employment_type && job.employment_type !== 'unknown' && (
                <Badge variant="secondary" className="text-xs capitalize">
                  {job.employment_type}
                </Badge>
              )}
              {salaryText && (
                <span className="text-xs font-medium text-green-700 dark:text-green-400">{salaryText}</span>
              )}
              {job.posted_at && (
                <span className="text-xs">
                  {new Date(job.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>

            {/* Source badges */}
            {job.job_sources?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {job.job_sources.map((s) => (
                  <span
                    key={s.source_name}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[s.source_name] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {SOURCE_LABELS[s.source_name] ?? s.source_name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {applyUrl && (
              <a href={applyUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1">
                  <ExternalLink className="h-3 w-3" /> Apply
                </Button>
              </a>
            )}
            {score && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Expanded fit analysis */}
      {expanded && score && (
        <CardContent className="pt-0 pb-4 space-y-3">
          {score.fit_reason && (
            <p className="text-sm text-muted-foreground">{score.fit_reason}</p>
          )}
          <div className="flex flex-wrap gap-4">
            {score.skills_matched?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Skills matched</p>
                <div className="flex flex-wrap gap-1">
                  {score.skills_matched.map((s) => (
                    <SkillPill key={s} label={s} variant="matched" />
                  ))}
                </div>
              </div>
            )}
            {score.skills_missing?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Skills missing</p>
                <div className="flex flex-wrap gap-1">
                  {score.skills_missing.map((s) => (
                    <SkillPill key={s} label={s} variant="missing" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Search Run button + panel ────────────────────────────────────────────────

function RunSearchPanel({
  configs,
  onRunComplete,
}: {
  configs: SearchConfig[]
  onRunComplete: () => void
}) {
  const [open, setOpen]             = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [running, setRunning]       = useState(false)
  const [status, setStatus]         = useState<string>('')

  const effectiveId = selectedId || configs[0]?.id || ''

  async function handleRun() {
    if (!effectiveId) return
    setRunning(true)
    setStatus('Starting search…')

    try {
      const res  = await fetch('/api/search/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ configId: effectiveId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setStatus(`Error: ${data.error ?? 'Unknown error'}`)
        setRunning(false)
        return
      }

      setStatus(`Done — found ${data.jobsFound} jobs, ${data.jobsNew} new, ${data.jobsScored} scored`)
      setRunning(false)
      setOpen(false)
      onRunComplete()
    } catch {
      setStatus('Network error — please try again')
      setRunning(false)
    }
  }

  return (
    <div className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        className="gap-2"
        disabled={configs.length === 0}
        title={configs.length === 0 ? 'Create a search config first' : undefined}
      >
        <Play className="h-4 w-4" /> Run Search
      </Button>

      {open && (
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

          {status && (
            <p className={`text-xs ${status.startsWith('Error') ? 'text-red-500' : 'text-muted-foreground'}`}>
              {status}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleRun} disabled={running} size="sm" className="gap-1 flex-1">
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</> : <><Zap className="h-3.5 w-3.5" /> Start</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Search runs take 30–90 seconds. Results appear in the PhD tab when complete.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── New Config Form ──────────────────────────────────────────────────────────

function NewConfigForm({ onCreated }: { onCreated: (c: SearchConfig) => void }) {
  const [open, setOpen]               = useState(false)
  const [name, setName]               = useState('')
  const [keywords, setKeywords]       = useState('')
  const [companies, setCompanies]     = useState('')
  const [locations, setLocations]     = useState('United States')
  const [sources, setSources]         = useState<SearchSourceName[]>(['phd'])
  const [schedule, setSchedule]       = useState<'daily' | '6h' | 'manual'>('daily')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  function toggleSource(s: SearchSourceName) {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const res = await fetch('/api/search/configs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:              name.trim() || null,
        keywords:          keywords.split(',').map((k) => k.trim()).filter(Boolean),
        target_companies:  companies.split(',').map((c) => c.trim()).filter(Boolean),
        locations:         locations.split(',').map((l) => l.trim()).filter(Boolean),
        sources,
        schedule_interval: schedule,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to save config')
      setSaving(false)
      return
    }

    onCreated(data)
    setOpen(false)
    setName(''); setKeywords(''); setCompanies(''); setLocations('United States')
    setSources(['phd']); setSchedule('daily')
    setSaving(false)
  }

  return (
    <div>
      <Button variant="outline" className="gap-2" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-4 w-4" /> New Config
      </Button>

      {open && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Create PhD Search Config</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Name (optional)</label>
                <Input placeholder="e.g. ML PhD Fellowships" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Keywords <span className="text-red-500">*</span></label>
                <Input placeholder="machine learning PhD, robotics doctoral, fellowship" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma-separated</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Target Institutions</label>
                <Input placeholder="MIT, Stanford, CMU" value={companies} onChange={(e) => setCompanies(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma-separated (leave blank to search all)</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Locations</label>
                <Input placeholder="United States, Remote" value={locations} onChange={(e) => setLocations(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Sources</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_SOURCES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSource(s)}
                      className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                        sources.includes(s)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-foreground'
                      }`}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Schedule</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value as ScheduleInterval)}
                >
                  <option value="daily">Daily (07:00 UTC)</option>
                  <option value="6h">Every 6 hours</option>
                  <option value="manual">Manual only</option>
                </select>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !keywords.trim()} className="gap-1">
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save Config'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Run status icon ─────────────────────────────────────────────────────────

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 text-green-500" />
  if (status === 'failed')   return <XCircle className="h-4 w-4 text-red-500" />
  return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PhDPage() {
  const [tab, setTab] = useState<Tab>('jobs')

  // Jobs tab state
  const [jobs, setJobs]               = useState<JobWithScore[]>([])
  const [total, setTotal]             = useState(0)
  const [offset, setOffset]           = useState(0)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [jobsError, setJobsError]     = useState('')

  // Filters
  const [minScore, setMinScore]               = useState(0)
  const [source, setSource]                   = useState('')
  const [jobType, setJobType]                 = useState('')
  const [recommendedOnly, setRecommendedOnly] = useState(false)

  // Configs tab state
  const [configs, setConfigs]             = useState<SearchConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)

  // Runs tab state
  const [runs, setRuns]           = useState<SearchRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)

  const LIMIT = 20

  // ── Fetch functions ─────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async (newOffset = 0, append = false) => {
    setLoadingJobs(true)
    setJobsError('')
    try {
      const params = new URLSearchParams({
        limit:     String(LIMIT),
        offset:    String(newOffset),
        min_score: String(minScore),
        phd:       'true',
      })
      if (source)          params.set('source', source)
      if (jobType)         params.set('job_type', jobType)
      if (recommendedOnly) params.set('recommended', 'true')

      const res  = await fetch(`/api/jobs?${params}`)
      const data = await res.json()

      if (!res.ok) {
        setJobsError(data.error ?? 'Failed to load jobs')
        return
      }

      setTotal(data.total ?? 0)
      setOffset(newOffset)
      setJobs((prev) => append ? [...prev, ...(data.jobs ?? [])] : (data.jobs ?? []))
    } finally {
      setLoadingJobs(false)
    }
  }, [minScore, source, jobType, recommendedOnly])

  const fetchConfigs = useCallback(async () => {
    setLoadingConfigs(true)
    try {
      const res  = await fetch('/api/search/configs?scope=phd')
      const data = await res.json()
      if (res.ok) setConfigs(data)
    } finally {
      setLoadingConfigs(false)
    }
  }, [])

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const res  = await fetch('/api/search/runs?limit=20&scope=phd')
      const data = await res.json()
      if (res.ok) setRuns(data)
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  // ── Initial loads ───────────────────────────────────────────────────────────

  useEffect(() => { fetchJobs(0) },   [fetchJobs])
  useEffect(() => { fetchConfigs() }, [fetchConfigs])
  useEffect(() => {
    if (tab === 'runs') fetchRuns()
  }, [tab, fetchRuns])

  useEffect(() => { fetchJobs(0) }, [minScore, source, jobType, recommendedOnly, fetchJobs])

  // ── Tabs ────────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'jobs',    label: 'Positions', icon: <GraduationCap className="h-3.5 w-3.5" />, count: total || undefined },
    { key: 'configs', label: 'Configs',   icon: <Settings2 className="h-3.5 w-3.5" />,    count: configs.length || undefined },
    { key: 'runs',    label: 'Runs',      icon: <Clock className="h-3.5 w-3.5" /> },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">PhD Opportunities</h2>
          <p className="text-muted-foreground mt-1">
            AI-scored doctoral positions, fellowships, and postdocs from academic job boards and beyond.
          </p>
        </div>
        <RunSearchPanel configs={configs} onRunComplete={() => { fetchJobs(0); fetchRuns() }} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {tabs.map(({ key, label, icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {icon}{label}
              {count !== undefined && (
                <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* ── Positions Tab ────────────────────────────────────────────────────── */}
      {tab === 'jobs' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Min score</label>
              <input
                type="range"
                min={0}
                max={90}
                step={10}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-xs w-7 text-center">{minScore}%</span>
            </div>

            <select
              className="border rounded-md px-2 py-1 text-xs bg-background"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              {AVAILABLE_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>

            <select
              className="border rounded-md px-2 py-1 text-xs bg-background"
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
            >
              <option value="">All types</option>
              <option value="full_time">Full-time</option>
              <option value="internship">Internship</option>
              <option value="contract">Contract</option>
              <option value="part_time">Part-time</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={recommendedOnly}
                onChange={(e) => setRecommendedOnly(e.target.checked)}
                className="rounded"
              />
              Recommended
            </label>

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1 text-xs"
              onClick={() => fetchJobs(0)}
              disabled={loadingJobs}
            >
              <RefreshCw className={`h-3 w-3 ${loadingJobs ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Error */}
          {jobsError && (
            <Alert variant="destructive">
              <AlertDescription>{jobsError}</AlertDescription>
            </Alert>
          )}

          {/* Loading */}
          {loadingJobs && jobs.length === 0 && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading PhD positions…
            </div>
          )}

          {/* Empty state */}
          {!loadingJobs && jobs.length === 0 && !jobsError && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <GraduationCap className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
                <p className="font-semibold">No PhD positions found yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Click <strong>Run Search</strong> with a config that includes the <strong>PhD Board</strong> source.
                  Positions are automatically scored by Claude based on your resume.
                </p>
                {configs.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    You need a <button className="underline" onClick={() => setTab('configs')}>search config</button> first.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Job list */}
          {jobs.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{total} positions found</p>
              <div className="space-y-3">
                {jobs.map((job) => <JobCard key={job.id} job={job} />)}
              </div>

              {offset + LIMIT < total && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => fetchJobs(offset + LIMIT, true)}
                    disabled={loadingJobs}
                    className="gap-2"
                  >
                    {loadingJobs
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</>
                      : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Configs Tab ──────────────────────────────────────────────────────── */}
      {tab === 'configs' && (
        <div className="space-y-4">
          <NewConfigForm onCreated={(c) => setConfigs((prev) => [c, ...prev])} />

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
                  Create a config above — enable the <strong>PhD Board</strong> source to scrape academic job boards.
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
                        <p className="font-semibold">
                          {config.name ?? config.keywords.slice(0, 3).join(', ')}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {config.keywords.map((k) => (
                            <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {config.locations.length > 0 && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />{config.locations.join(', ')}
                            </span>
                          )}
                          {config.target_companies.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />{config.target_companies.slice(0, 3).join(', ')}
                              {config.target_companies.length > 3 && ` +${config.target_companies.length - 3}`}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{config.schedule_interval}
                          </span>
                          {config.last_run_at && (
                            <span>
                              Last run {new Date(config.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {config.sources.map((s) => (
                            <span
                              key={s}
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[s] ?? 'bg-gray-100 text-gray-600'}`}
                            >
                              {SOURCE_LABELS[s]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={async () => {
                            const res = await fetch('/api/search/run', {
                              method:  'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body:    JSON.stringify({ configId: config.id }),
                            })
                            if (res.ok) { fetchJobs(0); fetchRuns(); setTab('runs') }
                          }}
                        >
                          <Play className="h-3.5 w-3.5" /> Run now
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-red-500"
                          onClick={async () => {
                            await fetch(`/api/search/configs?id=${config.id}`, { method: 'DELETE' })
                            setConfigs((prev) => prev.filter((c) => c.id !== config.id))
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Runs Tab ─────────────────────────────────────────────────────────── */}
      {tab === 'runs' && (
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
                <p className="text-sm text-muted-foreground mt-1">
                  Run a search to see results here.
                </p>
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
                          {run.search_configs?.name
                            ? ` — ${run.search_configs.name}`
                            : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(run.started_at).toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour:  '2-digit', minute: '2-digit',
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
                  {run.error_text && (
                    <p className="mt-2 text-xs text-red-500">{run.error_text}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  )
}
