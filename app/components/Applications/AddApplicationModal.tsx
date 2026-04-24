'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-react'
import type { ApplicationStatus } from '@/lib/types'
import { STATUS_LABELS } from '@/lib/types'

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
]

export interface AppForm {
  company:  string
  title:    string
  location: string
  url:      string
  job_type: string
  status:   ApplicationStatus
  notes:    string
}

interface Props {
  form:       AppForm
  setForm:    React.Dispatch<React.SetStateAction<AppForm>>
  submitting: boolean
  onClose:    () => void
  onSubmit:   (e: React.FormEvent) => void
}

export function AddApplicationModal({ form, setForm, submitting, onClose, onSubmit }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle>Add Application</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Company *</Label>
                <Input required value={form.company} onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Google" />
              </div>
              <div className="space-y-1">
                <Label>Job Title *</Label>
                <Input required value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Software Engineer" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))} placeholder="San Francisco, CA (or Remote)" />
            </div>
            <div className="space-y-1">
              <Label>Job URL</Label>
              <Input type="url" value={form.url} onChange={(e) => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Type</Label>
                <select value={form.job_type} onChange={(e) => setForm(f => ({ ...f, job_type: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                  <option value="full_time">Full Time</option>
                  <option value="internship">Internship</option>
                  <option value="phd">PhD</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value as ApplicationStatus }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Referral from John, deadline March 31..." className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[80px] resize-none" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Application'}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  )
}
