'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { MarkdownBlock } from './MarkdownBlock'
import type { ResumeVersion, AnalysisResult } from '@/lib/types'
import { toast } from 'sonner'

type AnalysisTab = 'job' | 'company' | 'gap' | 'resume' | 'prep' | 'cover'
type ResumeMode  = 'conservative' | 'aggressive'

interface Props {
  versions:       ResumeVersion[]
  expandedVersion: string | null
  setExpandedVersion: (id: string | null) => void
  versionTab:     Record<string, AnalysisTab | ResumeMode>
  setVersionTab:  React.Dispatch<React.SetStateAction<Record<string, AnalysisTab | ResumeMode>>>
}

export function PastAnalysesList({ versions, expandedVersion, setExpandedVersion, versionTab, setVersionTab }: Props) {
  if (!versions.length) return null
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-base">Past Analyses</h3>
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="py-3 px-4">
              <button className="w-full flex items-center justify-between text-left" onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}>
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{v.variant_name}</p>
                    {v.job && <p className="text-xs text-muted-foreground">{v.job.canonical_title} &middot; {v.job.company}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {v.ats_score !== null && <Badge variant="outline" className="text-xs">{v.ats_score}/100</Badge>}
                  <p className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</p>
                  {expandedVersion === v.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>
              {expandedVersion === v.id && v.content && (() => {
                let parsed: AnalysisResult | null = null
                try { parsed = JSON.parse(v.content!) } catch { /* plain text */ }

                if (!parsed) {
                  return <pre className="mt-3 text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded p-3 max-h-[300px] overflow-y-auto">{v.content}</pre>
                }

                const curTab = versionTab[v.id] ?? 'job'
                const vTabs: { id: AnalysisTab; label: string; hidden?: boolean }[] = [
                  { id: 'job',     label: 'Job Breakdown' },
                  { id: 'company', label: 'Company Intel', hidden: !parsed.companyIntel },
                  { id: 'gap',     label: `Gap — ${parsed.atsScore}/100` },
                  { id: 'resume',  label: 'Tailored Resume' },
                  { id: 'prep',    label: 'Prep Briefing' },
                  { id: 'cover',   label: 'Cover Letter' },
                ]
                const curMode = (versionTab[v.id + '_mode'] ?? 'conservative') as ResumeMode

                return (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-1 border-b pb-2">
                      {vTabs.filter(t => !t.hidden).map(t => (
                        <button key={t.id} onClick={(e) => { e.stopPropagation(); setVersionTab(prev => ({ ...prev, [v.id]: t.id })) }}
                          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${curTab === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {curTab === 'job' && <MarkdownBlock text={parsed.jobAnalysis} />}
                      {curTab === 'company' && parsed.companyIntel && <MarkdownBlock text={parsed.companyIntel} />}
                      {curTab === 'gap' && <MarkdownBlock text={parsed.gapAnalysis} />}
                      {curTab === 'resume' && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setVersionTab(prev => ({ ...prev, [v.id + '_mode']: 'conservative' as ResumeMode })) }} className={`px-2.5 py-1 text-xs rounded-md ${curMode === 'conservative' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Conservative</button>
                            <button onClick={(e) => { e.stopPropagation(); setVersionTab(prev => ({ ...prev, [v.id + '_mode']: 'aggressive' as ResumeMode })) }} className={`px-2.5 py-1 text-xs rounded-md ${curMode === 'aggressive' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Aggressive</button>
                            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(curMode === 'aggressive' ? parsed!.tailoredAggressive : parsed!.tailoredConservative); toast.success('Copied') }} className="ml-auto text-xs text-muted-foreground hover:text-foreground px-2">Copy</button>
                          </div>
                          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 rounded p-3 max-h-[300px] overflow-y-auto">
                            {curMode === 'aggressive' ? parsed.tailoredAggressive : parsed.tailoredConservative}
                          </pre>
                        </div>
                      )}
                      {curTab === 'prep' && <MarkdownBlock text={parsed.prepBriefing} />}
                      {curTab === 'cover' && (
                        <div className="space-y-2">
                          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(parsed!.coverLetter); toast.success('Copied') }} className="text-xs text-muted-foreground hover:text-foreground">Copy</button>
                          <pre className="text-sm whitespace-pre-wrap leading-relaxed">{parsed.coverLetter}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
