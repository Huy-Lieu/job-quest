'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Settings2, Plus, Trash2, Play, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SearchConfig } from '@/lib/types'

interface Props {
  configs:        SearchConfig[]
  loadingConfigs: boolean
  setConfigs:     React.Dispatch<React.SetStateAction<SearchConfig[]>>
  setTab:         (t: 'jobs' | 'configs' | 'runs' | 'watchlist') => void
  fetchJobs:      (offset?: number) => void
  fetchRuns:      () => void
}

export function PhDConfigsTab({ configs, loadingConfigs, setConfigs, setTab, fetchJobs, fetchRuns }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState({
    name: '', keywords: '', locations: '',
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/search/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      form.name || null,
          keywords:  form.keywords.split(',').map(k => k.trim()).filter(Boolean),
          locations: form.locations.split(',').map(l => l.trim()).filter(Boolean),
          sources:   ['phd'],
        }),
      })
      if (res.ok) {
        const cfg = await res.json()
        setConfigs(prev => [cfg, ...prev])
        setShowForm(false)
        setForm({ name: '', keywords: '', locations: '' })
        toast.success('Config created')
      } else {
        const d = await res.json()
        toast.error(d.error ?? 'Failed to create config')
      }
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this config?')) return
    const res = await fetch(`/api/search/configs?id=${id}`, { method: 'DELETE' })
    if (res.ok) setConfigs(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowForm(s => !s)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> New Config
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. ML PhD positions" />
              </div>
              <div className="space-y-1">
                <Label>Keywords (comma-separated)</Label>
                <Input required value={form.keywords} onChange={(e) => setForm(f => ({ ...f, keywords: e.target.value }))} placeholder="machine learning, NLP, computer vision" />
              </div>
              <div className="space-y-1">
                <Label>Locations (comma-separated, optional)</Label>
                <Input value={form.locations} onChange={(e) => setForm(f => ({ ...f, locations: e.target.value }))} placeholder="United States, Remote" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="gap-1">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadingConfigs ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading configs…
        </div>
      ) : configs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Settings2 className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
            <p className="font-semibold">No search configs yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create a config to start scraping PhD positions.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {configs.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{c.name ?? '(unnamed)'}</p>
                  <p className="text-xs text-muted-foreground">{c.keywords?.join(', ')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-red-500 p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
