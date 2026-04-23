'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Application, ApplicationStatus, STATUS_LABELS, STATUS_COLORS, BADGE_DEFINITIONS } from '@/lib/types'
import { Plus, X, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState<ApplicationStatus | 'all'>('all')
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [form, setForm] = useState({
    company: '',
    title: '',
    location: '',
    url: '',
    job_type: 'full_time',
    status: 'applied' as ApplicationStatus,
    notes: '',
  })

  const fetchApplications = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/applications')
    const data = await res.json()
    if (res.ok) setApplications(data)
    else setError(data.error)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount pattern
    void fetchApplications()
  }, [fetchApplications])

  async function handleAddApplication(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job: {
          title: form.title,
          company: form.company,
          location: form.location,
          url: form.url,
          job_type: form.job_type,
        },
        application: {
          status: form.status,
          notes: form.notes,
          applied_at: form.status === 'applied' ? new Date().toISOString() : null,
        },
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setApplications((prev) => [data, ...prev])
      setShowModal(false)
      setForm({ company: '', title: '', location: '', url: '', job_type: 'full_time', status: 'applied', notes: '' })

      // XP toast
      if (data.xpGained > 0) {
        toast.success(`+${data.xpGained} XP earned!`, {
          description: `You're now Level ${data.newLevel}`,
        })
      }
      // Badge toasts
      for (const key of data.newBadges ?? []) {
        const badge = BADGE_DEFINITIONS[key]
        if (badge) toast(`${badge.icon} Badge unlocked: ${badge.label}`, { description: badge.description })
      }
    } else {
      setError(data.error)
    }
    setSubmitting(false)
  }

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const res = await fetch(`/api/applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await res.json()
    if (res.ok) {
      setApplications((prev) => prev.map((a) => (a.id === id ? data : a)))

      // XP toast
      if (data.xpGained > 0) {
        toast.success(`+${data.xpGained} XP earned!`, {
          description: `Status updated to ${STATUS_LABELS[status]} · Level ${data.newLevel}`,
        })
      }
      // Badge toasts
      for (const key of data.newBadges ?? []) {
        const badge = BADGE_DEFINITIONS[key]
        if (badge) toast(`${badge.icon} Badge unlocked: ${badge.label}`, { description: badge.description })
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this application?')) return
    const res = await fetch(`/api/applications/${id}`, { method: 'DELETE' })
    if (res.ok) setApplications((prev) => prev.filter((a) => a.id !== id))
  }

  const filtered = filterStatus === 'all'
    ? applications
    : applications.filter((a) => a.status === filterStatus)

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Applications</h2>
          <p className="text-muted-foreground mt-1">Track every job you&apos;ve applied to</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Application
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            filterStatus === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          All ({applications.length})
        </button>
        {ALL_STATUSES.map((s) => {
          const count = applications.filter((a) => a.status === s).length
          if (count === 0) return null
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                filterStatus === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {STATUS_LABELS[s]} ({count})
            </button>
          )
        })}
      </div>

      {/* Applications list */}
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
                {/* Company initial */}
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {app.job?.company?.[0]?.toUpperCase() ?? '?'}
                </div>

                {/* Job info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{app.job?.canonical_title ?? 'Unknown Role'}</p>
                    {app.job?.job_sources?.[0]?.source_url && (
                      <a href={app.job.job_sources[0].source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {app.job?.company} {app.job?.location ? `· ${app.job.location}` : ''}
                  </p>
                  {app.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{app.notes}</p>}
                </div>

                {/* Status selector */}
                <select
                  value={app.status}
                  onChange={(e) => handleStatusChange(app.id, e.target.value as ApplicationStatus)}
                  className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_COLORS[app.status]}`}
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>

                {/* Date */}
                <p className="text-xs text-muted-foreground hidden md:block flex-shrink-0">
                  {new Date(app.created_at).toLocaleDateString()}
                </p>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(app.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Application Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle>Add Application</CardTitle>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <form onSubmit={handleAddApplication}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Company *</Label>
                    <Input
                      required
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      placeholder="Google"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Job Title *</Label>
                    <Input
                      required
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Software Engineer"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Location</Label>
                  <Input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="San Francisco, CA (or Remote)"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Job URL</Label>
                  <Input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Type</Label>
                    <select
                      value={form.job_type}
                      onChange={(e) => setForm({ ...form, job_type: e.target.value })}
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    >
                      <option value="full_time">Full Time</option>
                      <option value="internship">Internship</option>
                      <option value="phd">PhD</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as ApplicationStatus })}
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Referral from John, deadline March 31..."
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[80px] resize-none"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Application'}
                </Button>
              </CardContent>
            </form>
          </Card>
        </div>
      )}
    </div>
  )
}
