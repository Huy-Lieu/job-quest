'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Briefcase, MapPin, Building2, ExternalLink, Loader2,
  Play, Clock, Settings2, ChevronDown, ChevronUp, CheckCircle2,
  XCircle, RefreshCw, Plus, Trash2, Zap, Pencil, Copy, ArrowRight,
} from 'lucide-react'
import type { JobWithScore, SearchConfig, SearchRun, SearchSourceName, ScheduleInterval } from '@/lib/types'
import { SkillPill } from '@/components/ui/SkillPill'
import { toast } from 'sonner'

// ─── Constants ────────────────────────────────────────────────────────────────

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

// Note: 'phd' is intentionally excluded — PhD postings surface in the dedicated
// /dashboard/phd tab. The main board API also filters is_phd=false by default.
const AVAILABLE_SOURCES: SearchSourceName[] = [
  'linkedin', 'indeed', 'google', 'career_page',
  'greenhouse', 'lever', 'ashby',
  'glassdoor', 'wellfound', 'ziprecruiter',
  'workday', 'smartrecruiters', 'clearancejobs',
  'hn_hiring', 'yc_waas',
  'workable', 'recruitee', 'teamtailor', 'personio',
]

// Per-source status notices shown as a badge next to the checkbox.
// Leave a source out of this map for no notice (= normal working source).
type SourceNoticeTone = 'warn' | 'error' | 'free' | 'info'
const SOURCE_NOTICES: Partial<Record<SearchSourceName, { label: string; tone: SourceNoticeTone; tooltip: string }>> = {
  google:       { label: '$15/1k',        tone: 'warn',  tooltip: 'Uses orgupdate/google-jobs-scraper — $15 per 1,000 jobs (pay-per-result). Expensive but returns real apply URLs.' },
  glassdoor:    { label: 'Paid rental',   tone: 'warn',  tooltip: 'Apify actor bebity/glassdoor-jobs-scraper requires a paid rental in Apify. Free trial may have expired.' },
  ziprecruiter: { label: '$2.49/1k',      tone: 'warn',  tooltip: 'Uses fatihtahta/ziprecruiter-scraper — $2.49 per 1,000 jobs, no monthly subscription required.' },
  wellfound:    { label: '$3.49/1k',      tone: 'warn',  tooltip: 'Uses clearpath/wellfound-api-ppe — $3.49 per 1,000 jobs, pay-per-result.' },
  greenhouse:   { label: 'Free ✨',        tone: 'free',  tooltip: 'Uses the public Greenhouse JSON API — no Apify credits consumed.' },
  lever:        { label: 'Free ✨',        tone: 'free',  tooltip: 'Uses the public Lever JSON API — no Apify credits consumed.' },
  ashby:        { label: 'Free ✨',        tone: 'free',  tooltip: 'Uses the public Ashby JSON API — no Apify credits consumed.' },
}

const NOTICE_TONE_STYLES: Record<SourceNoticeTone, string> = {
  warn:  'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
  error: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  free:  'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  info:  'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
}

type Tab = 'jobs' | 'configs' | 'runs'

// ─── Score badge ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30' :
    score >= 50 ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30' :
                  'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30'
  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {score}%
    </span>
  )
}

// ─── Relative time helper ────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const diffMs  = Date.now() - then
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1)    return 'just now'
  if (minutes < 60)   return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)     return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7)       return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5)      return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12)    return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Short posting-age pill: "TODAY", "1d", "3d", "1w", "3mo", "1y+".
 *  Also returns a color palette bucket based on age. */
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

const AGE_TONE_STYLES: Record<'hot' | 'fresh' | 'stale' | 'old', string> = {
  hot:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  fresh: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  stale: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
  old:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── Apply-source priority ───────────────────────────────────────────────────

// Best → worst. ATS drops you directly on the company apply form; aggregators
// add redirects; generic browsers may land on listing pages instead of the role.
const APPLY_SOURCE_PRIORITY: SearchSourceName[] = [
  'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable',
  'teamtailor', 'recruitee', 'personio', 'career_page',
  'linkedin', 'wellfound', 'glassdoor', 'indeed', 'ziprecruiter',
  'google', 'hn_hiring', 'yc_waas', 'clearancejobs', 'phd',
]

function pickBestSource(
  sources: { source_name: SearchSourceName; source_url: string }[] | undefined
): { source_name: SearchSourceName; source_url: string } | null {
  if (!sources || sources.length === 0) return null
  const withUrl = sources.filter((s) => s.source_url && s.source_url.length > 0)
  const pool = withUrl.length > 0 ? withUrl : sources
  const byPriority = [...pool].sort((a, b) => {
    const ai = APPLY_SOURCE_PRIORITY.indexOf(a.source_name)
    const bi = APPLY_SOURCE_PRIORITY.indexOf(b.source_name)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })
  return byPriority[0] ?? null
}

function googleSearchUrl(company: string, title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${company} ${title} apply`)}`
}

// ─── Job card ────────────────────────────────────────────────────────────────

function JobCard({
  job,
  selected,
  onToggleSelect,
  onDelete,
}: {
  job: JobWithScore
  selected: boolean
  onToggleSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const score  = job.job_scores?.[0]
  const meta = job.metadata ?? null

  // Best source for Apply button (ATS > aggregator > browser)
  const viaSource = pickBestSource(job.job_sources)
  const applyUrl  = viaSource?.source_url || null
  const fallbackSearchUrl = applyUrl ? null : googleSearchUrl(job.company, job.canonical_title)

  // Salary: always render something — "Not listed" when null
  const salaryText = job.salary_min
    ? `$${(job.salary_min / 1000).toFixed(0)}k${job.salary_max ? `–${(job.salary_max / 1000).toFixed(0)}k` : '+'}`
    : 'Not listed'

  // Posting age — colored pill. Fall back to scraped_at with "~" prefix.
  const pill = postingAgePill(job.posted_at ?? job.scraped_at)
  const pillIsFallback = !job.posted_at
  const pillLabel = pill ? (pillIsFallback ? `~${pill.label}` : pill.label) : null
  const pillTooltip = pillIsFallback
    ? `Actual posting date unknown; scraped ${relativeTime(job.scraped_at)}`
    : `Posted ${relativeTime(job.posted_at)}`

  const descPreview = job.description ? stripHtml(job.description).slice(0, 600) : ''

  return (
    <Card className={`hover:shadow-sm transition-shadow ${selected ? 'ring-2 ring-primary' : ''}`}>
      <CardHeader className="pb-2">
        {/* ── Line 1: title row + right-side actions ───────────────────────── */}
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(job.id)}
            className="mt-1.5 h-4 w-4 flex-shrink-0 cursor-pointer accent-primary"
            aria-label={`Select ${job.canonical_title}`}
          />

          {/* Title + inline chips (pill / salary / source / sponsor) */}
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base leading-snug">{job.canonical_title}</CardTitle>

            {pill && pillLabel && (
              <span
                title={pillTooltip}
                className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${AGE_TONE_STYLES[pill.tone]} ${pillIsFallback ? 'opacity-70' : ''}`}
              >
                {pillLabel}
              </span>
            )}

            <span className={`text-xs font-medium ${job.salary_min ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground italic'}`}>
              {salaryText}
            </span>

            {viaSource && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[viaSource.source_name] ?? 'bg-gray-100 text-gray-600'}`}
                title={job.job_sources.length > 1 ? `Also on: ${job.job_sources.filter((s) => s.source_name !== viaSource.source_name).map((s) => SOURCE_LABELS[s.source_name] ?? s.source_name).join(', ')}` : undefined}
              >
                {SOURCE_LABELS[viaSource.source_name] ?? viaSource.source_name}
                {job.job_sources.length > 1 ? ` +${job.job_sources.length - 1}` : ''}
              </span>
            )}

            {/* Sponsor chip — always rendered */}
            {job.visa_sponsorship === 'yes' && (
              <Badge variant="outline" className="text-xs text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-500/40">Visa OK</Badge>
            )}
            {job.visa_sponsorship === 'no' && (
              <Badge variant="outline" className="text-xs text-red-700 border-red-300 dark:text-red-300 dark:border-red-500/40">No sponsorship</Badge>
            )}
            {(!job.visa_sponsorship || job.visa_sponsorship === 'unknown') && (
              <Badge variant="outline" className="text-xs text-muted-foreground">Visa: unknown</Badge>
            )}

            {score && <ScoreBadge score={score.fit_score} />}
            {score?.recommended && (
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 text-xs">✦ Recommended</Badge>
            )}
          </div>

          {/* Actions — Apply is prominent, then small ghost buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {applyUrl ? (
              <a href={applyUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="default" size="sm" className="gap-1">
                  Apply <ExternalLink className="h-3 w-3" />
                </Button>
              </a>
            ) : (
              <a href={fallbackSearchUrl!} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm" className="gap-1" title="No direct link — opens a Google search">
                  Search <ExternalLink className="h-3 w-3" />
                </Button>
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-600"
              onClick={() => onDelete(job.id)}
              aria-label="Remove job"
              title="Remove (soft delete)"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* ── Line 2: company · location · type · employment-mode ──────────── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 ml-7 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />{job.company}
          </span>
          {job.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />{job.location}
            </span>
          )}
          {job.job_type && job.job_type !== 'unknown' && (
            <Badge variant="secondary" className="text-xs capitalize">
              {job.job_type.replace('_', '-')}
            </Badge>
          )}
          {job.employment_type && job.employment_type !== 'unknown' && (
            <Badge variant="secondary" className="text-xs capitalize">
              {job.employment_type}
            </Badge>
          )}
          {job.is_phd && (
            <Badge variant="outline" className="text-xs text-purple-600 border-purple-300 dark:text-purple-300 dark:border-purple-500/40">PhD</Badge>
          )}
        </div>

        {/* ── Line 3: optional enrichment badges ───────────────────────────── */}
        {(job.seniority_level || meta?.years_required != null || (job.benefits_highlights?.length ?? 0) > 0 || meta?.applicant_count != null) && (
          <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
            {job.seniority_level && job.seniority_level !== 'unknown' && (
              <Badge variant="outline" className="text-xs capitalize">{job.seniority_level}</Badge>
            )}
            {meta?.years_required != null && (
              <Badge variant="outline" className="text-xs">{meta.years_required}+ yrs</Badge>
            )}
            {job.benefits_highlights?.some(b => /remote/i.test(b)) && (
              <Badge variant="outline" className="text-xs">Remote</Badge>
            )}
            {job.benefits_highlights?.some(b => /hybrid/i.test(b)) && (
              <Badge variant="outline" className="text-xs">Hybrid</Badge>
            )}
            {job.benefits_highlights?.some(b => /equity|rsu/i.test(b)) && (
              <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-500/40">Equity</Badge>
            )}
            {job.benefits_highlights?.some(b => /401k/i.test(b)) && (
              <Badge variant="outline" className="text-xs">401k</Badge>
            )}
            {job.benefits_highlights?.some(b => /pto/i.test(b)) && (
              <Badge variant="outline" className="text-xs">Unlimited PTO</Badge>
            )}
            {job.benefits_highlights?.some(b => /relocation/i.test(b)) && (
              <Badge variant="outline" className="text-xs">Relocation</Badge>
            )}
            {job.benefits_highlights?.some(b => /sign.on|signing/i.test(b)) && (
              <Badge variant="outline" className="text-xs">Sign-on</Badge>
            )}
            {meta?.applicant_count != null && (
              <Badge variant="outline" className="text-xs">{meta.applicant_count} applicants</Badge>
            )}
          </div>
        )}
      </CardHeader>

      {/* Expanded panel */}
      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-3">
          {score?.fit_reason && (
            <p className="text-sm text-muted-foreground">{score.fit_reason}</p>
          )}

          {/* Description preview when no score available */}
          {!score && descPreview && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {descPreview}{descPreview.length >= 600 ? '…' : ''}
            </p>
          )}

          {/* Matched / missing skills (only when scored) */}
          {score && (
            <div className="flex flex-wrap gap-4">
              {score.skills_matched?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Skills matched</p>
                  <div className="flex flex-wrap gap-1">
                    {score.skills_matched.map((s) => (
                      <SkillPill key={s} label={s} variant="matched" />
                    ))}
                  </div>
                </div>
              )}
              {score.skills_missing?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Skills missing</p>
                  <div className="flex flex-wrap gap-1">
                    {score.skills_missing.map((s) => (
                      <SkillPill key={s} label={s} variant="missing" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Skills from enrichment when we have no score */}
          {!score && (job.skills_required?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Detected skills</p>
              <div className="flex flex-wrap gap-1">
                {job.skills_required!.map((s) => (
                  <span key={s} className="text-xs bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30 rounded-full px-2 py-0.5">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* All sources — shown in expanded panel (collapsed view shows only "via" source) */}
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
                    className={`text-xs px-2 py-0.5 rounded-full font-medium hover:opacity-80 ${SOURCE_COLORS[s.source_name] ?? 'bg-gray-100 text-gray-600'}`}
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
        </CardContent>
      )}
    </Card>
  )
}

// ─── Tabular row (desktop ≥ lg) ──────────────────────────────────────────────

/** Format a salary number to "120k" / "1.2M" style. */
function fmt(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
       : n >= 1_000    ? `${(n / 1_000).toFixed(0)}k`
       : String(n)
}

/** Shared 10-column grid definition used by the header and every row. */
const TABLE_COLS =
  'grid grid-cols-[36px_minmax(220px,2.5fr)_140px_100px_130px_100px_90px_minmax(180px,2fr)_minmax(180px,2fr)_150px] gap-3 px-4 items-start'

const TYPE_COLORS: Record<string, string> = {
  'full_time':  'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  'contract':   'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'internship': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'part_time':  'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
}

function TypePill({ type }: { type: string | null }) {
  if (!type || type === 'unknown') return <span className="text-xs text-muted-foreground">—</span>
  const cls = TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300'
  return (
    <span className={`self-start inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>
      {type}
    </span>
  )
}

function WorkModePill({ mode }: { mode: string }) {
  if (!mode || mode === 'unknown') return null
  return (
    <span className="inline-flex mt-1 px-2 py-0.5 rounded bg-muted text-[11px] font-medium capitalize text-muted-foreground">
      {mode}
    </span>
  )
}

function SponsorPill({ value }: { value: 'Yes' | 'No' | 'Unknown' }) {
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

function SkillChips({ skills }: { skills: string[] }) {
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

function JobsHeader() {
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

function JobRowDesktop({
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

// ─── Master-detail: compact list row + deep-dive detail pane ─────────────────

/**
 * Compact list row for the split view.
 * Click anywhere (except checkbox / delete) opens the detail pane.
 */
function JobListRow({
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
function JobDetailPane({
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

function JobDetailEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
      <Briefcase className="h-12 w-12 opacity-30 mb-3" />
      <p className="text-sm font-medium">Select a job to see details</p>
      <p className="text-xs mt-1">Use the list on the left, or <kbd className="px-1.5 py-0.5 rounded border text-[10px]">↑</kbd> / <kbd className="px-1.5 py-0.5 rounded border text-[10px]">↓</kbd> to navigate.</p>
    </div>
  )
}

// ─── Search Run button + panel ────────────────────────────────────────────────

function RunSearchPanel({
  configs,
  runningConfigIds,
  runSearch,
}: {
  configs: SearchConfig[]
  runningConfigIds: Set<string>
  runSearch: (configId: string, configName: string, opts?: { switchToRunsTab?: boolean }) => Promise<void>
}) {
  const [open, setOpen]             = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')

  // Derive the active config ID in render — no effect needed.
  const effectiveId = selectedId || configs[0]?.id || ''
  const running = runningConfigIds.has(effectiveId)

  function handleStart() {
    if (!effectiveId) return
    const name = configs.find((c) => c.id === effectiveId)?.name ?? 'search'
    setOpen(false)
    void runSearch(effectiveId, name)   // fire-and-forget; parent owns the UI feedback
  }

  return (
    <div className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        className="gap-2"
        disabled={configs.length === 0 || running}
        title={configs.length === 0 ? 'Create a search config first' : undefined}
      >
        {running
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching…</>
          : <><Play className="h-4 w-4" /> Run Search</>}
      </Button>
      {running && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-background border rounded-lg shadow-lg p-4 z-10 space-y-3">
          <p className="text-sm font-medium">Choose a search config to run</p>

          <select
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={effectiveId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.keywords.slice(0, 3).join(', ')}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <Button onClick={handleStart} disabled={running} size="sm" className="gap-1 flex-1">
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</> : <><Zap className="h-3.5 w-3.5" /> Start</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Search runs take 30–90 seconds. Results appear in the Jobs tab when complete.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── New Config Form ──────────────────────────────────────────────────────────

interface ConfigFormProps {
  // create-mode
  onCreated?:     (c: SearchConfig) => void
  // edit-mode
  mode?:          'create' | 'edit'
  initialValues?: SearchConfig
  onSaved?:       (c: SearchConfig) => void
  onClose?:       () => void
}

function NewConfigForm({
  onCreated,
  mode = 'create',
  initialValues,
  onSaved,
  onClose,
}: ConfigFormProps) {
  const isEdit = mode === 'edit'

  // Create-mode uses an internal toggle ("+ New Config" button opens the form).
  // Edit-mode renders as a modal driven by the parent, so `open` is forced true.
  const [open, setOpen] = useState(isEdit)

  // Seed each field from `initialValues` when editing, else use create defaults.
  const [name, setName]           = useState(initialValues?.name ?? '')
  const [keywords, setKeywords]   = useState((initialValues?.keywords ?? []).join(', '))
  const [companies, setCompanies] = useState((initialValues?.target_companies ?? []).join(', '))
  const [locations, setLocations] = useState(
    (initialValues?.locations ?? ['United States']).join(', ')
  )
  const [sources, setSources]     = useState<SearchSourceName[]>(
    initialValues?.sources ?? [...AVAILABLE_SOURCES]
  )
  const [schedule, setSchedule]   = useState<ScheduleInterval>(
    initialValues?.schedule_interval ?? 'daily'
  )
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  function toggleSource(s: SearchSourceName) {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  function resetCreateFields() {
    setName(''); setKeywords(''); setCompanies(''); setLocations('United States')
    setSources([...AVAILABLE_SOURCES]); setSchedule('daily')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      name:              name.trim() || null,
      keywords:          keywords.split(',').map((k) => k.trim()).filter(Boolean),
      target_companies:  companies.split(',').map((c) => c.trim()).filter(Boolean),
      locations:         locations.split(',').map((l) => l.trim()).filter(Boolean),
      sources,
      schedule_interval: schedule,
    }

    const res = await fetch('/api/search/configs', {
      method:  isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(isEdit ? { id: initialValues!.id, ...payload } : payload),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to save config')
      setSaving(false)
      return
    }

    setSaving(false)
    if (isEdit) {
      onSaved?.(data)
      onClose?.()
    } else {
      onCreated?.(data)
      setOpen(false)
      resetCreateFields()
    }
  }

  // Form body shared between create (inline card) and edit (modal overlay).
  const formBody = (
    <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium">Name (optional)</label>
                <Input placeholder="e.g. NVIDIA Hardware Roles" value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Keywords <span className="text-red-500">*</span></label>
                <Input placeholder="embedded engineer, hardware verification, FPGA" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma-separated</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Target Companies</label>
                <Input placeholder="NVIDIA, Qualcomm, Intel" value={companies} onChange={(e) => setCompanies(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma-separated (leave blank to search all)</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Locations</label>
                <Input placeholder="United States, Remote" value={locations} onChange={(e) => setLocations(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Sources</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_SOURCES.map((s) => {
                    const notice = SOURCE_NOTICES[s]
                    return (
                      <div key={s} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleSource(s)}
                          className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                            sources.includes(s)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border hover:border-foreground'
                          }`}
                        >
                          {SOURCE_LABELS[s]}
                        </button>
                        {notice && (
                          <span
                            title={notice.tooltip}
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium cursor-help ${NOTICE_TONE_STYLES[notice.tone]}`}
                          >
                            {notice.label}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-emerald-700 dark:text-emerald-400 font-medium">Free</span> = no Apify credits.{' '}
                  <span className="text-amber-800 dark:text-amber-300 font-medium">Paid rental</span> = needs Apify subscription.{' '}
                  <span className="text-red-800 dark:text-red-400 font-medium">Unavailable</span> = actor broken, disable to avoid errors.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Schedule</label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value as ScheduleInterval)}
                >
                  <option value="daily">Daily (07:00 UTC)</option>
                  <option value="6h">Every 6 hours</option>
                  <option value="manual">Manual only</option>
                </select>
              </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !keywords.trim()} className="gap-1">
          {saving
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
            : isEdit ? 'Save changes' : 'Save Config'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => (isEdit ? onClose?.() : setOpen(false))}
        >
          Cancel
        </Button>
      </div>
    </form>
  )

  // ── Edit mode: modal overlay ───────────────────────────────────────────────
  if (isEdit) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
        onClick={() => onClose?.()}
      >
        <Card className="w-full max-w-xl my-8" onClick={(e) => e.stopPropagation()}>
          <CardHeader>
            <CardTitle className="text-base">Edit Search Config</CardTitle>
          </CardHeader>
          <CardContent>{formBody}</CardContent>
        </Card>
      </div>
    )
  }

  // ── Create mode: inline collapse under the "New Config" button ─────────────
  return (
    <div>
      <Button variant="outline" className="gap-2" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-4 w-4" /> New Config
      </Button>

      {open && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Create Search Config</CardTitle>
          </CardHeader>
          <CardContent>{formBody}</CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Run status icon ─────────────────────────────────────────────────────────

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 text-green-500" />
  if (status === 'failed')   return <XCircle className="h-4 w-4 text-red-500" />
  return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('jobs')

  // Jobs tab state
  const [jobs, setJobs]           = useState<JobWithScore[]>([])
  const [total, setTotal]         = useState(0)
  const [offset, setOffset]       = useState(0)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [jobsError, setJobsError] = useState('')

  // Filters
  const [minScore, setMinScore]           = useState(0)
  const [source, setSource]               = useState('')
  const [jobType, setJobType]             = useState('')
  const [recommendedOnly, setRecommendedOnly] = useState(false)

  // Multi-select (bulk delete)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Master-detail: which job is showing in the detail pane (or mobile sheet).
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [detailOpenMobile, setDetailOpenMobile] = useState(false)

  const openJob = useCallback((id: string) => {
    setActiveJobId(id)
    setDetailOpenMobile(true)
  }, [])
  const closeJobMobile = useCallback(() => setDetailOpenMobile(false), [])

  // Lookup the full job record for the current selection (null if the active
  // id has since been removed or we haven't loaded it yet).
  const activeJob = activeJobId ? jobs.find((j) => j.id === activeJobId) ?? null : null

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const deleteOne = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setJobsError('Failed to remove job')
      return
    }
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setTotal((t) => Math.max(0, t - 1))
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const deleteBulk = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = [...selectedIds]
    const res = await fetch('/api/jobs/bulk-delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids }),
    })
    setBulkDeleting(false)
    if (!res.ok) {
      setJobsError('Failed to remove selected jobs')
      return
    }
    setJobs((prev) => prev.filter((j) => !selectedIds.has(j.id)))
    setTotal((t) => Math.max(0, t - ids.length))
    clearSelection()
  }, [selectedIds, clearSelection])

  // Configs tab state
  const [configs, setConfigs]       = useState<SearchConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [editingConfig, setEditingConfig] = useState<SearchConfig | null>(null)

  // Runs tab state
  const [runs, setRuns]           = useState<SearchRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)

  const LIMIT = 20

  // ── Fetch functions ─────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async (newOffset = 0, append = false) => {
    setLoadingJobs(true)
    setJobsError('')
    try {
      const params = new URLSearchParams({
        limit:  String(LIMIT),
        offset: String(newOffset),
        min_score: String(minScore),
      })
      params.set('phd', 'false')
      if (source)           params.set('source', source)
      if (jobType)          params.set('job_type', jobType)
      if (recommendedOnly)  params.set('recommended', 'true')

      const res  = await fetch(`/api/jobs?${params}`)
      const data = await res.json()

      if (!res.ok) {
        setJobsError(data.error ?? 'Failed to load jobs')
        return
      }

      setTotal(data.total ?? 0)
      setOffset(newOffset)
      setJobs((prev) => append ? [...prev, ...(data.jobs ?? [])] : (data.jobs ?? []))
    } finally {
      setLoadingJobs(false)
    }
  }, [minScore, source, jobType, recommendedOnly])

  const fetchConfigs = useCallback(async () => {
    setLoadingConfigs(true)
    try {
      const res  = await fetch('/api/search/configs?scope=jobs')
      const data = await res.json()
      if (res.ok) setConfigs(data)
    } finally {
      setLoadingConfigs(false)
    }
  }, [])

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const res  = await fetch('/api/search/runs?limit=20&scope=jobs')
      const data = await res.json()
      if (res.ok) setRuns(data)
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  // ── Shared run helper — used by both the header panel and per-config Run now ─
  // Local state holds optimistic additions (clicked just now — the server
  // hasn't registered status='running' yet). Merged below with runs-table
  // state so a page reload still sees the in-flight search as running.
  const [optimisticRunningIds, setOptimisticRunningIds] = useState<Set<string>>(new Set())

  const serverRunningIds = new Set(
    runs
      .filter((r) => r.status === 'running' && r.config_id)
      .map((r) => r.config_id as string)
  )

  const runningConfigIds = new Set<string>([...optimisticRunningIds, ...serverRunningIds])

  const runSearch = useCallback(async (
    configId: string,
    configName: string,
    opts?: { switchToRunsTab?: boolean },
  ) => {
    setOptimisticRunningIds((prev) => {
      const next = new Set(prev)
      next.add(configId)
      return next
    })
    const toastId = toast.loading(`Running ${configName}…`, {
      description: 'Scraping sources in parallel. This usually takes 30–90 seconds.',
      duration: Infinity,
    })
    try {
      const res  = await fetch('/api/search/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ configId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(`Search failed: ${data.error ?? 'Unknown error'}`, { id: toastId, duration: 6000 })
        return
      }
      toast.success(
        `Search complete — ${data.jobsFound} found · ${data.jobsNew} new · ${data.jobsScored} scored`,
        { id: toastId, duration: 5000 },
      )
      fetchJobs(0)
      fetchRuns()
      if (opts?.switchToRunsTab) setTab('runs')
    } catch {
      toast.error('Network error — please try again', { id: toastId, duration: 6000 })
    } finally {
      setOptimisticRunningIds((prev) => {
        const next = new Set(prev)
        next.delete(configId)
        return next
      })
    }
  }, [fetchJobs, fetchRuns])

  // ── Duplicate + save helpers for the Configs tab ────────────────────────────

  const duplicateConfig = useCallback(async (c: SearchConfig) => {
    const baseName = c.name ?? c.keywords.slice(0, 3).join(', ')
    const res = await fetch('/api/search/configs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:              `${baseName} (copy)`,
        keywords:          c.keywords,
        target_companies:  c.target_companies,
        locations:         c.locations,
        sources:           c.sources,
        career_page_urls:  c.career_page_urls,
        schedule_interval: c.schedule_interval,
      }),
    })
    if (res.ok) {
      const newConfig = await res.json()
      setConfigs((prev) => [newConfig, ...prev])
      toast.success(`Duplicated "${baseName}"`)
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(`Duplicate failed: ${data.error ?? res.statusText}`)
    }
  }, [])

  const onConfigSaved = useCallback((updated: SearchConfig) => {
    setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    setEditingConfig(null)
    toast.success('Config updated')
  }, [])

  // ── Initial loads ───────────────────────────────────────────────────────────

  useEffect(() => { fetchJobs(0) },     [fetchJobs])
  useEffect(() => { fetchConfigs() },   [fetchConfigs])
  // Always fetch runs on mount so the Run button reflects any in-flight search
  // across page reloads, not just when the Runs tab is active.
  useEffect(() => { fetchRuns() },      [fetchRuns])

  // Poll runs every 5s while any are in-flight. Stops automatically when done.
  useEffect(() => {
    if (serverRunningIds.size === 0) return
    const t = setInterval(() => { fetchRuns(); fetchJobs(0) }, 5000)
    return () => clearInterval(t)
  }, [serverRunningIds.size, fetchRuns, fetchJobs])

  // Re-fetch jobs when filters change
  useEffect(() => { fetchJobs(0) }, [minScore, source, jobType, recommendedOnly, fetchJobs])

  // Auto-select the first job so the detail pane isn't empty on first load.
  // Also recovers selection if the active job got soft-deleted or filtered out.
  useEffect(() => {
    if (jobs.length === 0) return
    if (!activeJobId || !jobs.find((j) => j.id === activeJobId)) {
      setActiveJobId(jobs[0].id)
    }
  }, [jobs, activeJobId])

  // Keyboard navigation: ↑ / ↓ moves the detail-pane selection through the list.
  useEffect(() => {
    if (tab !== 'jobs') return
    function onKey(e: KeyboardEvent) {
      if (detailOpenMobile) return
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (jobs.length === 0) return
      e.preventDefault()
      const idx = activeJobId ? jobs.findIndex((j) => j.id === activeJobId) : -1
      const next = e.key === 'ArrowDown'
        ? Math.min(jobs.length - 1, idx + 1)
        : Math.max(0, idx - 1)
      setActiveJobId(jobs[next].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, jobs, activeJobId, detailOpenMobile])

  // ── Tabs ────────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'jobs',    label: 'Jobs',    icon: <Briefcase className="h-3.5 w-3.5" />, count: total || undefined },
    { key: 'configs', label: 'Configs', icon: <Settings2 className="h-3.5 w-3.5" />, count: configs.length || undefined },
    { key: 'runs',    label: 'Runs',    icon: <Clock className="h-3.5 w-3.5" /> },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Job Board</h2>
          <p className="text-muted-foreground mt-1">
            AI-scored jobs from LinkedIn, Indeed, Google Jobs, and company career pages. PhD positions are in the <strong>PhD Search</strong> tab.
          </p>
        </div>
        <RunSearchPanel configs={configs} runningConfigIds={runningConfigIds} runSearch={runSearch} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {tabs.map(({ key, label, icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {icon}{label}
              {count !== undefined && (
                <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* ── Jobs Tab ─────────────────────────────────────────────────────────── */}
      {tab === 'jobs' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Min score</label>
              <input
                type="range"
                min={0}
                max={90}
                step={10}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-xs w-7 text-center">{minScore}%</span>
            </div>

            <select
              className="border rounded-md px-2 py-1 text-xs bg-background"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">All sources</option>
              {AVAILABLE_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>

            <select
              className="border rounded-md px-2 py-1 text-xs bg-background"
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
            >
              <option value="">All types</option>
              <option value="full_time">Full-time</option>
              <option value="internship">Internship</option>
              <option value="contract">Contract</option>
              <option value="part_time">Part-time</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={recommendedOnly}
                onChange={(e) => setRecommendedOnly(e.target.checked)}
                className="rounded"
              />
              Recommended
            </label>

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1 text-xs"
              onClick={() => fetchJobs(0)}
              disabled={loadingJobs}
            >
              <RefreshCw className={`h-3 w-3 ${loadingJobs ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Error */}
          {jobsError && (
            <Alert variant="destructive">
              <AlertDescription>{jobsError}</AlertDescription>
            </Alert>
          )}

          {/* Loading */}
          {loadingJobs && jobs.length === 0 && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading scored jobs…
            </div>
          )}

          {/* Empty state */}
          {!loadingJobs && jobs.length === 0 && !jobsError && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Briefcase className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
                <p className="font-semibold">No jobs yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Click <strong>Run Search</strong> to trigger your first Apify scrape.
                  Upload a resume to get AI fit scores; otherwise jobs show up unscored.
                </p>
                {configs.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    You need a <button className="underline" onClick={() => setTab('configs')}>search config</button> first.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Job list */}
          {jobs.length > 0 && (
            <>
              {/* Bulk action bar — shown when any rows selected */}
              {selectedIds.size > 0 ? (
                <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-4 py-2">
                  <p className="text-sm font-medium">{selectedIds.size} selected</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={deleteBulk}
                      disabled={bulkDeleting}
                      className="gap-1"
                    >
                      {bulkDeleting
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Removing…</>
                        : <><Trash2 className="h-3.5 w-3.5" /> Remove {selectedIds.size}</>}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearSelection}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{total} jobs found</p>
              )}
              {/* Master-detail split (≥ lg) */}
              <div className="hidden lg:grid grid-cols-[minmax(380px,42%)_1fr] gap-4 h-[calc(100vh-280px)] min-h-[520px]">
                {/* List pane */}
                <div className="rounded-lg border overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-y-auto">
                    {jobs.map((job) => (
                      <JobListRow
                        key={job.id}
                        job={job}
                        active={activeJobId === job.id}
                        selected={selectedIds.has(job.id)}
                        onOpen={openJob}
                        onToggleSelect={toggleSelect}
                        onDelete={deleteOne}
                      />
                    ))}
                  </div>
                </div>

                {/* Detail pane */}
                <div className="rounded-lg border overflow-hidden">
                  {activeJob
                    ? <JobDetailPane job={activeJob} onDelete={deleteOne} />
                    : <JobDetailEmptyState />}
                </div>
              </div>

              {/* Mobile list (< lg) — compact rows, tap opens sheet */}
              <div className="lg:hidden rounded-lg border overflow-hidden">
                {jobs.map((job) => (
                  <JobListRow
                    key={job.id}
                    job={job}
                    active={activeJobId === job.id}
                    selected={selectedIds.has(job.id)}
                    onOpen={openJob}
                    onToggleSelect={toggleSelect}
                    onDelete={deleteOne}
                  />
                ))}
              </div>

              {/* Mobile detail sheet — full-screen overlay */}
              {detailOpenMobile && activeJob && (
                <div className="lg:hidden fixed inset-0 bg-background z-50 overflow-hidden">
                  <JobDetailPane job={activeJob} onDelete={deleteOne} onClose={closeJobMobile} />
                </div>
              )}

              {offset + LIMIT < total && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => fetchJobs(offset + LIMIT, true)}
                    disabled={loadingJobs}
                    className="gap-2"
                  >
                    {loadingJobs
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</>
                      : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Configs Tab ──────────────────────────────────────────────────────── */}
      {tab === 'configs' && (
        <div className="space-y-4">
          <NewConfigForm onCreated={(c) => setConfigs((prev) => [c, ...prev])} />

          {loadingConfigs ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading configs…
            </div>
          ) : configs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Settings2 className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
                <p className="font-semibold">No search configs yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create a config above to define which jobs Claude should search and score for you.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {configs.map((config) => (
                <Card key={config.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">
                          {config.name ?? config.keywords.slice(0, 3).join(', ')}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {config.keywords.map((k) => (
                            <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {config.locations.length > 0 && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />{config.locations.join(', ')}
                            </span>
                          )}
                          {config.target_companies.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />{config.target_companies.slice(0, 3).join(', ')}
                              {config.target_companies.length > 3 && ` +${config.target_companies.length - 3}`}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{config.schedule_interval}
                          </span>
                          {config.last_run_at && (
                            <span>
                              Last run {new Date(config.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {config.sources.map((s) => (
                            <span
                              key={s}
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[s] ?? 'bg-gray-100 text-gray-600'}`}
                            >
                              {SOURCE_LABELS[s]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={runningConfigIds.has(config.id)}
                          onClick={() => runSearch(config.id, config.name ?? 'search', { switchToRunsTab: true })}
                        >
                          {runningConfigIds.has(config.id)
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
                            : <><Play className="h-3.5 w-3.5" /> Run now</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingConfig(config)}
                          title="Edit"
                          aria-label="Edit config"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => duplicateConfig(config)}
                          title="Duplicate"
                          aria-label="Duplicate config"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-red-500"
                          onClick={async () => {
                            await fetch(`/api/search/configs?id=${config.id}`, { method: 'DELETE' })
                            setConfigs((prev) => prev.filter((c) => c.id !== config.id))
                          }}
                          title="Delete"
                          aria-label="Delete config"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Edit modal — renders when a config has been selected for editing */}
          {editingConfig && (
            <NewConfigForm
              mode="edit"
              initialValues={editingConfig}
              onSaved={onConfigSaved}
              onClose={() => setEditingConfig(null)}
            />
          )}
        </div>
      )}

      {/* ── Runs Tab ─────────────────────────────────────────────────────────── */}
      {tab === 'runs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1" onClick={fetchRuns} disabled={loadingRuns}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingRuns ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          {loadingRuns ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          ) : runs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-10 w-10 text-muted-foreground mb-3 opacity-30" />
                <p className="font-semibold">No search runs yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Run a search to see results here.
                </p>
              </CardContent>
            </Card>
          ) : (
            runs.map((run) => (
              <Card key={run.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <RunStatusIcon status={run.status} />
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {run.status}
                          {run.search_configs?.name
                            ? ` — ${run.search_configs.name}`
                            : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(run.started_at).toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour:  '2-digit', minute: '2-digit',
                          })}
                          {run.completed_at && ` · ${Math.round(
                            (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000
                          )}s`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span><span className="font-medium text-foreground">{run.jobs_found}</span> found</span>
                      <span><span className="font-medium text-foreground">{run.jobs_new}</span> new</span>
                      <span><span className="font-medium text-foreground">{run.jobs_scored}</span> scored</span>
                    </div>
                  </div>
                  {run.error_text && (
                    <p className="mt-2 text-xs text-red-500">{run.error_text}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  )
}
