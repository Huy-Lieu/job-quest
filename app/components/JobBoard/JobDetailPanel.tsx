'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MapPin, ExternalLink, Trash2, ChevronUp, ArrowRight,
} from 'lucide-react'
import type { JobWithScore, SearchSourceName } from '@/lib/types'
import { SkillSection } from './SkillSection'
import { SkillPill } from '@/app/components/ui/SkillPill'
import { FitScoreBadge } from '@/app/components/ui/FitScoreBadge'
import { CompanyIntelTab } from './CompanyIntelTab'

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<SearchSourceName, string> = {
  linkedin:        'LinkedIn',
  indeed:          'Indeed',
  google:          'Google Jobs',
  career_page:     'Career Page',
  greenhouse:      'Greenhouse',
  lever:           'Lever',
  ashby:           'Ashby',
  glassdoor:       'Glassdoor',
  wellfound:       'Wellfound',
  ziprecruiter:    'ZipRecruiter',
  phd:             'PhD Board',
  workday:         'Workday',
  smartrecruiters: 'SmartRecruiters',
  clearancejobs:   'ClearanceJobs',
  hn_hiring:       'HN Hiring',
  yc_waas:         'YC WaaS',
  workable:        'Workable',
  recruitee:       'Recruitee',
  teamtailor:      'Teamtailor',
  personio:        'Personio',
}

const SOURCE_COLORS: Record<SearchSourceName, string> = {
  linkedin:        'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  indeed:          'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  google:          'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  career_page:     'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
  greenhouse:      'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  lever:           'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  ashby:           'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  glassdoor:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  wellfound:       'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  ziprecruiter:    'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  phd:             'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  workday:         'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  smartrecruiters: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  clearancejobs:   'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  hn_hiring:       'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200',
  yc_waas:         'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-200',
  workable:        'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  recruitee:       'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  teamtailor:      'bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300',
  personio:        'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
}

const TYPE_COLORS: Record<string, string> = {
  full_time:  'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  contract:   'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  internship: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  part_time:  'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
}

const AGE_TONE_STYLES: Record<'hot' | 'fresh' | 'stale' | 'old', string> = {
  hot:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  fresh: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  stale: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
  old:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const diffMs  = Date.now() - then
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1)  return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7)     return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5)    return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12)  return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function postingAgePill(iso: string | null): { label: string; tone: 'hot' | 'fresh' | 'stale' | 'old' } | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days < 1)   return { label: 'TODAY', tone: 'hot' }
  if (days < 7)   return { label: `${days}d`, tone: 'fresh' }
  if (days < 30)  return { label: `${Math.floor(days / 7)}w`, tone: 'stale' }
  if (days < 365) return { label: `${Math.floor(days / 30)}mo`, tone: 'old' }
  return { label: '1y+', tone: 'old' }
}

function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
       : n >= 1_000    ? `${(n / 1_000).toFixed(0)}k`
       : String(n)
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function pickBestSource(
  sources: { source_name: SearchSourceName; source_url: string }[] | undefined
): { source_name: SearchSourceName; source_url: string } | null {
  const PRIORITY: SearchSourceName[] = [
    'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable',
    'teamtailor', 'recruitee', 'personio', 'career_page',
    'linkedin', 'wellfound', 'glassdoor', 'indeed', 'ziprecruiter',
    'google', 'hn_hiring', 'yc_waas', 'clearancejobs', 'phd',
  ]
  if (!sources || sources.length === 0) return null
  const withUrl = sources.filter((s) => s.source_url && s.source_url.length > 0)
  const pool = withUrl.length > 0 ? withUrl : sources
  return [...pool].sort((a, b) => {
    const ai = PRIORITY.indexOf(a.source_name)
    const bi = PRIORITY.indexOf(b.source_name)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })[0] ?? null
}

function googleSearchUrl(company: string, title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${company} ${title} apply`)}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'details' | 'company'

interface JobDetailPanelProps {
  job:      JobWithScore
  onDelete: (id: string) => void
  onClose?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JobDetailPanel({ job, onDelete, onClose }: JobDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('details')

  const score       = job.job_scores?.[0]
  const meta        = job.metadata ?? null
  const viaSource   = pickBestSource(job.job_sources)
  const applyUrl    = viaSource?.source_url || null
  const fallback    = applyUrl ? null : googleSearchUrl(job.company, job.canonical_title)
  const age         = postingAgePill(job.posted_at ?? job.scraped_at)
  const ageFallback = !job.posted_at
  const salaryText  = job.salary_min
    ? '$' + fmt(job.salary_min) + (job.salary_max ? '\u2013$' + fmt(job.salary_max) : '+')
    : null
  const descClean   = job.description ? stripHtml(job.description) : ''
  const sponsor: 'Yes' | 'No' | 'Unknown' =
    job.visa_sponsorship === 'yes' ? 'Yes' :
    job.visa_sponsorship === 'no'  ? 'No'  : 'Unknown'
  const hasRequirements = !!(
    job.seniority_level ||
    meta?.years_required != null ||
    (job.benefits_highlights?.length ?? 0) > 0 ||
    (job.skills_required?.length ?? 0) > 0 ||
    meta?.applicant_count != null ||
    job.visa_sponsorship
  )
  const roleAlignment = (job as JobWithScore & { role_alignment?: string | null }).role_alignment ?? null


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
          {score && <FitScoreBadge score={score.fit_score} />}
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
              title="No direct link -- opens a Google search"
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

        {/* Tab bar */}
        <div className="flex -mx-5 px-5 gap-0">
          {(['details', 'company'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'details' ? 'Job Details' : 'Company Intel'}
            </button>
          ))}
        </div>

      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Job Details tab */}
        {activeTab === 'details' && (
          <div className="px-5 py-5 space-y-5">

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
                  {job.seniority_level && job.seniority_level !== 'unknown' && (
                    <Badge variant="outline" className="text-xs capitalize">{job.seniority_level}</Badge>
                  )}
                  {meta?.years_required != null && (
                    <Badge variant="outline" className="text-xs">{meta.years_required}+ yrs</Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      sponsor === 'Yes' ? 'text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-500/40' :
                      sponsor === 'No'  ? 'text-red-700 border-red-300 dark:text-red-300 dark:border-red-500/40' :
                                          'text-muted-foreground'
                    }`}
                  >
                    Visa: {sponsor}
                  </Badge>
                  {job.benefits_highlights?.map((b) => (
                    <Badge key={b} variant="outline" className="text-xs capitalize">{b}</Badge>
                  ))}
                  {meta?.applicant_count != null && (
                    <Badge variant="outline" className="text-xs">{meta.applicant_count} applicants</Badge>
                  )}
                </div>
                <SkillSection title="Detected skills" skills={job.skills_required ?? []} variant="tech" />
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
                  View original posting
                </a>
              </div>
            )}

          </div>
        )}

        {/* Company Intel tab */}
        {activeTab === 'company' && (
          <CompanyIntelTab
            companyName={job.company}
            jobId={job.id}
            roleAlignment={roleAlignment}
          />
        )}

      </div>
    </div>
  )
}
