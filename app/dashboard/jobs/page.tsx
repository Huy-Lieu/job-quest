'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Briefcase, Settings2, Clock, Plus } from 'lucide-react'
import type { JobWithScore, SearchConfig, SearchRun } from '@/lib/types'
import { toast } from 'sonner'

import { RunSearchPanel }   from '@/app/components/Search/RunSearchPanel'
import { RunsTab }          from '@/app/components/Search/RunsTab'
import { JobConfigsTab }    from '@/app/components/Search/JobConfigsTab'
import { ManualPasteModal } from '@/app/components/Search/ManualPasteModal'
import { JobsTab }          from '@/app/components/Jobs/JobsTab'

type Tab = 'jobs' | 'configs' | 'runs'
const LIMIT = 20

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('jobs')

  const [jobs, setJobs]               = useState<JobWithScore[]>([])
  const [total, setTotal]             = useState(0)
  const [offset, setOffset]           = useState(0)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [jobsError, setJobsError]     = useState('')

  const [minScore, setMinScore]               = useState(0)
  const [source, setSource]                   = useState('')
  const [jobType, setJobType]                 = useState('')
  const [recommendedOnly, setRecommendedOnly] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [activeJobId, setActiveJobId]           = useState<string | null>(null)
  const [detailOpenMobile, setDetailOpenMobile] = useState(false)
  const openJob       = useCallback((id: string) => { setActiveJobId(id); setDetailOpenMobile(true) }, [])
  const closeJobMobile = useCallback(() => setDetailOpenMobile(false), [])

  const [configs, setConfigs]             = useState<SearchConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [editingConfig, setEditingConfig]  = useState<SearchConfig | null>(null)

  const [runs, setRuns]             = useState<SearchRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)

  const [pasteOpen, setPasteOpen] = useState(false)
  const [optimisticRunningIds, setOptimisticRunningIds] = useState<Set<string>>(new Set())

  const serverRunningIds = new Set(
    runs.filter((r) => r.status === 'running' && r.config_id).map((r) => r.config_id as string)
  )
  const runningConfigIds = new Set<string>([...optimisticRunningIds, ...serverRunningIds])
  const hasServerRunning = serverRunningIds.size > 0

  // ── Fetchers ─────────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async (newOffset = 0, append = false) => {
    setLoadingJobs(true); setJobsError('')
    try {
      const p = new URLSearchParams({ limit: String(LIMIT), offset: String(newOffset), min_score: String(minScore) })
      p.set('phd', 'false')
      if (source)          p.set('source', source)
      if (jobType)         p.set('job_type', jobType)
      if (recommendedOnly) p.set('recommended', 'true')
      const res  = await fetch(`/api/jobs?${p}`)
      const data = await res.json()
      if (!res.ok) { setJobsError(data.error ?? 'Failed to load jobs'); return }
      setTotal(data.total ?? 0); setOffset(newOffset)
      setJobs((prev) => append ? [...prev, ...(data.jobs ?? [])] : (data.jobs ?? []))
    } finally { setLoadingJobs(false) }
  }, [minScore, source, jobType, recommendedOnly])

  const fetchConfigs = useCallback(async () => {
    setLoadingConfigs(true)
    try { const res = await fetch('/api/search/configs?scope=jobs'); const d = await res.json(); if (res.ok) setConfigs(d) }
    finally { setLoadingConfigs(false) }
  }, [])

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true)
    try { const res = await fetch('/api/search/runs?limit=20&scope=jobs'); const d = await res.json(); if (res.ok) setRuns(d) }
    finally { setLoadingRuns(false) }
  }, [])

  // ── Selection / delete ────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const deleteOne = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    if (!res.ok) { setJobsError('Failed to remove job'); return }
    setJobs((p) => p.filter((j) => j.id !== id)); setTotal((t) => Math.max(0, t - 1))
    setSelectedIds((p) => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n })
  }, [])

  const deleteBulk = useCallback(async () => {
    if (!selectedIds.size) return; setBulkDeleting(true)
    const ids = [...selectedIds]
    const res = await fetch('/api/jobs/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    })
    setBulkDeleting(false)
    if (!res.ok) { setJobsError('Failed to remove selected jobs'); return }
    setJobs((p) => p.filter((j) => !selectedIds.has(j.id))); setTotal((t) => Math.max(0, t - ids.length)); clearSelection()
  }, [selectedIds, clearSelection])

  // ── Stop search ──────────────────────────────────────────────────────────────

  const stopSearch = useCallback(async (configId: string) => {
    setOptimisticRunningIds((p) => { const n = new Set(p); n.delete(configId); return n })
    const runningRun = runs.find((r) => r.config_id === configId && r.status === 'running')
    if (runningRun) {
      await fetch(`/api/search/stream?runId=${runningRun.id}`, { method: 'DELETE' })
      fetchRuns()
    }
  }, [runs, fetchRuns])

  // ── Run search (SSE) ──────────────────────────────────────────────────────────

  const runSearch = useCallback(async (configId: string, configName: string, opts?: { switchToRunsTab?: boolean }) => {
    setOptimisticRunningIds((p) => { const n = new Set(p); n.add(configId); return n })
    const tid = toast.loading(`Running ${configName}…`, { description: 'Scraping in parallel. Usually 30–90 s.', duration: Infinity })
    try {
      const res = await fetch('/api/search/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId }),
      })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        toast.error(`Search failed: ${(d as { error?: string }).error ?? 'Unknown error'}`, { id: tid, duration: 6000 }); return
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      const stageLabel: Record<string, string> = {
        scraping: 'Scraping job boards…', normalizing: 'Normalizing…',
        enriching: 'Enriching with Claude…', deduplicating: 'Deduplicating…',
        scoring: 'Scoring against your resume…',
      }
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const pl = JSON.parse(line.slice(6)) as { stage?: string; found?: number; unique?: number; scored?: number; message?: string }
            if (pl.stage === 'complete') {
              toast.success(`Done — ${pl.found ?? 0} found · ${pl.unique ?? 0} new · ${pl.scored ?? 0} scored`, { id: tid, duration: 5000 })
              fetchJobs(0); fetchRuns(); if (opts?.switchToRunsTab) setTab('runs'); return
            }
            let label = stageLabel[pl.stage ?? ''] ?? pl.message ?? 'Running…'
            if (pl.stage === 'enriching' && pl.found)  label = `Enriching ${pl.found} jobs…`
            if (pl.stage === 'scoring'   && pl.unique) label = `Scoring ${pl.unique} jobs…`
            toast.loading(label, { id: tid, duration: Infinity })
          } catch { /* ignore */ }
        }
      }
    } catch { toast.error('Network error', { id: tid, duration: 6000 }) }
    finally { setOptimisticRunningIds((p) => { const n = new Set(p); n.delete(configId); return n }) }
  }, [fetchJobs, fetchRuns])

  // ── Config helpers ────────────────────────────────────────────────────────────

  const duplicateConfig = useCallback(async (c: SearchConfig) => {
    const base = c.name ?? c.keywords.slice(0, 3).join(', ')
    const res = await fetch('/api/search/configs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${base} (copy)`, keywords: c.keywords, target_companies: c.target_companies,
        locations: c.locations, sources: c.sources, career_page_urls: c.career_page_urls, schedule_interval: c.schedule_interval }),
    })
    if (res.ok) { const newCfg = await res.json(); setConfigs((p) => [newCfg, ...p]); toast.success(`Duplicated "${base}"`) }
    else { const d = await res.json().catch(() => ({})); toast.error(`Duplicate failed: ${(d as { error?: string }).error ?? res.statusText}`) }
  }, [])

  const onConfigSaved = useCallback((u: SearchConfig) => {
    setConfigs((p) => p.map((c) => (c.id === u.id ? u : c))); setEditingConfig(null); toast.success('Config updated')
  }, [])

  // ── Effects ───────────────────────────────────────────────────────────────────

  useEffect(() => { fetchJobs(0) },   [fetchJobs])
  useEffect(() => { fetchConfigs() }, [fetchConfigs])
  useEffect(() => { fetchRuns() },    [fetchRuns])
  useEffect(() => { fetchJobs(0) },   [minScore, source, jobType, recommendedOnly, fetchJobs])
  useEffect(() => {
    if (!hasServerRunning) return
    const t = setInterval(() => { fetchRuns(); fetchJobs(0) }, 5000)
    return () => clearInterval(t)
  }, [hasServerRunning, fetchRuns, fetchJobs])
  useEffect(() => {
    if (!jobs.length) return
    if (!activeJobId || !jobs.find((j) => j.id === activeJobId)) setActiveJobId(jobs[0].id)
  }, [jobs, activeJobId])
  useEffect(() => {
    if (tab !== 'jobs') return
    function onKey(e: KeyboardEvent) {
      if (detailOpenMobile) return
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (!jobs.length) return; e.preventDefault()
      const idx  = activeJobId ? jobs.findIndex((j) => j.id === activeJobId) : -1
      const next = e.key === 'ArrowDown' ? Math.min(jobs.length - 1, idx + 1) : Math.max(0, idx - 1)
      setActiveJobId(jobs[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, jobs, activeJobId, detailOpenMobile])

  // ── Render ────────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'jobs',    label: 'Jobs',    icon: <Briefcase className="h-3.5 w-3.5" />, count: total || undefined },
    { key: 'configs', label: 'Configs', icon: <Settings2 className="h-3.5 w-3.5" />, count: configs.length || undefined },
    { key: 'runs',    label: 'Runs',    icon: <Clock className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Job Board</h2>
          <p className="text-muted-foreground mt-1">AI-scored jobs from LinkedIn, Indeed, Google Jobs, and company career pages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setPasteOpen(true)}>
            <Plus className="h-4 w-4" /> Add Manually
          </Button>
          <RunSearchPanel configs={configs} runningConfigIds={runningConfigIds} runSearch={runSearch} stopSearch={stopSearch} />
        </div>
      </div>

      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {tabs.map(({ key, label, icon, count }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <span className="flex items-center gap-1.5">
              {icon}{label}
              {count !== undefined && <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{count}</span>}
            </span>
          </button>
        ))}
      </div>

      {tab === 'jobs' && (
        <JobsTab
          jobs={jobs} total={total} offset={offset} loadingJobs={loadingJobs} jobsError={jobsError}
          minScore={minScore} source={source} jobType={jobType} recommendedOnly={recommendedOnly}
          selectedIds={selectedIds} bulkDeleting={bulkDeleting} activeJobId={activeJobId}
          detailOpenMobile={detailOpenMobile} hasConfigs={configs.length > 0} LIMIT={LIMIT}
          setMinScore={setMinScore} setSource={setSource} setJobType={setJobType} setRecommendedOnly={setRecommendedOnly}
          fetchJobs={fetchJobs} openJob={openJob} closeJobMobile={closeJobMobile}
          toggleSelect={toggleSelect} clearSelection={clearSelection} deleteOne={deleteOne}
          deleteBulk={deleteBulk} setTab={setTab}
        />
      )}

      {tab === 'configs' && (
        <JobConfigsTab
          configs={configs} loadingConfigs={loadingConfigs} runningConfigIds={runningConfigIds}
          editingConfig={editingConfig} setEditingConfig={setEditingConfig}
          onConfigSaved={onConfigSaved} runSearch={runSearch} duplicateConfig={duplicateConfig}
          onDeleteConfig={async (id) => { await fetch(`/api/search/configs?id=${id}`, { method: 'DELETE' }); setConfigs((p) => p.filter((c) => c.id !== id)) }}
        />
      )}

      {tab === 'runs' && <RunsTab runs={runs} loadingRuns={loadingRuns} fetchRuns={fetchRuns} />}

      <ManualPasteModal open={pasteOpen} onClose={() => setPasteOpen(false)}
        onJobAdded={(job) => { setJobs((p) => [job, ...p]); setTotal((p) => p + 1); setPasteOpen(false) }} />
    </div>
  )
}
