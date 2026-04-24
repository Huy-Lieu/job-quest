'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Bookmark, Trash2, Plus, ExternalLink, Loader2 } from 'lucide-react'

export interface WatchlistEntry {
  id:          string
  url:         string
  label:       string | null
  notes:       string | null
  created_at:  string
}

interface Props {
  watchlist:  WatchlistEntry[]
  loading:    boolean
  onAdded:    (entry: WatchlistEntry) => void
  onDeleted:  (id: string) => void
}

export function WatchlistTab({ watchlist, loading, onAdded, onDeleted }: Props) {
  const [addUrl, setAddUrl]     = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [adding, setAdding]     = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addUrl.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: addUrl.trim(), label: addLabel.trim() || null }),
      })
      if (res.ok) {
        const entry = await res.json()
        onAdded(entry)
        setAddUrl('')
        setAddLabel('')
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' })
    if (res.ok) onDeleted(id)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://apply.interfolio.com/..." className="flex-1" />
        <Input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Label (optional)" className="w-48" />
        <Button type="submit" disabled={adding || !addUrl.trim()} className="gap-1">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </Button>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading watchlist…
        </div>
      ) : watchlist.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bookmark className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
            <p className="font-semibold">No watchlist entries yet</p>
            <p className="text-sm text-muted-foreground mt-1">Paste any URL above to track it.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {watchlist.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{entry.label ?? entry.url}</p>
                  {entry.label && <p className="text-xs text-muted-foreground truncate">{entry.url}</p>}
                  <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button onClick={() => handleDelete(entry.id)} className="text-muted-foreground hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
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
