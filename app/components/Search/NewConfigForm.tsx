'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Plus } from 'lucide-react'
import type { SearchConfig, SearchSourceName, ScheduleInterval } from '@/lib/types'
import {
  AVAILABLE_SOURCES, SOURCE_LABELS, SOURCE_NOTICES, NOTICE_TONE_STYLES,
} from '@/app/dashboard/jobs/constants'
import { KNOWN_WORKDAY } from '@/lib/apify/ats-resolver'

interface ConfigFormProps {
  onCreated?:     (c: SearchConfig) => void
  mode?:          'create' | 'edit'
  initialValues?: SearchConfig
  onSaved?:       (c: SearchConfig) => void
  onClose?:       () => void
}

export function NewConfigForm({ onCreated, mode = 'create', initialValues, onSaved, onClose }: ConfigFormProps) {
  const isEdit = mode === 'edit'
  const [open, setOpen]           = useState(isEdit)
  const [name, setName]           = useState(initialValues?.name ?? '')
  const [keywords, setKeywords]   = useState((initialValues?.keywords ?? []).join(', '))
  const [companies, setCompanies] = useState((initialValues?.target_companies ?? []).join(', '))
  const [locations, setLocations] = useState((initialValues?.locations ?? ['United States']).join(', '))
  const [sources, setSources]           = useState<SearchSourceName[]>(initialValues?.sources ?? [...AVAILABLE_SOURCES])
  const [schedule, setSchedule]         = useState<ScheduleInterval>(initialValues?.schedule_interval ?? 'daily')
  const [workdayDisabled, setWorkdayDisabled] = useState<string[]>(initialValues?.workday_disabled ?? [])
  const [serpEnabled, setSerpEnabled]   = useState(initialValues?.serp_enabled ?? false)
  const [serpQuery,   setSerpQuery]     = useState(initialValues?.serp_query ?? '')
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const matchedWorkdayTenants = useMemo(() => {
    const parsed = companies.split(',').map(c => c.trim()).filter(Boolean)
    // blank = "search all" — show every registry tenant (deduplicated)
    if (parsed.length === 0) {
      const seen = new Map<string, { key: string; tenant: string; dc: string; site: string }>()
      for (const [k, t] of Object.entries(KNOWN_WORKDAY)) {
        const dedupeKey = t.tenant + '/' + t.site
        if (!seen.has(dedupeKey)) seen.set(dedupeKey, { key: k, ...t })
      }
      return [...seen.values()]
    }
    return parsed.flatMap(c => {
      const keySpaced   = c.toLowerCase()
      const keyStripped = keySpaced.replace(/\s+/g, '')
      const t = KNOWN_WORKDAY[keySpaced] ?? KNOWN_WORKDAY[keyStripped]
      return t ? [{ key: keyStripped, ...t }] : []
    })
  }, [companies])

  function toggleSource(s: SearchSourceName) {
    setSources((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  function resetCreateFields() {
    setName(''); setKeywords(''); setCompanies(''); setLocations('United States')
    setSources([...AVAILABLE_SOURCES]); setSchedule('daily')
    setWorkdayDisabled([]); setSerpEnabled(false); setSerpQuery('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const payload = {
      name:              name.trim() || null,
      keywords:          keywords.split(',').map((k) => k.trim()).filter(Boolean),
      target_companies:  companies.split(',').map((c) => c.trim()).filter(Boolean),
      locations:         locations.split(',').map((l) => l.trim()).filter(Boolean),
      sources,
      workday_disabled:  workdayDisabled,
      serp_enabled:      serpEnabled,
      serp_query:        serpQuery.trim() || null,
      schedule_interval: schedule,
    }
    const res  = await fetch('/api/search/configs', {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(isEdit ? { id: initialValues!.id, ...payload } : payload),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save config'); setSaving(false); return }
    setSaving(false)
    if (isEdit) { onSaved?.(data); onClose?.() }
    else        { onCreated?.(data); setOpen(false); resetCreateFields() }
  }

  const formBody = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="space-y-1">
        <label className="text-sm font-medium">Name (optional)</label>
        <Input placeholder="e.g. NVIDIA Hardware Roles" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Keywords <span className="text-red-500">*</span></label>
        <Input placeholder="embedded engineer, hardware verification, FPGA" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Target Companies</label>
        <Input placeholder="NVIDIA, Qualcomm, Intel" value={companies} onChange={(e) => setCompanies(e.target.value)} />
        <p className="text-xs text-muted-foreground">Comma-separated (leave blank to search all)</p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Locations</label>
        <Input placeholder="United States, Remote" value={locations} onChange={(e) => setLocations(e.target.value)} />
      </div>

      {sources.includes('workday') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Workday tenants</label>
            <span className="text-xs text-muted-foreground">
              {companies.trim()
                ? matchedWorkdayTenants.length === 0
                  ? 'No matches in registry'
                  : `${matchedWorkdayTenants.filter(t => !workdayDisabled.includes(t.tenant)).length} / ${matchedWorkdayTenants.length} active`
                : `All ${matchedWorkdayTenants.length} registry tenants`}
            </span>
          </div>
          {companies.trim() && matchedWorkdayTenants.length === 0 ? (
            <p className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/40">
              No registry matches — company not listed? Add it in the Workday registry panel below.
            </p>
          ) : (
            <div className="border rounded-md divide-y text-sm max-h-48 overflow-y-auto">
              {matchedWorkdayTenants.map((t) => {
                const isOff = workdayDisabled.includes(t.tenant)
                return (
                  <div key={t.key} className="flex items-center gap-3 px-3 py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!isOff}
                      onClick={() => setWorkdayDisabled(prev =>
                        isOff ? prev.filter(x => x !== t.tenant) : [...prev, t.tenant]
                      )}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${isOff ? 'bg-muted' : 'bg-emerald-500'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isOff ? 'translate-x-0' : 'translate-x-4'}`} />
                    </button>
                    <div className={`flex-1 min-w-0 ${isOff ? 'opacity-40' : ''}`}>
                      <span className="font-medium capitalize">{t.key}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {t.tenant} · {t.dc} · {t.site}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Company not listed? Add it to the Workday registry in the panel below the config list.
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={serpEnabled} onChange={(e) => setSerpEnabled(e.target.checked)} className="rounded" />
        <span className="font-medium">Enable Google Jobs (SerpAPI)</span>
        <span className="text-xs text-muted-foreground">— broader coverage, uses API quota</span>
      </label>

      {serpEnabled && (
        <div className="space-y-1 pl-6 border-l-2 border-blue-200 dark:border-blue-800">
          <label className="text-sm font-medium">Google Jobs query <span className="text-red-500">*</span></label>
          <Input
            placeholder="e.g. Embedded Test Engineer"
            value={serpQuery}
            onChange={(e) => setSerpQuery(e.target.value)}
            className={serpEnabled && !serpQuery.trim() ? 'border-red-400' : ''}
          />
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Use <strong>3-5 words separated by spaces</strong> — treated as a Google search phrase.</p>
            <p>Good: <span className="text-foreground">Embedded Test Engineer</span></p>
            <p>Bad: <span className="text-foreground">embedded, test, verification, FPGA</span> — commas cause 503 errors</p>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">Sources</label>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_SOURCES.map((s) => {
            const notice = SOURCE_NOTICES[s]
            return (
              <div key={s} className="flex items-center gap-1">
                <button
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
                {notice && (
                  <span title={notice.tooltip} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-help ${NOTICE_TONE_STYLES[notice.tone]}`}>
                    {notice.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="text-emerald-700 dark:text-emerald-400 font-medium">Free</span> = no Apify credits.{' '}
          <span className="text-amber-800 dark:text-amber-300 font-medium">Paid rental</span> = needs Apify subscription.{' '}
          <span className="text-red-800 dark:text-red-400 font-medium">Unavailable</span> = actor broken, disable to avoid errors.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Schedule</label>
        <select
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value as ScheduleInterval)}
        >
          <option value="daily">Daily (when scheduled search is enabled)</option>
          <option value="6h">Every 6 hours</option>
          <option value="manual">Manual only</option>
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !keywords.trim() || (serpEnabled && !serpQuery.trim())} className="gap-1">
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving...</> : isEdit ? 'Save changes' : 'Save Config'}
        </Button>
        <Button type="button" variant="outline" onClick={() => (isEdit ? onClose?.() : setOpen(false))}>
          Cancel
        </Button>
      </div>
    </form>
  )

  if (isEdit) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => onClose?.()}>
        <Card className="w-full max-w-xl my-8" onClick={(e) => e.stopPropagation()}>
          <CardHeader><CardTitle className="text-base">Edit Search Config</CardTitle></CardHeader>
          <CardContent>{formBody}</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <Button variant="outline" className="gap-2" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-4 w-4" /> New Config
      </Button>
      {open && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Create Search Config</CardTitle></CardHeader>
          <CardContent>{formBody}</CardContent>
        </Card>
      )}
    </div>
  )
}
   <CardContent>{formBody}</CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <Button variant="outline" className="gap-2" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-4 w-4" /> New Config
      </Button>
      {open && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Create Search Config</CardTitle></CardHeader>
          <CardContent>{formBody}</CardContent>
        </Card>
      )}
    </div>
  )
}
