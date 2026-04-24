'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Plus } from 'lucide-react'
import type { JobWithScore } from '@/lib/types'
import { toast } from 'sonner'

interface ManualPasteModalProps {
  open: boolean
  onClose: () => void
  onJobAdded: (job: JobWithScore) => void
}

export function ManualPasteModal({ open, onClose, onJobAdded }: ManualPasteModalProps) {
  const [pasted, setPasted] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pasted.trim()) {
      setError('Please paste job details')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/jobs/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pasted: pasted.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to add job')
        setSubmitting(false)
        return
      }

      onJobAdded(data)
      setPasted('')
      onClose()
      toast.success('Job added successfully')
    } catch (err) {
      setError('Network error -- please try again')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <Card className="w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-base">Add Job Manually</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Job details</label>
              <Textarea
                placeholder="Paste the full job description, or just: Title | Company | Location | Salary (optional)"
                value={pasted}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPasted(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Claude will extract: title, company, location, salary, and job type from your input.
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !pasted.trim()} className="gap-1">
                {submitting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding</>
                  : <><Plus className="h-3.5 w-3.5" /> Add Job</>}
              </Button>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
