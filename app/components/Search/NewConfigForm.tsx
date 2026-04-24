'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Plus } from 'lucide-react'
import type { SearchConfig, SearchSourceName, ScheduleInterval } from '@/lib/types'
import {
  AVAILABLE_SOURCES, SOURCE_LABELS, SOURCE_NOTICES, NOTICE_TONE_STYLES,
} from '@/app/dashboard/jobs/constants'

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
  const [sources, setSources]     = useState<SearchSourceName[]>(initialValues?.sources ?? [...AVAILABLE_SOURCES])
  const [schedule, setSchedule]   = useState<ScheduleInterval>(initialValues?.schedule_interval ?? 'daily')
  const [careerPageUrls, setCareerPageUrls] = useState((initialValues?.career_page_urls ?? []).join('\n'))
  const [serpEnabled, setSerpEnabled]       = useState(initialValues?.serp_enabled ?? false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  function toggleSource(s: SearchSourceName) {
    setSources((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  function resetCreateFields() {
    setName(''); setKeywords(''); setCompanies(''); setLocations('United States')
    setSources([...AVAILABLE_SOURCES]); setSchedule('daily'); setCareerPageUrls(''); setSerpEnabled(false)
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
      career_page_urls:  careerPageUrls.split('\n').map((u) => u.trim()).filter(Boolean),
      serp_enabled:      serpEnabled,
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

      <div className="space-y-1">
        <label className="text-sm font-medium">Career Page URLs</label>
        <Textarea
          placeholder={'https://stripe.com/jobs\nhttps://notion.so/careers'}
          value={careerPageUrls}
          onChange={(e) => setCareerPageUrls(e.target.value)}
          rows={3}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">One URL per line — scrapes directly from company career pages</p>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={serpEnabled} onChange={(e) => setSerpEnabled(e.target.checked)} className="rounded" />
        <span className="font-medium">Enable Google Jobs (SerpAPI)</span>
        <span className="text-xs text-muted-foreground">— broader coverage, uses API quota</span>
      </label>

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
          <option value="daily">Daily (07:00 UTC)</option>
          <option value="6h">Every 6 hours</option>
          <option value="manual">Manual only</option>
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !keywords.trim()} className="gap-1">
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : isEdit ? 'Save changes' : 'Save Config'}
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
