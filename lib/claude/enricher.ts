// lib/claude/enricher.ts
// Batch job enricher -- extracts structured fields from raw JD text, 5 jobs per Claude call, max_tokens 16000.
// Batch size is 5 (not 10) because role_intel roughly triples per-job output size -- 10 jobs
// was generating ~34k chars of JSON which caused malformed output and fallback to per-job mode.
//
// Output has two layers:
//   1. Scoring fields -- used by dedup, scorer, and filters (skills, work_mode, salary, etc.)
//   2. role_intel     -- JD-only intelligence for the candidate UI (plain-English translation,
//                        ATS keywords, hiring signals). All fields sourced strictly from JD text --
//                        no outside knowledge, no hallucination.

import Anthropic from '@anthropic-ai/sdk'
import { type NormalizedJob } from '@/lib/pipeline/normalize'
import { type Seniority, type RoleType } from '@/lib/types'

const client = new Anthropic()

// ── Public types ──────────────────────────────────────────────────────────────

/** Plain-English role translation -- all fields sourced strictly from JD text. */
export interface RoleTranslation {
  day_to_day:        string
  problem_solved:    string
  ownership_level:   'executor' | 'contributor' | 'lead' | 'owner'
  year1_success:     string
  team_context:      string
  work_rhythm:       string
  growth_potential:  string   // career path or scope growth signals from JD
  biggest_challenge: string   // hardest part of the role implied by JD
}

/** Signals extractable directly from JD structure and language. */
export interface HiringSignals {
  is_backfill:       boolean
  level_flexibility: boolean
  urgency_note:      string
  culture_signals:   string[]
  interview_hints:   string[]
}

/** Strategic signals about the opportunity -- sourced strictly from JD text. */
export interface OpportunitySignals {
  green_flags:   string[]   // positive signals: clear ownership, growth language, specific team
  red_flags:     string[]   // caution signals: vague scope, unrealistic bar, "wear many hats"
  market_rarity: string     // how niche/common this skill set appears based on JD specificity
}

/** Actionable preparation checklist -- inferred from JD emphasis. */
export interface PrepareToApply {
  resume_checklist:  string[]   // top keywords/phrases most critical to include
  interview_format:  string     // what the JD implies about interview style
  competition_level: 'low' | 'medium' | 'high' | 'unknown'  // inferred from role specificity
  competition_note:  string     // short explanation of the competition_level signal
}

/** Candidate-facing JD intelligence -- rendered in the Job Details panel. */
export interface RoleIntel {
  role_translation:    RoleTranslation
  ats_keywords:        string[]
  hiring_signals:      HiringSignals
  opportunity_signals: OpportunitySignals
  prepare_to_apply:    PrepareToApply
}

/** Full output shape per job from the Haiku enrichment pass. */
export interface EnrichedFields {
  // Scoring / pipeline fields
  role_summary:          string
  skills_required:       string[]
  skills_preferred:      string[]
  tech_stack:            string[]
  work_mode:             'remote' | 'hybrid' | 'on-site' | 'unknown'
  visa_sponsorship:      'yes' | 'no' | 'unknown'
  experience_years_min:  number | null
  experience_years_max:  number | null
  education_level:       'bachelor' | 'master' | 'phd' | 'none' | 'unknown'
  security_clearance:    'required' | 'preferred' | 'none'
  benefits_highlights:   string[]
  languages_required:    string[]
  seniority_level:       Seniority
  role_type:             RoleType
  salary_min:            number | null
  salary_max:            number | null
  salary_currency:       string | null
  // Candidate intelligence
  role_intel:            RoleIntel
  // Application deadline extracted verbatim from JD ("Applications accepted until May 1, 2026" → "2026-05-01")
  application_deadline:  string | null
  // Per-level salary breakdown for roles that post multiple bands (e.g. NVIDIA L4/L5)
  salary_levels:         Array<{ level: string; min: number; max: number }> | null
}

// ── Boilerplate stripper ──────────────────────────────────────────────────────
// Removes employer PR noise before sending to Haiku -- saves tokens, improves signal.

const BOILERPLATE_PATTERNS = [
  /equal opportunity employer[^.]*\./gi,
  /we (are|celebrate|embrace|welcome|value) diversity[^.]*\./gi,
  /eeo[/ ]?m[/ ]?f[/ ]?d[/ ]?v[^.]*\./gi,
  /we do not discriminate[^.]*\./gi,
  /reasonable accommodations?[^.]*\./gi,
  /our (mission|vision|values?) (is|are)[^.]{0,200}\./gi,
  /about (us|the company|our company)[^.]{0,300}\./gi,
  /we were founded[^.]*\./gi,
  /join our (team|growing team|mission)[^.]*\./gi,
]

function stripBoilerplate(text: string): string {
  let cleaned = text
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  )
}

// ── Prompts ───────────────────────────────────────────────────────────────────
//
// Split into SYSTEM_PROMPT (cached by Anthropic prompt caching across batch calls)
// and FIELD_RULES (injected once per user turn via buildPrompt).
// Keeping each string under the Write-tool size limit.

const SYSTEM_PROMPT = [
  'You are an expert technical recruiter and job description analyst.',
  '',
  'Extract two categories of structured data from raw job description text:',
  '',
  'CATEGORY 1 - Scoring fields (skills, salary, work mode, etc.)',
  'Used for candidate-job matching, ATS scoring, and deduplication.',
  'Accuracy matters more than completeness. When in doubt, under-extract.',
  '',
  'CATEGORY 2 - role_intel (candidate-facing intelligence)',
  'Used to brief candidates before they apply.',
  'STRICT RULE: Every field in role_intel must be directly traceable to a specific',
  'sentence or phrase in the JD text. Do not use outside knowledge about the company,',
  'market, or industry. If you cannot point to the exact JD text as the source, use',
  'the empty default. This prevents hallucination -- false intel harms candidates.',
  '',
  'Skills classification (Category 1):',
  '- skills_required: ONLY for "required", "must have", "you must", "X+ years of X",',
  '  or skills under a section explicitly labelled Requirements/Qualifications with no hedge',
  '- skills_preferred: "preferred", "nice to have", "a plus", "ideally", "familiarity with",',
  '  or listed under Preferred/Bonus/Nice-to-Have sections',
  '- Use the section header as classifier when a list mixes hard and soft requirements',
  '- Do not duplicate skills across both arrays',
  '',
  'Output: Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.',
].join('\n')

// Field rules injected into the user turn (not cached -- varies per batch).
const FIELD_RULES_CATEGORY_1 = [
  'FIELD RULES - CATEGORY 1',
  '',
  'index',
  '  Must match the [N] prefix exactly. Required for order validation.',
  '',
  'role_summary',
  '  3-5 sentences covering four things in order:',
  '  1. Role purpose — what this person is here to do and why it matters to the team.',
  '  2. Core responsibilities — top 2-3 things they will own day-to-day.',
  '  3. Must-have qualifications — years of experience, required skills, domain expertise.',
  '  4. Scope — seniority, who they work with, and reporting context if mentioned.',
  '  Write in plain English. No company marketing, no filler, no "exciting opportunity".',
  '',
  'skills_required / skills_preferred',
  '  Apply classification rules from system prompt exactly.',
  '  tech_stack may overlap -- expected and correct.',
  '',
  'tech_stack',
  '  Tools, languages, platforms, cloud providers, frameworks, databases.',
  '  Include even if mentioned once. Exclude soft skills and methodologies.',
  '',
  'work_mode',
  '  "remote" = fully remote stated | "hybrid" = mix stated | "on-site" = office/no-remote',
  '  "unknown" = not mentioned. Do not infer from location alone.',
  '',
  'visa_sponsorship',
  '  "yes" = explicitly offered | "no" = explicitly denied | "unknown" = not mentioned (most common)',
  '',
  'experience_years_min / experience_years_max',
  '  Integers only. "5+ years" -> min=5, max=null. Null if not mentioned.',
  '',
  'education_level',
  '  Minimum stated. "none" if degree explicitly not required.',
  '  "bachelor\'s preferred + or equivalent experience" -> use "none".',
  '',
  'security_clearance',
  '  "required" = active clearance required | "preferred" = mentioned as plus | "none" = absent',
  '  Do not infer from government/defense context alone.',
  '',
  'benefits_highlights',
  '  Differentiating perks only: equity, RSUs, retirement match, parental leave, unlimited PTO.',
  '  Skip generic benefits (health, dental, vision). Max 5. Empty if none.',
  '',
  'seniority_level',
  '  Infer from title + description together. "Senior" title + 1yr req = "mid".',
  '  Values: intern|junior|mid|senior|staff|principal|manager|director|vp|unknown',
  '',
  'role_type',
  '  "individual_contributor" = no reports | "manager" = people manager',
  '  "hybrid" = reports + IC work | "unknown" = unclear',
  '',
  'salary_min / salary_max / salary_currency',
  '  Explicit ranges only. Integers in posted unit. ISO 4217 currency. All null if absent.',
  '  When only ONE salary range exists, populate salary_min/max. Leave salary_levels null.',
  '',
  'salary_levels',
  '  ONLY populate when the JD explicitly lists multiple salary bands by level.',
  '  Example: "L4: $168k-$264k, L5: $196k-$310k" → [{level:"L4",min:168000,max:264500},{level:"L5",min:196000,max:310500}]',
  '  salary_min/max should still hold the lowest band min and highest band max.',
  '  null if only one band or no salary mentioned.',
  '',
  'application_deadline',
  '  ISO 8601 date string (YYYY-MM-DD) if JD states an explicit application deadline.',
  '  Example: "Applications for this job will be accepted at least until May 1, 2026" → "2026-05-01"',
  '  null if not mentioned.',
].join('\n')

const FIELD_RULES_CATEGORY_2 = [
  'FIELD RULES - CATEGORY 2 (role_intel)',
  'STRICT: Source every value from JD text. No outside knowledge.',
  '',
  'role_translation.day_to_day',
  '  1-2 sentences. What will this person spend most of their time doing?',
  '  Use action verbs from the JD. Empty string if responsibilities not described.',
  '',
  'role_translation.problem_solved',
  '  1 sentence. What gap does this hire fill? Look for "seeking", "we need", "responsible for".',
  '  Empty string if not inferable from JD text.',
  '',
  'role_translation.ownership_level',
  '  executor = follows process | contributor = owns deliverables, some autonomy',
  '  lead = drives direction, cross-team impact | owner = full accountability, sets roadmap',
  '  Infer from "contribute to", "drive", "own", "lead", "define". Default: "contributor".',
  '',
  'role_translation.year1_success',
  '  1 sentence. What outcome = success at 12 months? Only if JD hints at it. Else empty string.',
  '',
  'role_translation.team_context',
  '  1 sentence. Who does this person work with? Source: "work closely with" language. Else empty.',
  '',
  'role_translation.work_rhythm',
  '  1 sentence. Reactive vs proactive? Solo vs team?',
  '  "debug/respond to" = reactive. "design/build/create" = proactive. Else empty.',
  '',
  'ats_keywords',
  '  Verbatim technical phrases from the JD -- exact tokens for resume ATS matching.',
  '  Copy employer phrasing exactly ("bringup planning" not "hardware bring-up").',
  '  Include domain abbreviations (HSIO, BER, IOMMU). Exclude generic soft skills.',
  '  Exclude non-transferable company/product names. Target 8-15 items.',
  '',
  'hiring_signals.is_backfill',
  '  true if JD says "existing vacancy", "open role", or equivalent. Else false.',
  '',
  'hiring_signals.level_flexibility',
  '  true if multiple seniority levels posted (e.g. "Level 4 or 5", "Senior or Staff").',
  '',
  'hiring_signals.urgency_note',
  '  Verbatim deadline/timeline language. Empty string if none.',
  '',
  'hiring_signals.culture_signals',
  '  Explicit, non-boilerplate culture language only.',
  '  Example: "team-first approach over lone wolf heroics". Empty if none.',
  '',
  'hiring_signals.interview_hints',
  '  What the JD emphasis implies they will test -- inferred from JD only, not company knowledge.',
  '  Example: 4 debug bullets -> "Expect live debug scenarios". Max 3. Empty if not inferable.',
  '',
  'role_translation.growth_potential',
  '  1 sentence. Does the JD hint at career path, expanding scope, or growing team?',
  '  Source: "grow", "lead", "expand", "future", "next-gen". Empty string if absent.',
  '',
  'role_translation.biggest_challenge',
  '  1 sentence. What is the hardest part of this role based on JD language?',
  '  Look for: complex environments, ambiguity signals, "fast-paced", niche domain depth required.',
  '  Empty string if not inferable.',
  '',
  'opportunity_signals.green_flags',
  '  Positive signals about role quality -- sourced from JD only.',
  '  Examples: clear ownership language, specific team named, explicit growth path, concrete deliverables.',
  '  Max 4. Empty array if none.',
  '',
  'opportunity_signals.red_flags',
  '  Caution signals -- sourced from JD only. Do not infer from company reputation.',
  '  Examples: vague responsibilities ("other duties"), unrealistic requirement stacking,',
  '  "wear many hats" with no scope limit, excessive seniority for pay band.',
  '  Max 3. Empty array if none.',
  '',
  'opportunity_signals.market_rarity',
  '  1 sentence. How niche is this role based on the specificity of the JD requirements?',
  '  Very specific domain + rare combo = rare. Broad common skills = common.',
  '  Source only from JD content -- not market knowledge.',
  '',
  'prepare_to_apply.resume_checklist',
  '  Top 5 keywords/phrases a candidate must include in their resume to pass ATS for this role.',
  '  Pick from skills_required and ats_keywords -- most critical terms only.',
  '',
  'prepare_to_apply.interview_format',
  '  1-2 sentences. What does the JD emphasis imply about the interview process?',
  '  Example: heavy debugging bullets -> likely live debug round. System design bullets -> design round.',
  '  Empty string if not inferable.',
  '',
  'prepare_to_apply.competition_level',
  '  "low" = very niche requirements (few candidates qualify).',
  '  "medium" = specialized but reachable skill set.',
  '  "high" = broad requirements at a well-known employer (many applicants).',
  '  "unknown" = cannot determine from JD alone.',
  '',
  'prepare_to_apply.competition_note',
  '  1 sentence explaining the competition_level signal from the JD.',
  '  Example: "Requires rare HSIO + NVLink combo -- few candidates qualify."',
].join('\n')

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildJobBlocks(batch: NormalizedJob[]): string {
  return batch
    .map((j, i) => {
      const cleaned   = stripBoilerplate(j.description ?? '')
      const truncated = cleaned.slice(0, 5000)
      return `[${i}]\nTitle: ${j.canonical_title}\nCompany: ${j.company}\nDescription:\n${truncated}`
    })
    .join('\n\n---\n\n')
}

const OUTPUT_SCHEMA = `{
  "index": 0,
  "role_summary": "...",
  "skills_required": [],
  "skills_preferred": [],
  "tech_stack": [],
  "work_mode": "remote|hybrid|on-site|unknown",
  "visa_sponsorship": "yes|no|unknown",
  "experience_years_min": null,
  "experience_years_max": null,
  "education_level": "bachelor|master|phd|none|unknown",
  "security_clearance": "none|preferred|required",
  "benefits_highlights": [],
  "languages_required": [],
  "seniority_level": "intern|junior|mid|senior|staff|principal|manager|director|vp|unknown",
  "role_type": "individual_contributor|manager|hybrid|unknown",
  "salary_min": null,
  "salary_max": null,
  "salary_currency": null,
  "salary_levels": null,
  "application_deadline": null,
  "role_intel": {
    "role_translation": {
      "day_to_day": "...",
      "problem_solved": "...",
      "ownership_level": "executor|contributor|lead|owner",
      "year1_success": "...",
      "team_context": "...",
      "work_rhythm": "...",
      "growth_potential": "...",
      "biggest_challenge": "..."
    },
    "ats_keywords": [],
    "hiring_signals": {
      "is_backfill": false,
      "level_flexibility": false,
      "urgency_note": "",
      "culture_signals": [],
      "interview_hints": []
    },
    "opportunity_signals": {
      "green_flags": [],
      "red_flags": [],
      "market_rarity": "..."
    },
    "prepare_to_apply": {
      "resume_checklist": [],
      "interview_format": "...",
      "competition_level": "low|medium|high|unknown",
      "competition_note": "..."
    }
  }
}`

function buildPrompt(batch: NormalizedJob[]): string {
  return [
    'Extract structured data from each job description below.',
    'Return a JSON array with exactly one object per job, preserving input order.',
    '',
    'JOBS:',
    buildJobBlocks(batch),
    '',
    'Return this exact shape for each job -- every key must be present:',
    OUTPUT_SCHEMA,
    '',
    FIELD_RULES_CATEGORY_1,
    '',
    FIELD_RULES_CATEGORY_2,
  ].join('\n')
}

// ── Core batch logic ──────────────────────────────────────────────────────────

async function enrichBatch(batch: NormalizedJob[]): Promise<EnrichedFields[]> {
  const t0 = Date.now()
  console.log(`[enricher] batch start: ${batch.length} jobs`)

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: [
      {
        type:          'text',
        text:          SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role:    'user',
      content: buildPrompt(batch),
    }],
  })

  const apiMs   = Date.now() - t0
  const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
  console.log(`[enricher] haiku response: ${apiMs}ms, output_tokens=${response.usage?.output_tokens ?? '?'}, chars=${rawText.length}`)

  const jsonMatch = rawText.match(/\[[\s\S]*\]/)
  const raw       = jsonMatch ? jsonMatch[0] : '[]'

  try {
    const parsed = JSON.parse(raw) as Array<{ index: number } & EnrichedFields>

    if (!Array.isArray(parsed) || parsed.length !== batch.length) {
      throw new Error(`Expected ${batch.length} results, got ${parsed.length}`)
    }

    const results = parsed
      .sort((a, b) => a.index - b.index)
      .map((item) => {
        const fields = { ...item } as Partial<EnrichedFields> & { index?: number }
        delete fields.index
        return {
          ...fields,
          // Guarantee role_intel is always present — Haiku sometimes omits it
          // when the output is large, causing a silent NULL in the DB.
          role_intel: fields.role_intel ?? emptyRoleIntel(),
        } as EnrichedFields
      })

    const withIntel = results.filter(r => r.role_intel?.role_translation?.day_to_day).length
    console.log(`[enricher] batch ok: ${results.length} jobs, role_intel populated=${withIntel}/${results.length}, total=${Date.now() - t0}ms`)
    return results

  } catch (err) {
    console.warn(`[enricher] batch parse failed (${(err as Error).message}), falling back to per-job`)
    return enrichJobsOneByOne(batch)
  }
}

async function enrichJobsOneByOne(jobs: NormalizedJob[]): Promise<EnrichedFields[]> {
  const results: EnrichedFields[] = []
  for (const job of jobs) {
    try {
      const single = await enrichBatch([job])
      results.push(single[0])
    } catch {
      results.push(emptyEnrichedFields())
    }
  }
  return results
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enrich an array of normalized jobs with structured fields extracted by Claude Haiku.
 * Processes in batches of 5. Falls back to per-job processing if a batch parse fails.
 */
export async function enrichJobsBatch(jobs: NormalizedJob[]): Promise<EnrichedFields[]> {
  const batches     = chunkArray(jobs, 5)
  const allEnriched: EnrichedFields[] = []

  for (const batch of batches) {
    const enriched = await enrichBatch(batch)
    allEnriched.push(...enriched)
  }

  return allEnriched
}

// ── Fallbacks ─────────────────────────────────────────────────────────────────

function emptyRoleIntel(): RoleIntel {
  return {
    role_translation: {
      day_to_day:        '',
      problem_solved:    '',
      ownership_level:   'contributor',
      year1_success:     '',
      team_context:      '',
      work_rhythm:       '',
      growth_potential:  '',
      biggest_challenge: '',
    },
    ats_keywords:   [],
    hiring_signals: {
      is_backfill:       false,
      level_flexibility: false,
      urgency_note:      '',
      culture_signals:   [],
      interview_hints:   [],
    },
    opportunity_signals: {
      green_flags:   [],
      red_flags:     [],
      market_rarity: '',
    },
    prepare_to_apply: {
      resume_checklist:  [],
      interview_format:  '',
      competition_level: 'unknown',
      competition_note:  '',
    },
  }
}

function emptyEnrichedFields(): EnrichedFields {
  return {
    role_summary:         '',
    skills_required:      [],
    skills_preferred:     [],
    tech_stack:           [],
    work_mode:            'unknown',
    visa_sponsorship:     'unknown',
    experience_years_min: null,
    experience_years_max: null,
    education_level:      'unknown',
    security_clearance:   'none',
    benefits_highlights:  [],
    languages_required:   [],
    seniority_level:      'unknown',
    role_type:            'unknown',
    salary_min:           null,
    salary_max:           null,
    salary_currency:      null,
    salary_levels:        null,
    application_deadline: null,
    role_intel:           emptyRoleIntel(),
  }
}
