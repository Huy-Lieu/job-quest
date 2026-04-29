'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ExternalLink, Trash2, MapPin,
  ChevronDown, ChevronUp, ArrowRight,
  Brain, Target, Zap, Users, Clock, CheckCircle2,
  AlertCircle, Lightbulb, DollarSign, Briefcase, GraduationCap, CalendarClock,
  Building2, Loader2, RefreshCw,
} from 'lucide-react'
import type { JobWithScore, IntelSignal, RoleCompanyIntel } from '@/lib/types'
import type { RoleIntel } from '@/lib/claude/enricher'
import { SkillPill } from '@/app/components/ui/SkillPill'
import {
  SOURCE_LABELS, SOURCE_COLORS, AGE_TONE_STYLES,
  relativeTime, postingAgePill, pickBestSource, googleSearchUrl,
} from '@/app/dashboard/jobs/constants'
import { fmt, TYPE_COLORS } from '@/app/components/Jobs/JobTableRow'

// ── Job description renderer ──────────────────────────────────────────────────

const JD_SECTION_HEADERS = /^(what you[''']ll be doing|what we need to see|what we[''']re looking for|ways to stand out from the crowd|ways to stand out|about the role|about the team|about you|responsibilities|key responsibilities|requirements|qualifications|preferred qualifications|minimum qualifications|basic qualifications|additional qualifications|nice to have|bonus points|benefits|compensation|who you are|the role|your role|your impact|your background|your qualifications|what you will do|what you['']ll do|what you bring|what you['']ll bring|you will|you have|you are|we offer|we provide|the team|our team|what we offer|why join us|what makes this role exciting|location|the opportunity|who we are|your day to day|day to day|you['']ll be responsible for|core responsibilities)[\s:]*$/i

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text)
}

function renderHtmlDescription(html: string): React.ReactNode {
  const normalized = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '|||LI|||')
    .replace(/<\/ul>|<\/ol>/gi, '\n')
    .replace(/<li[^>]*>/gi, '')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
  const lines = normalized.split(/\n/).map(l => l.trim()).filter(Boolean)
  return renderPlainLines(lines, 0)
}

function renderPlainLines(lines: string[], startKey = 0): React.ReactNode {
  const sections: React.ReactNode[] = []
  let key = startKey

  interface Section { header: string | null; items: string[] }
  const parsed: Section[] = []
  let current: Section = { header: null, items: [] }

  for (const line of lines) {
    const liParts = line.split('|||LI|||').map(s => s.trim()).filter(Boolean)
    if (liParts.length > 1) { liParts.forEach(p => current.items.push(p)); continue }
    const cleanLine = line.replace(/\*\*(.*?)\*\*/g, '$1').trim()
    if (JD_SECTION_HEADERS.test(cleanLine)) {
      if (current.header !== null || current.items.length > 0) parsed.push(current)
      current = { header: cleanLine.replace(/[:\s]+$/, ''), items: [] }
    } else {
      current.items.push(line)
    }
  }
  if (current.header !== null || current.items.length > 0) parsed.push(current)

  for (const section of parsed) {
    if (section.header) {
      sections.push(
        <p key={key++} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-1.5">
          {section.header}
        </p>
      )
    }
    const looksLikeList = section.items.every(i => i.length < 200)
    if (looksLikeList && section.items.length > 1) {
      sections.push(
        <ul key={key++} className="space-y-1 mb-1">
          {section.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
              <span>{renderInlineBold(item)}</span>
            </li>
          ))}
        </ul>
      )
    } else {
      section.items.forEach(item => {
        sections.push(
          <p key={key++} className="text-sm text-foreground leading-relaxed mb-1.5">
            {renderInlineBold(item)}
          </p>
        )
      })
    }
  }
  return <>{sections}</>
}

function renderInlineBold(text: string): React.ReactNode {
  if (!text.includes('**')) return text
  const parts = text.split(/(\*\*.*?\*\*)/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
          : part
      )}
    </>
  )
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
}

function renderJobDescription(raw: string): React.ReactNode {
  if (!raw) return null
  // Decode HTML entities regardless of whether the text is HTML or plain text
  const decoded = decodeEntities(raw)
  if (isHtml(decoded)) return renderHtmlDescription(decoded)
  // Split "Header: content" inline into separate lines so the section header
  // regex can match the keyword as a standalone line
  const withHeaderSplit = decoded.replace(
    /^(What you[''']ll be doing|What we need to see|What we[''']re looking for|Ways to stand out from the crowd|Ways to stand out|About the role|About the team|About you|Responsibilities|Key responsibilities|Requirements|Qualifications|Preferred qualifications|Minimum qualifications|Basic qualifications|Nice to have|Bonus points|Benefits|Compensation|Who you are|The role|Your role|Your impact|Your background|What you will do|What you['']ll do|What you bring|You will|We offer|Why join us|Your day to day|Day to day):\s+/gim,
    '$1\n'
  )
  const lines = withHeaderSplit.split(/\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length <= 2) {
    const split = withHeaderSplit
      .replace(
        /([.!?])\s+(What you[''']ll be doing|What we need to see|What we[''']re looking for|Ways to stand out from the crowd|Ways to stand out|About the role|About the team|Responsibilities|Key responsibilities|Requirements|Qualifications|Preferred qualifications|Minimum qualifications|Basic qualifications|Nice to have|Bonus points|Benefits|Compensation|Who you are|The role|Your role|Your impact|Your background|What you will do|What you['']ll do|What you bring|You will|We offer|Why join us|Your day to day|Day to day)/gi,
        '$1\n$2'
      )
      .split(/\n/).map(l => l.trim()).filter(Boolean)
    return renderPlainLines(split)
  }
  return renderPlainLines(lines)
}

// ── JD Intelligence helpers ───────────────────────────────────────────────────

const OWNERSHIP_LABELS: Record<string, string> = {
  executor:    'Executor — follows direction',
  contributor: 'Contributor — owns tasks',
  lead:        'Lead — drives decisions',
  owner:       'Owner — full accountability',
}

const OWNERSHIP_COLORS: Record<string, string> = {
  executor:    'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
  contributor: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  lead:        'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  owner:       'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
}

function SubHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
  )
}

function IntelCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border divide-y divide-border/50 bg-muted/20">
      {children}
    </div>
  )
}

function IntelRow({ icon, label, value }: {
  icon:  React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex gap-3 px-3 py-2.5 last:border-0">
      <div className="flex-shrink-0 mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
        <div className="text-sm text-foreground leading-relaxed">{value}</div>
      </div>
    </div>
  )
}

function Chips({ items, chipClass }: { items: string[]; chipClass?: string }) {
  if (!items.length) return <span className="text-muted-foreground text-xs">None noted</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span key={i} className={chipClass ?? 'text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground font-medium'}>
          {item}
        </span>
      ))}
    </div>
  )
}

// ── JD Intelligence section ───────────────────────────────────────────────────
// Five subsections per Phase 3 plan:
//   1. Role in plain English  (role_translation)
//   2. Required vs Nice-to-Have (skills_required / skills_preferred — passed as props)
//   3. ATS Keywords            (ats_keywords)
//   4. Hiring signals          (hiring_signals)
//   5. Practical snapshot      (salary, work_mode, seniority, experience — passed as props)

interface JdIntelProps {
  intel:               RoleIntel
  skillsRequired:      string[]
  skillsPreferred:     string[]
  salaryMin:           number | null
  salaryMax:           number | null
  salaryLevels:        Array<{ level: string; min: number; max: number }> | null
  workMode:            string | null
  seniorityLevel:      string | null
  expYearsMin:         number | null
  expYearsMax:         number | null
  visaSponsorship:     string | null
  applicationDeadline: string | null
}

function deadlineInfo(isoDate: string | null): { label: string; urgent: boolean; overdue: boolean } | null {
  if (!isoDate) return null
  const deadline = new Date(isoDate)
  if (isNaN(deadline.getTime())) return null
  const now      = Date.now()
  const diffMs   = deadline.getTime() - now
  const diffDays = Math.ceil(diffMs / 86_400_000)
  const label    = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return {
    label,
    urgent:  diffDays >= 0 && diffDays <= 14,
    overdue: diffDays < 0,
  }
}

function JdIntelligenceSection({
  intel, skillsRequired, skillsPreferred,
  salaryMin, salaryMax, salaryLevels, workMode, seniorityLevel,
  expYearsMin, expYearsMax, visaSponsorship, applicationDeadline,
}: JdIntelProps) {
  const { role_translation: rt, ats_keywords, hiring_signals: hs } = intel

  const salaryText = salaryMin
    ? `$${fmt(salaryMin)}${salaryMax ? ` - $${fmt(salaryMax)}` : '+'}`
    : null

  const expText = expYearsMin != null
    ? expYearsMax != null
      ? `${expYearsMin}–${expYearsMax} years`
      : `${expYearsMin}+ years`
    : null

  const deadline = deadlineInfo(applicationDeadline)

  return (
    <div className="space-y-5">

      {/* 1. Role in plain English */}
      <div>
        <SubHeader label="Role in plain English" />
        <IntelCard>
          <IntelRow
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Day to day"
            value={rt.day_to_day || <span className="text-muted-foreground text-xs">Not specified</span>}
          />
          <IntelRow
            icon={<Target className="h-3.5 w-3.5" />}
            label="Problem being solved"
            value={rt.problem_solved || <span className="text-muted-foreground text-xs">Not specified</span>}
          />
          <IntelRow
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Ownership level"
            value={
              rt.ownership_level
                ? <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${OWNERSHIP_COLORS[rt.ownership_level] ?? 'bg-muted text-foreground'}`}>
                    {OWNERSHIP_LABELS[rt.ownership_level] ?? rt.ownership_level}
                  </span>
                : <span className="text-muted-foreground text-xs">Not specified</span>
            }
          />
          <IntelRow
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="Year 1 success"
            value={rt.year1_success || <span className="text-muted-foreground text-xs">Not specified</span>}
          />
          <IntelRow
            icon={<Users className="h-3.5 w-3.5" />}
            label="Team context"
            value={rt.team_context || <span className="text-muted-foreground text-xs">Not specified</span>}
          />
          <IntelRow
            icon={<Brain className="h-3.5 w-3.5" />}
            label="Work rhythm"
            value={rt.work_rhythm || <span className="text-muted-foreground text-xs">Not specified</span>}
          />
          <IntelRow
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Growth potential"
            value={rt.growth_potential || <span className="text-muted-foreground text-xs">Not mentioned</span>}
          />
          <IntelRow
            icon={<AlertCircle className="h-3.5 w-3.5" />}
            label="Biggest challenge"
            value={rt.biggest_challenge || <span className="text-muted-foreground text-xs">Not mentioned</span>}
          />
        </IntelCard>
      </div>

      {/* 2. Required vs Nice-to-Have */}
      {(skillsRequired.length > 0 || skillsPreferred.length > 0) && (
        <div>
          <SubHeader label="Required vs Nice-to-Have" />
          <div className="space-y-2">
            {skillsRequired.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1">Must have</p>
                <Chips
                  items={skillsRequired}
                  chipClass="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 font-medium"
                />
              </div>
            )}
            {skillsPreferred.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mb-1">Nice to have</p>
                <Chips
                  items={skillsPreferred}
                  chipClass="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 font-medium"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. ATS Keywords */}
      {ats_keywords.length > 0 && (
        <div>
          <SubHeader label="ATS Keywords" />
          <p className="text-[11px] text-muted-foreground mb-2">
            Verbatim phrases from the JD — use in your resume where genuine.
          </p>
          <Chips
            items={ats_keywords}
            chipClass="text-[11px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300 font-medium"
          />
        </div>
      )}

      {/* 4. Hiring signals */}
      <div>
        <SubHeader label="Hiring signals" />
        <IntelCard>
          <div className="flex gap-2 px-3 py-2.5 flex-wrap">
            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
              hs.is_backfill
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300'
                : 'bg-muted text-muted-foreground'
            }`}>
              {hs.is_backfill ? 'Backfill role' : 'New headcount'}
            </span>
            <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
              hs.level_flexibility
                ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
            }`}>
              {hs.level_flexibility ? 'Level flexible' : 'Fixed level'}
            </span>
          </div>

          {hs.urgency_note && (
            <div className="px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Urgency</p>
              <p className="text-sm text-foreground leading-relaxed">{hs.urgency_note}</p>
            </div>
          )}

          {hs.culture_signals.length > 0 && (
            <div className="px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Culture signals</p>
              <ul className="space-y-1.5">
                {hs.culture_signals.map((sig, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
                    <Lightbulb className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-yellow-500" />
                    {sig}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hs.interview_hints.length > 0 && (
            <div className="px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Interview hints</p>
              <ul className="space-y-1.5">
                {hs.interview_hints.map((hint, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-blue-500" />
                    {hint}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </IntelCard>
      </div>

      {/* 5. Opportunity signals */}
      {intel.opportunity_signals && (
        intel.opportunity_signals.green_flags.length > 0 ||
        intel.opportunity_signals.red_flags.length > 0 ||
        intel.opportunity_signals.market_rarity
      ) && (
        <div>
          <SubHeader label="Opportunity signals" />
          <IntelCard>
            {intel.opportunity_signals.market_rarity && (
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Market rarity</p>
                <p className="text-sm text-foreground leading-relaxed">{intel.opportunity_signals.market_rarity}</p>
              </div>
            )}
            {intel.opportunity_signals.green_flags.length > 0 && (
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400 mb-1.5">Green flags</p>
                <ul className="space-y-1.5">
                  {intel.opportunity_signals.green_flags.map((flag, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-green-500" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intel.opportunity_signals.red_flags.length > 0 && (
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1.5">Red flags</p>
                <ul className="space-y-1.5">
                  {intel.opportunity_signals.red_flags.map((flag, i) => (
                    <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-red-500" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </IntelCard>
        </div>
      )}

      {/* 6. Prepare to apply */}
      {intel.prepare_to_apply && (
        intel.prepare_to_apply.resume_checklist.length > 0 ||
        intel.prepare_to_apply.interview_format ||
        intel.prepare_to_apply.competition_level !== 'unknown'
      ) && (
        <div>
          <SubHeader label="Prepare to apply" />
          <IntelCard>
            {intel.prepare_to_apply.competition_level !== 'unknown' && (
              <div className="flex gap-3 px-3 py-2.5">
                <div className="flex-shrink-0 mt-0.5 text-muted-foreground"><Target className="h-3.5 w-3.5" /></div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Competition</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      intel.prepare_to_apply.competition_level === 'low'    ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' :
                      intel.prepare_to_apply.competition_level === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300' :
                      intel.prepare_to_apply.competition_level === 'high'   ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {intel.prepare_to_apply.competition_level.charAt(0).toUpperCase() + intel.prepare_to_apply.competition_level.slice(1)} competition
                    </span>
                    {intel.prepare_to_apply.competition_note && (
                      <span className="text-sm text-muted-foreground">{intel.prepare_to_apply.competition_note}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {intel.prepare_to_apply.interview_format && (
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Interview format</p>
                <p className="text-sm text-foreground leading-relaxed">{intel.prepare_to_apply.interview_format}</p>
              </div>
            )}
            {intel.prepare_to_apply.resume_checklist.length > 0 && (
              <div className="px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Resume checklist</p>
                <Chips
                  items={intel.prepare_to_apply.resume_checklist}
                  chipClass="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300 font-medium"
                />
              </div>
            )}
          </IntelCard>
        </div>
      )}

      {/* 7. Practical snapshot */}
      {(deadline || salaryText || salaryLevels?.length || workMode || seniorityLevel || expText || visaSponsorship) && (
        <div>
          <SubHeader label="Practical snapshot" />
          <IntelCard>
            {/* Application deadline — always first if present */}
            {deadline && (
              <IntelRow
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                label="Application deadline"
                value={
                  <span className={
                    deadline.overdue ? 'text-muted-foreground line-through' :
                    deadline.urgent  ? 'font-semibold text-red-600 dark:text-red-400' :
                    'font-semibold text-foreground'
                  }>
                    {deadline.label}
                    {deadline.overdue && <span className="ml-2 text-xs font-normal text-muted-foreground">(closed)</span>}
                    {deadline.urgent && !deadline.overdue && <span className="ml-2 text-xs font-normal text-red-500">Closing soon</span>}
                  </span>
                }
              />
            )}
            {/* Leveled salary — shown instead of single range when available */}
            {salaryLevels && salaryLevels.length > 0 ? (
              <IntelRow
                icon={<DollarSign className="h-3.5 w-3.5" />}
                label="Salary by level"
                value={
                  <div className="space-y-1">
                    {salaryLevels.map((lvl, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium text-muted-foreground">{lvl.level}</span>
                        <span className="font-semibold text-green-700 dark:text-green-400">
                          ${fmt(lvl.min)} – ${fmt(lvl.max)}
                        </span>
                      </div>
                    ))}
                  </div>
                }
              />
            ) : salaryText ? (
              <IntelRow
                icon={<DollarSign className="h-3.5 w-3.5" />}
                label="Salary"
                value={<span className="font-semibold text-green-700 dark:text-green-400">{salaryText}</span>}
              />
            ) : null}
            {workMode && workMode !== 'unknown' && (
              <IntelRow
                icon={<Briefcase className="h-3.5 w-3.5" />}
                label="Work mode"
                value={<span className="capitalize">{workMode}</span>}
              />
            )}
            {seniorityLevel && seniorityLevel !== 'unknown' && (
              <IntelRow
                icon={<Zap className="h-3.5 w-3.5" />}
                label="Seniority"
                value={<span className="capitalize">{seniorityLevel}</span>}
              />
            )}
            {expText && (
              <IntelRow
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Experience"
                value={expText}
              />
            )}
            {visaSponsorship && visaSponsorship !== 'unknown' && (
              <IntelRow
                icon={<GraduationCap className="h-3.5 w-3.5" />}
                label="Visa sponsorship"
                value={
                  <span className={visaSponsorship === 'yes'
                    ? 'text-blue-700 dark:text-blue-300 capitalize'
                    : 'text-red-600 dark:text-red-400 capitalize'
                  }>
                    {visaSponsorship === 'yes' ? 'Available' : 'Not available'}
                  </span>
                }
              />
            )}
          </IntelCard>
        </div>
      )}
    </div>
  )
}

// ── Company Intel tab ─────────────────────────────────────────────────────────

interface FetchedIntel {
  // Company-layer (cached, shared)
  company_snapshot?:    { stage?: string | null; headcount?: string | null; revenue?: string | null; core_business?: string | null; key_products?: string | null } | null
  strategic_signals?:   IntelSignal[] | null
  leadership_culture?:  IntelSignal[] | null
  hiring_signals?:      IntelSignal[] | string[] | string | null
  red_flags?:           IntelSignal[] | string[] | string | null
  fetched_at?:          string
  // Role-layer (per-job)
  role_alignment?:      string | null
  role_company_intel?:  RoleCompanyIntel | null
}

function sentimentDot(s: string) {
  if (s === 'positive') return 'bg-green-500'
  if (s === 'risk')     return 'bg-red-500'
  return 'bg-amber-500'
}

function SignalList({ signals }: { signals: IntelSignal[] }) {
  return (
    <ul className="space-y-2">
      {signals.map((sig, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-foreground leading-relaxed">
          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${sentimentDot(sig.sentiment)}`} />
          {sig.text}
        </li>
      ))}
    </ul>
  )
}

function toSignals(v: unknown): IntelSignal[] {
  if (!v) return []
  if (Array.isArray(v)) {
    return v.map(item =>
      typeof item === 'string'
        ? { text: item, sentiment: 'positive' as const }
        : item as IntelSignal
    )
  }
  if (typeof v === 'string' && v) return [{ text: v, sentiment: 'positive' as const }]
  return []
}

function CompanyIntelTab({ job }: { job: JobWithScore }) {
  const [loading,   setLoading]   = useState(false)
  const [intel,     setIntel]     = useState<FetchedIntel | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  async function fetchIntel() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(
        `/api/company-intel/${encodeURIComponent(job.company)}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ jobId: job.id }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Request failed')
      setIntel(json.intel as FetchedIntel)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const hasIntel = intel !== null
  const snap     = intel?.company_snapshot
  const roleIntel: RoleCompanyIntel | null = intel?.role_company_intel ?? null
  const alignment = intel?.role_alignment ?? null

  const strategicSignals  = toSignals(intel?.strategic_signals)
  const cultureSignals    = toSignals(intel?.leadership_culture)
  const hiringSignals     = toSignals(intel?.hiring_signals)
  const redFlagSignals    = toSignals(intel?.red_flags)

  return (
    <div className="space-y-5">

      {/* ── Empty state / trigger ── */}
      {!hasIntel && !loading && (
        <div className="rounded-md border border-dashed border-border px-3 py-5 text-center">
          <p className="text-xs text-muted-foreground mb-3">
            Get a full candidate briefing for this {job.company} role — strategy, culture, hiring context, and interview angle.
          </p>
          <Button size="sm" onClick={fetchIntel} className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Get Company Intel
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Fetching {job.company} intel…
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2.5">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          <button onClick={fetchIntel} className="text-xs underline text-red-500 mt-1">Retry</button>
        </div>
      )}

      {hasIntel && (
        <>
          {/* Header row with refresh */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{job.company}</span>
            </div>
            <button
              onClick={fetchIntel}
              disabled={loading}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh intel"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* ── 1. Role alignment ── */}
          {alignment && (
            <div>
              <SubHeader label="Role alignment" />
              <div className="rounded-md border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-3 py-2.5">
                <p className="text-sm text-foreground leading-relaxed">{alignment}</p>
              </div>
            </div>
          )}

          {/* ── 2. Company snapshot ── */}
          {snap && (snap.stage || snap.headcount || snap.revenue || snap.core_business) && (
            <div>
              <SubHeader label="Company snapshot" />
              <div className="rounded-md border border-border divide-y divide-border text-sm">
                {snap.stage         && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Stage</span><span className="font-medium">{snap.stage}</span></div>}
                {snap.headcount     && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Headcount</span><span className="font-medium">{snap.headcount}</span></div>}
                {snap.revenue       && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Revenue</span><span className="font-medium">{snap.revenue}</span></div>}
                {snap.core_business && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Core business</span><span className="font-medium text-right max-w-[60%]">{snap.core_business}</span></div>}
                {snap.key_products  && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Key products</span><span className="font-medium text-right max-w-[60%]">{snap.key_products}</span></div>}
              </div>
            </div>
          )}

          {/* ── 3. Strategic direction ── */}
          {strategicSignals.length > 0 && (
            <div>
              <SubHeader label="Strategic direction" />
              <SignalList signals={strategicSignals} />
            </div>
          )}

          {/* ── 4. What you're walking into (role-layer) ── */}
          {roleIntel?.walking_into && roleIntel.walking_into.length > 0 && (
            <div>
              <SubHeader label="What you're walking into" />
              <SignalList signals={roleIntel.walking_into} />
            </div>
          )}

          {/* ── 5. Business context (role-layer) ── */}
          {roleIntel?.business_context && roleIntel.business_context.length > 0 && (
            <div>
              <SubHeader label="Business context for this role" />
              <SignalList signals={roleIntel.business_context} />
            </div>
          )}

          {/* ── 6. Leadership & culture ── */}
          {cultureSignals.length > 0 && (
            <div>
              <SubHeader label="Leadership & culture" />
              <SignalList signals={cultureSignals} />
            </div>
          )}

          {/* ── 7. Hiring signals ── */}
          {hiringSignals.length > 0 && (
            <div>
              <SubHeader label="Hiring signals" />
              <SignalList signals={hiringSignals} />
            </div>
          )}

          {/* ── 8. Red flags ── */}
          {redFlagSignals.length > 0 && (
            <div>
              <SubHeader label="Risks & red flags" />
              <SignalList signals={redFlagSignals} />
            </div>
          )}

          {/* ── 9. What this means for you (role-layer) ── */}
          {roleIntel?.what_this_means && roleIntel.what_this_means.length > 0 && (
            <div>
              <SubHeader label="What this means for you" />
              <SignalList signals={roleIntel.what_this_means} />
            </div>
          )}

          {/* ── 10. Interview narrative (role-layer) ── */}
          {roleIntel?.interview_narrative && (
            <div>
              <SubHeader label="Your interview angle" />
              <div className="rounded-md border-l-2 border-blue-400 dark:border-blue-500 bg-muted/30 px-3 py-2.5">
                <p className="text-sm text-foreground leading-relaxed">{roleIntel.interview_narrative}</p>
              </div>
            </div>
          )}

          {/* Cache timestamp */}
          {intel.fetched_at && (
            <p className="text-[10px] text-muted-foreground text-right">
              Intel cached · {new Date(intel.fetched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function JobDetailPane({
  job,
  onDelete,
  onClose,
}: {
  job:      JobWithScore
  onDelete: (id: string) => void
  onClose?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'details' | 'company'>('details')
  const [descOpen,  setDescOpen]  = useState(false)
  const [intelOpen, setIntelOpen] = useState(true)

  const score      = job.job_scores?.[0]
  const viaSource  = pickBestSource(job.job_sources)
  const applyUrl   = viaSource?.source_url || null
  const fallback   = applyUrl ? null : googleSearchUrl(job.company, job.canonical_title)
  const age        = postingAgePill(job.posted_at ?? job.scraped_at)
  const ageFallback = !job.posted_at
  const salaryText  = job.salary_min
    ? `$${fmt(job.salary_min)}${job.salary_max ? ` - $${fmt(job.salary_max)}` : '+'}`
    : null
  const roleIntel = job.role_intel as RoleIntel | null

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky header ── */}
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
        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {applyUrl ? (
            <a href={applyUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-sm">
              Apply <ArrowRight className="h-4 w-4" />
            </a>
          ) : (
            <a href={fallback!} target="_blank" rel="noopener noreferrer"
              title="No direct link — opens a Google search"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-muted hover:bg-muted/80 text-foreground text-sm font-semibold transition-colors">
              Search <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-500 gap-1"
            onClick={() => onDelete(job.id)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border -mb-4 pt-1">
          <button
            onClick={() => setActiveTab('details')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Brain className="h-3.5 w-3.5" /> Job Details
          </button>
          <button
            onClick={() => setActiveTab('company')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'company'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" /> Company Intel
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

        {/* Company Intel tab */}
        {activeTab === 'company' && (
          <CompanyIntelTab job={job} />
        )}

        {/* Job Details tab */}
        {activeTab === 'details' && <>

        {/* Section 1: ABOUT THE ROLE */}
        {(job.role_summary || job.description) && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">About the role</h3>

            {job.role_summary && (
              <p className="text-sm text-foreground leading-relaxed mb-2">{job.role_summary}</p>
            )}

            {/* Work mode pill */}
            {job.work_mode && job.work_mode !== 'unknown' && (
              <span className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium mb-3 ${
                job.work_mode === 'remote'  ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' :
                job.work_mode === 'hybrid'  ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' :
                job.work_mode === 'on-site' ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' :
                'bg-muted text-muted-foreground'
              }`}>
                {job.work_mode === 'remote' ? 'Fully remote' : job.work_mode === 'hybrid' ? 'Hybrid' : 'On-site'}
              </span>
            )}

            {job.description && (
              <div className="border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => setDescOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <span>Full description</span>
                  {descOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {descOpen && (
                  <div className="px-3 pb-4 pt-1 border-t border-border">
                    {renderJobDescription(job.description)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 2: JD INTELLIGENCE */}
        {roleIntel && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="h-3.5 w-3.5 text-violet-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  JD Intelligence
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 font-medium">
                  Haiku · JD only
                </span>
              </div>
              <button
                onClick={() => setIntelOpen(o => !o)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={intelOpen ? 'Collapse' : 'Expand'}
              >
                {intelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {intelOpen && (
              <JdIntelligenceSection
                intel={roleIntel}
                skillsRequired={job.skills_required ?? []}
                skillsPreferred={job.skills_preferred ?? []}
                salaryMin={job.salary_min ?? null}
                salaryMax={job.salary_max ?? null}
                salaryLevels={job.salary_levels ?? null}
                workMode={job.work_mode ?? null}
                seniorityLevel={job.seniority_level ?? null}
                expYearsMin={job.experience_years_min ?? null}
                expYearsMax={job.experience_years_max ?? null}
                visaSponsorship={job.visa_sponsorship ?? null}
                applicationDeadline={job.application_deadline ?? null}
              />
            )}
          </div>
        )}

        {/* Section 3: FIT ANALYSIS */}
        {score?.fit_reason && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Fit analysis</h3>
            <p className="text-sm text-foreground leading-relaxed">{score.fit_reason}</p>
            {score.skills_matched?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Matched</p>
                <div className="flex flex-wrap gap-1">
                  {score.skills_matched.map((s) => <SkillPill key={s} label={s} variant="matched" />)}
                </div>
              </div>
            )}
            {score.skills_missing?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">Gaps</p>
                <div className="flex flex-wrap gap-1">
                </div>
              </div>
            )}
          </div>
        )}

        {/* Also posted on */}
        {job.job_sources && job.job_sources.length > 1 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Also posted on</h3>
            <div className="flex flex-wrap gap-1.5">
              {job.job_sources.map((s) => (
                <a key={s.source_name} href={s.source_url} target="_blank" rel="noopener noreferrer"
                  className={`text-xs px-2 py-0.5 rounded font-medium hover:opacity-80 ${SOURCE_COLORS[s.source_name] ?? 'bg-gray-100 text-gray-600'}`}>
                  {SOURCE_LABELS[s.source_name] ?? s.source_name}
                </a>
              ))}
            </div>
          </div>
        )}

        {applyUrl && (
          <div className="pt-1">
            <a href={applyUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary underline">
              View original posting
            </a>
          </div>
        )}

        </> /* end Job Details tab */}
      </div>
    </div>
  )
}
