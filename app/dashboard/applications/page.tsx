'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Application, ApplicationStatus, STATUS_LABELS, STATUS_COLORS, BADGE_DEFINITIONS } from '@/lib/types'
import { Plus, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { AddApplicationModal, type AppForm } from '@/app/components/Applications/AddApplicationModal'

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

const EMPTY_FORM: AppForm = { company: '', title: '', location: '', url: '', job_type: 'full_time', status: 'applied', notes: '' }

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [filterStatus, setFilterStatus] = useState<ApplicationStatus | 'all'>('all')
  const [showModal, setShowModal]       = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [form, setForm]                 = useState<AppForm>(EMPTY_FORM)

  useEffect(() => {
    let cancelled = false
    async function loadApplications() {
      setLoading(true)
      const res  = await fetch('/api/applications')
      const data = await res.json()
      if (cancelled) return
      if (res.ok) setApplications(data)
      else setError(data.error)
      setLoading(false)
    }
    void loadApplications()
    return () => { cancelled = true }
  }, [])

  function showXpToasts(data: { xpGained?: number; newLevel?: number; newBadges?: string[]; statusLabel?: string }) {
    if ((data.xpGained ?? 0) > 0) {
      toast.success(`+${data.xpGained} XP earned!`, { description: data.statusLabel ? `Status updated to ${data.statusLabel} · Level ${data.newLevel}` : `You're now Level ${data.newLevel}` })
    }
    for (const key of data.newBadges ?? []) {
      const badge = BADGE_DEFINITIONS[key]
      if (badge) toast(`${badge.icon} Badge unlocked: ${badge.label}`, { description: badge.description })
    }
  }

  async function handleAddApplication(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/applications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job: { title: form.title, company: form.company, location: form.location, url: form.url, job_type: form.job_type },
        application: { status: form.status, notes: form.notes, applied_at: form.status === 'applied' ? new Date().toISOString() : null },
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setApplications((prev) => [data, ...prev])
      setShowModal(false)
      setForm(EMPTY_FORM)
      showXpToasts(data)
    } else { setError(data.error) }
    setSubmitting(false)
  }

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const res  = await fetch(`/api/applications/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    const data = await res.json()
    if (res.ok) { setApplications((prev) => prev.map((a) => (a.id === id ? data : a))); showXpToasts({ ...data, statusLabel: STATUS_LABELS[status] }) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this application?')) return
    const res = await fetch(`/api/applications/${id}`, { method: 'DELETE' })
    if (res.ok) setApplications((prev) => prev.filter((a) => a.id !== id))
  }

  const filtered = filterStatus === 'all' ? applications : applications.filter((a) => a.status === filterStatus)

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Applications</h2>
          <p className="text-muted-foreground mt-1">Track every job you&apos;ve applied to</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="gap-2"><Plus className="h-4 w-4" /> Add Application</Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilterStatus('all')} className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${filterStatus === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          All ({applications.length})
        </button>
        {ALL_STATUSES.map((s) => {
          const count = applications.filter((a) => a.status === s).length
          if (count === 0) return null
          return (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${filterStatus === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              {STATUS_LABELS[s]} ({count})
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="font-semibold">No applications yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click &quot;Add Application&quot; to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => (
            <Card key={app.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="flex items-center gap-4 py-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {app.job?.company?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{app.job?.canonical_title ?? 'Unknown Role'}</p>
                    {app.job?.job_sources?.[0]?.source_url && (
                      <a href={app.job.job_sources[0].source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /></a>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{app.job?.company}{app.job?.location ? ` · ${app.job.location}` : ''}</p>
                  {app.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{app.notes}</p>}
                </div>
                <select value={app.status} onChange={(e) => handleStatusChange(app.id, e.target.value as ApplicationStatus)} className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_COLORS[app.status]}`}>
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
                <p className="text-xs text-muted-foreground hidden md:block flex-shrink-0">{new Date(app.created_at).toLocaleDateString()}</p>
                <button onClick={() => handleDelete(app.id)} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"><Trash2 className="h-4 w-4" /></button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <AddApplicationModal
          form={form} setForm={setForm} submitting={submitting}
          onClose={() => setShowModal(false)} onSubmit={handleAddApplication}
        />
      )}
    </div>
  )
}
