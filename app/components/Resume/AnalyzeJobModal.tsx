'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { X, Loader2, Sparkles } from 'lucide-react'
import type { ResumeVersion, JobWithScore } from '@/lib/types'

const STEPS = [
  { id: 'job',     label: 'Analyzing job description...' },
  { id: 'company', label: 'Researching company news...' },
  { id: 'gap',     label: 'Comparing resume to role...' },
  { id: 'resume',  label: 'Tailoring resume (x2 modes)...' },
  { id: 'prep',    label: 'Building interview briefing...' },
  { id: 'cover',   label: 'Writing cover letter...' },
  { id: 'done',    label: 'Done!' },
]

interface AnalyzeJobModalProps {
  masters:      ResumeVersion[]
  flaggedJobs:  JobWithScore[]
  analyzing:    boolean
  analyzeStep:  number
  analyzeForm:  {
    masterId:            string
    jobInputMode:        'paste' | 'flagged'
    jobDescription:      string
    selectedJobId:       string
    runCompanySearch:    boolean
    companySearchQuery:  string
  }
  setAnalyzeForm: React.Dispatch<React.SetStateAction<AnalyzeJobModalProps['analyzeForm']>>
  onClose:  () => void
  onSubmit: (e: React.FormEvent) => void
}

export function AnalyzeJobModal({
  masters, flaggedJobs, analyzing, analyzeStep, analyzeForm, setAnalyzeForm, onClose, onSubmit,
}: AnalyzeJobModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-4 flex-shrink-0">
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Analyze a Job</CardTitle>
          <button onClick={() => !analyzing && onClose()} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </CardHeader>
        {analyzing ? (
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="space-y-2 w-full max-w-sm">
              {STEPS.filter(s => s.id !== 'company' || analyzeForm.runCompanySearch).map((step, i) => (
                <div key={step.id} className={`flex items-center gap-2 text-sm transition-opacity ${i <= analyzeStep ? 'opacity-100' : 'opacity-30'}`}>
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${i < analyzeStep ? 'bg-green-500' : i === analyzeStep ? 'bg-primary animate-pulse' : 'bg-muted'}`} />
                  {step.label}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">This takes 20-40 seconds...</p>
          </CardContent>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col flex-1 overflow-hidden">
            <CardContent className="space-y-5 overflow-y-auto flex-1">
              <div className="space-y-1">
                <Label>Master Resume *</Label>
                <select required value={analyzeForm.masterId} onChange={(e) => setAnalyzeForm(f => ({ ...f, masterId: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background">
                  <option value="">Select a master resume...</option>
                  {masters.map((m) => <option key={m.id} value={m.id}>{m.variant_name}{m.is_default ? ' (default)' : ''}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Job Description *</Label>
                <div className="flex gap-2 text-sm">
                  <button type="button" onClick={() => setAnalyzeForm(f => ({ ...f, jobInputMode: 'paste' }))} className={`px-3 py-1 rounded-md transition-colors ${analyzeForm.jobInputMode === 'paste' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Paste JD</button>
                  <button type="button" onClick={() => setAnalyzeForm(f => ({ ...f, jobInputMode: 'flagged' }))} disabled={flaggedJobs.length === 0} className={`px-3 py-1 rounded-md transition-colors disabled:opacity-40 ${analyzeForm.jobInputMode === 'flagged' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>From Scored Jobs ({flaggedJobs.length})</button>
                </div>
                {analyzeForm.jobInputMode === 'paste' ? (
                  <textarea required value={analyzeForm.jobDescription} onChange={(e) => setAnalyzeForm(f => ({ ...f, jobDescription: e.target.value }))} placeholder="Paste the full job description here..." className="w-full border rounded-md px-3 py-2 text-sm bg-background min-h-[160px] resize-y" />
                ) : (
                  <select value={analyzeForm.selectedJobId} onChange={(e) => setAnalyzeForm(f => ({ ...f, selectedJobId: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm bg-background" required={analyzeForm.jobInputMode === 'flagged'}>
                    <option value="">Select a flagged job...</option>
                    {flaggedJobs.map((j) => <option key={j.id} value={j.id}>{j.canonical_title} - {j.company}</option>)}
                  </select>
                )}
              </div>
              <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={analyzeForm.runCompanySearch} onChange={(e) => setAnalyzeForm(f => ({ ...f, runCompanySearch: e.target.checked }))} />
                  <span className="text-sm font-medium">Company Research</span>
                  <Badge variant="outline" className="text-xs ml-1">via Apify</Badge>
                </label>
                {analyzeForm.runCompanySearch && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Search query (editable)</Label>
                    <Input value={analyzeForm.companySearchQuery} onChange={(e) => setAnalyzeForm(f => ({ ...f, companySearchQuery: e.target.value }))} placeholder={'"Company Name" news 2025 OR 2026'} className="text-sm" />
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full gap-2"><Sparkles className="h-4 w-4" /> Run Analysis</Button>
            </CardContent>
          </form>
        )}
      </Card>
    </div>
  )
}
