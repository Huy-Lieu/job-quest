'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ExternalLink, Trash2, MapPin, Building2,
  ChevronDown, ChevronUp, ArrowLeft, ArrowRight,
} from 'lucide-react'
import type { JobWithScore } from '@/lib/types'
import { SkillPill } from '@/app/components/ui/SkillPill'
import {
  SOURCE_LABELS, SOURCE_COLORS, AGE_TONE_STYLES,
  relativeTime, postingAgePill, stripHtml, pickBestSource, googleSearchUrl,
} from '@/app/dashboard/jobs/constants'
import { fmt, TYPE_COLORS } from '@/app/components/Jobs/JobTableRow'

export function JobDetailPane({
  job,
  onDelete,
  onClose,
}: {
  job: JobWithScore
  onDelete: (id: string) => void
  onClose?: () => void   // mobile sheet close callback
}) {
  const score = job.job_scores?.[0]
  const meta = job.metadata ?? null
  const viaSource = pickBestSource(job.job_sources)
  const applyUrl = viaSource?.source_url || null
  const fallback = applyUrl ? null : googleSearchUrl(job.company, job.canonical_title)
  const age = postingAgePill(job.posted_at ?? job.scraped_at)
  const ageFallback = !job.posted_at
  const salaryText = job.salary_min
    ? `$${fmt(job.salary_min)}${job.salary_max ? ` – $${fmt(job.salary_max)}` : '+'}`
    : null
  const descClean = job.description ? stripHtml(job.description) : ''
  const sponsor: 'Yes' | 'No' | 'Unknown' =
    job.visa_sponsorship === 'yes' ? 'Yes' :
    job.visa_sponsorship === 'no'  ? 'No'  :
                                     'Unknown'
  const hasRequirements = !!(
    job.seniority_level ||
    meta?.years_required != null ||
    (job.benefits_highlights?.length ?? 0) > 0 ||
    (job.skills_required?.length ?? 0) > 0 ||
    meta?.applicant_count != null ||
    job.visa_sponsorship
  )

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="flex-shrink-0 border-b px-5 py-4 space-y-3 bg-background">
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
          >
            <ChevronUp className="h-3.5 w-3.5 -rotate-90" /> Back to list
          </button>
        )}
        <div>
          <p className="text-sm text-muted-foreground">{job.company}</p>
          <h2 className="text-xl font-bold leading-tight mt-0.5">{job.canonical_title}</h2>
        </div>

        {/* Pill row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {job.location && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3 w-3" />{job.location}
            </span>
          )}
          {job.employment_type && job.employment_type !== 'unknown' && (
            <span className="px-2 py-0.5 rounded bg-muted capitalize font-medium text-muted-foreground">
              {job.employment_type}
            </span>
          )}
          {job.job_type && job.job_type !== 'unknown' && (
            <span className={`px-2 py-0.5 rounded font-medium capitalize ${TYPE_COLORS[job.job_type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300'}`}>
              {job.job_type}
            </span>
          )}
          {salaryText && (
            <span className="font-semibold text-green-700 dark:text-green-400">{salaryText}</span>
          )}
          {viaSource && (
            <span className={`px-2 py-0.5 rounded font-medium ${SOURCE_COLORS[viaSource.source_name] ?? 'bg-gray-100 text-gray-600'}`}>
              {SOURCE_LABELS[viaSource.source_name] ?? viaSource.source_name}
            </span>
          )}
          {age && (
            <span
              className={`px-1.5 py-0.5 rounded border font-semibold ${AGE_TONE_STYLES[age.tone]} ${ageFallback ? 'opacity-70' : ''}`}
              title={ageFallback ? `Scraped ${relativeTime(job.scraped_at)}` : `Posted ${relativeTime(job.posted_at)}`}
            >
              {ageFallback ? `~${age.label}` : age.label}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {applyUrl ? (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              Apply <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <a
              href={fallback!}
              target="_blank"
              rel="noopener noreferrer"
              title="No direct link — opens a Google search"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-muted hover:bg-muted/80 text-foreground text-sm font-semibold transition-colors"
            >
              Search <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-red-500 gap-1"
            onClick={() => onDelete(job.id)}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {score?.fit_reason && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Fit analysis</h3>
            <p className="text-sm text-foreground leading-relaxed">{score.fit_reason}</p>
            {score.skills_matched?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Matched</p>
                <div className="flex flex-wrap gap-1">
                  {score.skills_matched.map((s) => (
                    <SkillPill key={s} label={s} variant="matched" />
                  ))}
                </div>
              </div>
            )}
            {score.skills_missing?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Gaps</p>
                <div className="flex flex-wrap gap-1">
                  {score.skills_missing.map((s) => (
                    <SkillPill key={s} label={s} variant="missing" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasRequirements && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Requirements &amp; context</h3>
            <div className="flex flex-wrap gap-1.5">
              {job.seniority_level && job.seniority_level !== 'unknown' && <Badge variant="outline" className="text-xs capitalize">{job.seniority_level}</Badge>}
              {meta?.years_required != null && <Badge variant="outline" className="text-xs">{meta.years_required}+ yrs</Badge>}
              <Badge variant="outline" className={`text-xs ${
                sponsor === 'Yes' ? 'text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-500/40' :
                sponsor === 'No'  ? 'text-red-700 border-red-300 dark:text-red-300 dark:border-red-500/40' :
                                    'text-muted-foreground'
              }`}>
                Visa: {sponsor}
              </Badge>
              {job.benefits_highlights?.map((b) => (
                <Badge key={b} variant="outline" className="text-xs capitalize">{b}</Badge>
              ))}
              {meta?.applicant_count != null && (
                <Badge variant="outline" className="text-xs">{meta.applicant_count} applicants</Badge>
              )}
            </div>
            {(job.skills_required?.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Detected skills</p>
                <div className="flex flex-wrap gap-1">
                  {job.skills_required!.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300 font-medium"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {descClean && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">About the role</h3>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{descClean}</p>
          </div>
        )}

        {job.job_sources && job.job_sources.length > 1 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Also posted on</h3>
            <div className="flex flex-wrap gap-1.5">
              {job.job_sources.map((s) => (
                <a
                  key={s.source_name}
                  href={s.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-xs px-2 py-0.5 rounded font-medium hover:opacity-80 ${SOURCE_COLORS[s.source_name] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {SOURCE_LABELS[s.source_name] ?? s.source_name}
                </a>
              ))}
            </div>
          </div>
        )}

        {applyUrl && (
          <div className="pt-2">
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline"
            >
              View original posting →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

    </>
  )
}
