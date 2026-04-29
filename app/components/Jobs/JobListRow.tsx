'use client'

import { Trash2, Briefcase } from 'lucide-react'
import type { JobWithScore } from '@/lib/types'
import { relativeTime, postingAgePill, pickBestSource, SOURCE_COLORS, SOURCE_LABELS, AGE_TONE_STYLES } from '@/app/dashboard/jobs/constants'
import { fmt, TYPE_COLORS } from '@/app/components/Jobs/JobTableRow'

export function JobListRow({
  job,
  active,
  selected,
  onOpen,
  onToggleSelect,
  onDelete,
}: {
  job: JobWithScore
  active: boolean
  selected: boolean
  onOpen: (id: string) => void
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const viaSource = pickBestSource(job.job_sources)
  const age = postingAgePill(job.posted_at ?? job.scraped_at)
  const ageFallback = !job.posted_at
  const salaryText = job.salary_min
    ? `$${fmt(job.salary_min)}${job.salary_max ? `–$${fmt(job.salary_max)}` : '+'}`
    : null

  return (
    <div
      className={`flex items-start gap-2 px-3 py-3 border-l-2 border-b cursor-pointer transition-colors
        ${active ? 'border-l-primary bg-primary/5' : 'border-l-transparent hover:bg-muted/30'}`}
      onClick={(e) => {
        const el = e.target as HTMLElement
        if (el.closest('button, a, input')) return
        onOpen(job.id)
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(job.id)}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 h-4 w-4 cursor-pointer accent-primary flex-shrink-0"
        aria-label={`Select ${job.canonical_title}`}
      />

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Line 1: title + age */}
        <div className="flex items-start gap-2">
          <p className="font-semibold text-sm leading-snug flex-1 min-w-0 truncate">{job.canonical_title}</p>
          {age && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${AGE_TONE_STYLES[age.tone]} ${ageFallback ? 'opacity-70' : ''}`}
              title={ageFallback ? `Scraped ${relativeTime(job.scraped_at)}` : `Posted ${relativeTime(job.posted_at)}`}
            >
              {ageFallback ? `~${age.label}` : age.label}
            </span>
          )}
        </div>

        {/* Line 2: company · location · salary */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="truncate max-w-[160px]">{job.company}</span>
          {job.location && <><span>·</span><span className="truncate max-w-[160px]">{job.location}</span></>}
          {salaryText && (
            <><span>·</span><span className="text-green-700 dark:text-green-400 font-medium">{salaryText}</span></>
          )}
        </div>

        {/* Line 3: source / type / work mode pills */}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {viaSource && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SOURCE_COLORS[viaSource.source_name] ?? 'bg-gray-100 text-gray-600'}`}>
              {SOURCE_LABELS[viaSource.source_name] ?? viaSource.source_name}
              {job.job_sources.length > 1 ? ` +${job.job_sources.length - 1}` : ''}
            </span>
          )}
          {job.job_type && job.job_type !== 'unknown' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize ${TYPE_COLORS[job.job_type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300'}`}>
              {job.job_type}
            </span>
          )}
          {job.employment_type && job.employment_type !== 'unknown' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium capitalize">
              {job.employment_type}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(job.id) }}
        className="p-1 text-muted-foreground hover:text-red-500 flex-shrink-0"
        title="Remove (soft delete)"
        aria-label="Remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Deep-dive detail pane: generous reading surface for a single job.
 */

export function JobDetailEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
      <Briefcase className="h-12 w-12 opacity-30 mb-3" />
      <p className="text-sm font-medium">Select a job to see details</p>
      <p className="text-xs mt-1">Use the list on the left, or <kbd className="px-1.5 py-0.5 rounded border text-[10px]">↑</kbd> / <kbd className="px-1.5 py-0.5 rounded border text-[10px]">↓</kbd> to navigate.</p>
    </div>
  )
}
