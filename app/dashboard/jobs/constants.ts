// app/dashboard/jobs/constants.ts
// Shared constants, labels, and helpers for the jobs dashboard.

import type { SearchSourceName } from '@/lib/types'

// ── Source labels & colors ────────────────────────────────────────────────────

export const SOURCE_LABELS: Record<SearchSourceName, string> = {
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

export const SOURCE_COLORS: Record<SearchSourceName, string> = {
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

// Note: 'phd' excluded — PhD postings surface in the dedicated /dashboard/phd tab.
export const AVAILABLE_SOURCES: SearchSourceName[] = [
  'linkedin', 'indeed', 'google', 'career_page',
  'greenhouse', 'lever', 'ashby',
  'glassdoor', 'wellfound', 'ziprecruiter',
  'workday', 'smartrecruiters', 'clearancejobs',
  'hn_hiring', 'yc_waas',
  'workable', 'recruitee', 'teamtailor', 'personio',
]

// ── Source notice badges ──────────────────────────────────────────────────────

export type SourceNoticeTone = 'warn' | 'error' | 'free' | 'info'

export const SOURCE_NOTICES: Partial<Record<SearchSourceName, { label: string; tone: SourceNoticeTone; tooltip: string }>> = {
  google:       { label: '$15/1k',      tone: 'warn', tooltip: 'Uses orgupdate/google-jobs-scraper — $15 per 1,000 jobs.' },
  glassdoor:    { label: 'Paid rental', tone: 'warn', tooltip: 'Apify actor bebity/glassdoor-jobs-scraper requires a paid rental.' },
  ziprecruiter: { label: '$2.49/1k',    tone: 'warn', tooltip: 'Uses fatihtahta/ziprecruiter-scraper — $2.49 per 1,000 jobs.' },
  wellfound:    { label: '$3.49/1k',    tone: 'warn', tooltip: 'Uses clearpath/wellfound-api-ppe — $3.49 per 1,000 jobs.' },
  greenhouse:   { label: 'Free ✨',      tone: 'free', tooltip: 'Uses the public Greenhouse JSON API — no Apify credits.' },
  lever:        { label: 'Free ✨',      tone: 'free', tooltip: 'Uses the public Lever JSON API — no Apify credits.' },
  ashby:        { label: 'Free ✨',      tone: 'free', tooltip: 'Uses the public Ashby JSON API — no Apify credits.' },
}

export const NOTICE_TONE_STYLES: Record<SourceNoticeTone, string> = {
  warn:  'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
  error: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  free:  'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  info:  'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
}

// ── Apply-source priority ─────────────────────────────────────────────────────

export const APPLY_SOURCE_PRIORITY: SearchSourceName[] = [
  'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable',
  'teamtailor', 'recruitee', 'personio', 'career_page',
  'linkedin', 'wellfound', 'glassdoor', 'indeed', 'ziprecruiter',
  'google', 'hn_hiring', 'yc_waas', 'clearancejobs', 'phd',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function relativeTime(iso: string | null): string {
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

export function postingAgePill(iso: string | null): { label: string; tone: 'hot' | 'fresh' | 'stale' | 'old' } | null {
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

export const AGE_TONE_STYLES: Record<'hot' | 'fresh' | 'stale' | 'old', string> = {
  hot:   'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  fresh: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  stale: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
  old:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

export function pickBestSource(
  sources: { source_name: SearchSourceName; source_url: string }[] | undefined
): { source_name: SearchSourceName; source_url: string } | null {
  if (!sources || sources.length === 0) return null
  const withUrl = sources.filter((s) => s.source_url && s.source_url.length > 0)
  const pool = withUrl.length > 0 ? withUrl : sources
  return [...pool].sort((a, b) => {
    const ai = APPLY_SOURCE_PRIORITY.indexOf(a.source_name)
    const bi = APPLY_SOURCE_PRIORITY.indexOf(b.source_name)
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
  })[0] ?? null
}

export function googleSearchUrl(company: string, title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${company} ${title} apply`)}`
}
