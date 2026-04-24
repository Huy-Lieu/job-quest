'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Trash2, MapPin, Building2, ArrowRight } from 'lucide-react'
import type { JobWithScore } from '@/lib/types'
import { SkillPill } from '@/app/components/ui/SkillPill'
import { FitScoreBadge } from '@/app/components/ui/FitScoreBadge'
import {
  SOURCE_LABELS, SOURCE_COLORS, AGE_TONE_STYLES,
  relativeTime, postingAgePill, stripHtml, pickBestSource, googleSearchUrl,
} from '@/app/dashboard/jobs/constants'



export function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
       : n >= 1_000    ? `${(n / 1_000).toFixed(0)}k`
       : String(n)
}

/** Shared 10-column grid definition used by the header and every row. */
export const TABLE_COLS =
  'grid grid-cols-[36px_minmax(220px,2.5fr)_140px_100px_130px_100px_90px_minmax(180px,2fr)_minmax(180px,2fr)_150px] gap-3 px-4 items-start'

export const TYPE_COLORS: Record<string, string> = {
  'full_time':  'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  'contract':   'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'internship': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'part_time':  'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
}

export function TypePill({ type }: { type: string | null }) {
  if (!type || type === 'unknown') return <span className="text-xs text-muted-foreground">—</span>
  const cls = TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300'
  return (
    <span className={`self-start inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>
      {type}
    </span>
  )
}

export function WorkModePill({ mode }: { mode: string }) {
  if (!mode || mode === 'unknown') return null
  return (
    <span className="inline-flex mt-1 px-2 py-0.5 rounded bg-muted text-[11px] font-medium capitalize text-muted-foreground">
      {mode}
    </span>
  )
}

export function SponsorPill({ value }: { value: 'Yes' | 'No' | 'Unknown' }) {
  const cls =
    value === 'Yes' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' :
    value === 'No'  ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400'
  return (
    <span className={`self-start inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {value}
    </span>
  )
}

export function SkillChips({ skills }: { skills: string[] }) {
  if (!skills || skills.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  const shown = skills.slice(0, 6)
  const extra = skills.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span
          key={s}
          className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300 font-medium"
        >
          {s}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">+{extra}</span>
      )}
    </div>
  )
}

export function JobsHeader() {
  return (
    <div
      className={`${TABLE_COLS} hidden lg:grid py-2 border-b text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-background sticky top-0 z-10`}
    >
      <span />
      <span>Company / Role</span>
      <span>Location</span>
      <span>Type</span>
      <span>Salary</span>
      <span>Source</span>
      <span>Sponsor</span>
      <span>Key Skills Match</span>
      <span>Key Gap</span>
      <span className="text-right">Link</span>
    </div>
  )
}

export function JobRowDesktop({
  job,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onDelete,
}: {
  job: JobWithScore
  selected: boolean
  expanded: boolean
  onToggleSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onDelete: (id: string) => void
}) {
  const score = job.job_scores?.[0]
  const meta = job.metadata ?? null
  const viaSource = pickBestSource(job.job_sources)
  const applyUrl = viaSource?.source_url || null
  const fallbackSearchUrl = applyUrl ? null : googleSearchUrl(job.company, job.canonical_title)

  const salaryText = job.salary_min
    ? `$${fmt(job.salary_min)}${job.salary_max ? ` – $${fmt(job.salary_max)}` : '+'}`
    : '—'

  const skills = score?.skills_matched?.length ? score.skills_matched : (job.skills_required ?? [])
  const gap = score?.fit_reason ?? null
  const sponsor: 'Yes' | 'No' | 'Unknown' =
    job.visa_sponsorship === 'yes' ? 'Yes' :
    job.visa_sponsorship === 'no'  ? 'No'  :
                                     'Unknown'

  const descPreview = job.description ? stripHtml(job.description).slice(0, 600) : ''

  return (
    <>
      <div
        className={`${TABLE_COLS} hidden lg:grid py-3 border-b hover:bg-muted/30 transition-colors cursor-pointer ${selected ? 'bg-primary/5' : ''}`}
        onClick={(e) => {
          const el = e.target as HTMLElement
          if (el.closest('button, a, input')) return
          onToggleExpand(job.id)
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(job.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 h-4 w-4 cursor-pointer accent-primary"
          aria-label={`Select ${job.canonical_title}`}
        />

        {/* Company / Role */}
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{job.company}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{job.canonical_title}</p>
        </div>

        {/* Location + work mode pill */}
        <div className="min-w-0">
          <p className="text-xs truncate">{job.location || '—'}</p>
          {job.employment_type && <WorkModePill mode={job.employment_type} />}
        </div>

        {/* Type */}
        <TypePill type={job.job_type} />

        {/* Salary */}
        <span className={`text-xs font-medium ${job.salary_min ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}>
          {salaryText}
        </span>

        {/* Source */}
        {viaSource ? (
          <span
            className={`self-start inline-flex text-xs px-2 py-0.5 rounded font-medium ${SOURCE_COLORS[viaSource.source_name] ?? 'bg-gray-100 text-gray-600'}`}
            title={
              job.job_sources.length > 1
                ? `Also on: ${job.job_sources.filter((s) => s.source_name !== viaSource.source_name).map((s) => SOURCE_LABELS[s.source_name] ?? s.source_name).join(', ')}`
                : undefined
            }
          >
            {SOURCE_LABELS[viaSource.source_name] ?? viaSource.source_name}
            {job.job_sources.length > 1 ? ` +${job.job_sources.length - 1}` : ''}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}

        {/* Sponsor */}
        <SponsorPill value={sponsor} />

        {/* Key Skills Match */}
        <SkillChips skills={skills} />

        {/* Key Gap */}
        <span className="text-xs text-muted-foreground leading-snug line-clamp-3">
          {gap ?? '—'}
        </span>

        {/* Link */}
        <div className="flex items-center gap-1 justify-end">
          {applyUrl ? (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              Apply <ArrowRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <a
              href={fallbackSearchUrl!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="No direct link — opens a Google search"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold transition-colors"
            >
              Search <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(job.id) }}
            className="p-1 text-muted-foreground hover:text-red-500"
            title="Remove (soft delete)"
            aria-label="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded detail panel — full width, outside the grid */}
      {expanded && (
        <div className="hidden lg:block border-b bg-muted/20 px-4 py-4 space-y-3">
          {score?.fit_reason && (
            <p className="text-sm text-muted-foreground">{score.fit_reason}</p>
          )}
          {!score && descPreview && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {descPreview}{descPreview.length >= 600 ? '…' : ''}
            </p>
          )}

          {(job.seniority_level || meta?.years_required != null || (job.benefits_highlights?.length ?? 0) > 0 || meta?.applicant_count != null) && (
            <div className="flex flex-wrap gap-1">
              {job.seniority_level && job.seniority_level !== 'unknown' && <Badge variant="outline" className="text-xs capitalize">{job.seniority_level}</Badge>}
              {meta?.years_required != null && <Badge variant="outline" className="text-xs">{meta.years_required}+ yrs</Badge>}
              {job.benefits_highlights?.some(b => /remote/i.test(b)) && <Badge variant="outline" className="text-xs">Remote</Badge>}
              {job.benefits_highlights?.some(b => /hybrid/i.test(b)) && <Badge variant="outline" className="text-xs">Hybrid</Badge>}
              {job.benefits_highlights?.some(b => /equity|rsu/i.test(b)) && (
                <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-500/40">Equity</Badge>
              )}
              {job.benefits_highlights?.some(b => /401k/i.test(b)) && <Badge variant="outline" className="text-xs">401k</Badge>}
              {job.benefits_highlights?.some(b => /pto/i.test(b)) && <Badge variant="outline" className="text-xs">Unlimited PTO</Badge>}
              {job.benefits_highlights?.some(b => /relocation/i.test(b)) && <Badge variant="outline" className="text-xs">Relocation</Badge>}
              {job.benefits_highlights?.some(b => /sign.on|signing/i.test(b)) && <Badge variant="outline" className="text-xs">Sign-on</Badge>}
              {meta?.applicant_count != null && <Badge variant="outline" className="text-xs">{meta.applicant_count} applicants</Badge>}
            </div>
          )}

          {job.job_sources && job.job_sources.length > 1 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Cross-posted on</p>
              <div className="flex flex-wrap gap-1">
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
            <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
              View original posting →
            </a>
          )}
        </div>
      )}
    </>
  )
}
