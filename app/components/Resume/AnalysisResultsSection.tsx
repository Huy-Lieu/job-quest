'use client'

import { Card, CardContent } from '@/components/ui/card'
import { MarkdownBlock } from './MarkdownBlock'
import type { AnalysisResult } from '@/lib/types'

type AnalysisTab = 'job' | 'company' | 'gap' | 'resume' | 'prep' | 'cover'
type ResumeMode  = 'conservative' | 'aggressive'

interface Props {
  results:     AnalysisResult
  activeTab:   AnalysisTab
  setActiveTab: (t: AnalysisTab) => void
  resumeMode:  ResumeMode
  setResumeMode: (m: ResumeMode) => void
  onCopy: (text: string) => void
}

const TABS: { id: AnalysisTab; label: (r: AnalysisResult) => string; hidden?: (r: AnalysisResult) => boolean }[] = [
  { id: 'job',     label: () => 'Job Breakdown' },
  { id: 'company', label: () => 'Company Intel', hidden: (r) => !r.companyIntel },
  { id: 'gap',     label: (r) => `Gap Analysis - ${r.atsScore ?? '--'}/100` },
  { id: 'resume',  label: () => 'Tailored Resume' },
  { id: 'prep',    label: () => 'Prep Briefing' },
  { id: 'cover',   label: () => 'Cover Letter' },
]

export function AnalysisResultsSection({ results, activeTab, setActiveTab, resumeMode, setResumeMode, onCopy }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="font-semibold text-base">Latest Analysis</h3>
      <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
        <div className="text-center flex-shrink-0">
          <p className="text-3xl font-bold">{results.atsScore}</p>
          <p className="text-xs text-muted-foreground">ATS Score</p>
        </div>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${results.atsScore >= 70 ? 'bg-green-500' : results.atsScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${results.atsScore}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground flex-shrink-0">
          {results.atsScore >= 70 ? 'Strong match' : results.atsScore >= 50 ? 'Decent match' : 'Needs work'}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {TABS.filter(t => !t.hidden?.(results)).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            {t.label(results)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          {activeTab === 'job' && <MarkdownBlock text={results.jobAnalysis} />}
          {activeTab === 'company' && results.companyIntel && <MarkdownBlock text={results.companyIntel} />}
          {activeTab === 'gap' && <MarkdownBlock text={results.gapAnalysis} />}
          {activeTab === 'resume' && (
            <div className="space-y-3">
              <div className="flex gap-2 items-center">
                <button onClick={() => setResumeMode('conservative')} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${resumeMode === 'conservative' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Conservative</button>
                <button onClick={() => setResumeMode('aggressive')} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${resumeMode === 'aggressive' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Aggressive</button>
                <button onClick={() => onCopy(resumeMode === 'conservative' ? results.tailoredConservative : results.tailoredAggressive)} className="ml-auto text-xs text-muted-foreground hover:text-foreground px-2">Copy</button>
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded p-3 max-h-[500px] overflow-y-auto">
                {resumeMode === 'conservative' ? results.tailoredConservative : results.tailoredAggressive}
              </pre>
            </div>
          )}
          {activeTab === 'prep' && <MarkdownBlock text={results.prepBriefing} />}
          {activeTab === 'cover' && (
            <div className="space-y-3">
              <button onClick={() => onCopy(results.coverLetter)} className="text-xs text-muted-foreground hover:text-foreground">Copy</button>
              <pre className="text-sm whitespace-pre-wrap leading-relaxed">{results.coverLetter}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
