// lib/claude/enricher.ts
// Batch job enricher — extracts structured fields from raw JD text, 10 jobs per Claude call

import Anthropic from '@anthropic-ai/sdk'
import { type NormalizedJob } from '@/lib/pipeline/normalize'
import { type Seniority, type RoleType } from '@/lib/types'

const client = new Anthropic()

export interface EnrichedFields {
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
}

// Boilerplate patterns that consume tokens without adding signal
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
  // Collapse excessive whitespace left by removals
  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  )
}

/**
 * Enrich an array of normalized jobs with structured fields extracted by Claude Haiku.
 * Processes in batches of 10. Falls back to per-job processing if a batch parse fails.
 */
export async function enrichJobsBatch(jobs: NormalizedJob[]): Promise<EnrichedFields[]> {
  const batches = chunkArray(jobs, 10)
  const allEnriched: EnrichedFields[] = []

  for (const batch of batches) {
    const enriched = await enrichBatch(batch)
    allEnriched.push(...enriched)
  }

  return allEnriched
}

const SYSTEM_PROMPT = `You are an expert technical recruiter and job description analyst with deep knowledge of how job postings are written across industries, company sizes, and regions.

Your task is to extract structured, machine-readable fields from raw job description text. Your extractions will be used downstream to match candidates to roles and power ATS scoring — accuracy matters more than completeness. When in doubt, under-extract rather than over-extract.

Core extraction principles:
- Only extract what is explicitly stated. Do not infer, assume, or hallucinate fields from context.
- Descriptions may be truncated. Extract only from what is present. Do not guess at fields that may appear later in the full text.
- When a field cannot be determined confidently, use its default/unknown value — never omit a key.
- Distinguish between what a company requires vs. what they wish for. Job postings deliberately inflate requirements — your job is to cut through that.

Skills classification rules (most important):
- skills_required: ONLY if the JD uses unambiguous language — "required", "must have", "must-have", "you must", "X+ years of X", or the skill appears under a section explicitly labelled "Requirements" or "Qualifications" with no softening hedge
- skills_preferred: everything else — "preferred", "nice to have", "a plus", "bonus", "ideally", "familiarity with", "exposure to", or listed under "Preferred", "Bonus", "Nice to Have" sections
- When a requirement section mixes hard and soft requirements in the same bullet list, use the section header as the classifier — not the individual phrasing
- Do not duplicate skills across both arrays

Output format: Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.`

async function enrichBatch(batch: NormalizedJob[]): Promise<EnrichedFields[]> {
  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 8192,
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

  const rawText = response.content[0].type === 'text' ? response.content[0].text : ''
  // Extract first JSON array from response, ignoring markdown fences or surrounding text
  const jsonMatch = rawText.match(/\[[\s\S]*\]/)
  const raw = jsonMatch ? jsonMatch[0] : '[]'

  try {
    const parsed = JSON.parse(raw) as Array<{ index: number } & EnrichedFields>

    // Validate we got the right number back, sorted by echoed index
    if (!Array.isArray(parsed) || parsed.length !== batch.length) {
      throw new Error(`Expected ${batch.length} results, got ${parsed.length}`)
    }

    return parsed
      .sort((a, b) => a.index - b.index)
      .map(({ index: _index, ...fields }) => fields as EnrichedFields)

  } catch (err) {
    console.warn(`[enricher] Batch parse failed (${(err as Error).message}), falling back to per-job`)
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

function buildPrompt(batch: NormalizedJob[]): string {
  const jobBlocks = batch
    .map((j, i) => {
      const cleaned = stripBoilerplate(j.description ?? '')
      const truncated = cleaned.slice(0, 3000)
      return `[${i}]
Title: ${j.canonical_title}
Company: ${j.company}
Description:
${truncated}`
    })
    .join('\n\n---\n\n')

  return `Extract structured data from each job description below.
Return a JSON array with exactly one object per job, preserving input order.

JOBS:
${jobBlocks}

Example of a correctly filled object (for reference only — do not copy these values):
{
  "index": 0,
  "role_summary": "Designs and maintains real-time data pipelines ingesting 10M+ events/day using Kafka and Spark. Works closely with ML platform team to deliver feature stores used by 5 production models. Senior-level role with broad ownership across ingestion, transformation, and monitoring.",
  "skills_required": ["Apache Kafka", "Apache Spark", "Python", "SQL"],
  "skills_preferred": ["dbt", "Airflow", "Terraform"],
  "tech_stack": ["Kafka", "Spark", "Python", "dbt", "Airflow", "AWS S3", "Redshift"],
  "work_mode": "hybrid",
  "visa_sponsorship": "no",
  "experience_years_min": 5,
  "experience_years_max": null,
  "education_level": "bachelor",
  "security_clearance": "none",
  "benefits_highlights": ["RSUs", "401k match", "unlimited PTO"],
  "languages_required": [],
  "seniority_level": "senior",
  "role_type": "individual_contributor",
  "salary_min": 160000,
  "salary_max": 210000,
  "salary_currency": "USD"
}

For each job, return this exact shape — every key must be present:
{
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
  "salary_currency": null
}

Field-by-field rules:

index
  Must match the [N] prefix of the job exactly. Required for order validation.

role_summary
  2-3 sentences. Lead with the core day-to-day technical responsibilities (what the person will build, own, or operate). Follow with seniority and scope (team size, ownership level, cross-functional reach). End with domain/industry if relevant and non-obvious from the title. Never describe the company. Never use filler phrases like "exciting opportunity", "fast-paced environment", "passionate team", or "make an impact". Write as if briefing a candidate who has 10 seconds to decide whether to read further.

skills_required / skills_preferred
  Apply the classification rules from your system instructions exactly.
  tech_stack may overlap with these arrays — that is expected and correct.

tech_stack
  Tools, languages, platforms, cloud providers, frameworks, databases. Include even if mentioned only once. Do not include soft skills or methodologies (Agile, Scrum) here.

work_mode
  "remote" — fully remote explicitly stated
  "hybrid" — mix of remote and office explicitly stated
  "on-site" — in-office, on-site, or no remote option stated
  "unknown" — not mentioned at all
  Do not infer from location alone (e.g. "San Francisco, CA" is not evidence of on-site).

visa_sponsorship
  "yes" — explicitly offered (e.g. "we sponsor H-1B", "visa sponsorship available")
  "no" — explicitly denied (e.g. "must be authorized to work", "no sponsorship")
  "unknown" — not mentioned. This is the most common case — do not infer.

experience_years_min / experience_years_max
  Integers only, from explicit ranges like "3-5 years of experience". If a single number is stated ("5+ years"), set min=5, max=null. Null if not mentioned.

education_level
  Minimum acceptable level stated. "none" if degree explicitly not required. "unknown" if not mentioned. If "bachelor's preferred" appears alongside "or equivalent experience", use "none".

security_clearance
  "required" — an active clearance is explicitly required (e.g. "must hold active TS/SCI")
  "preferred" — clearance is preferred or eligibility is mentioned as a plus
  "none" — no clearance mentioned or explicitly not required
  Do not infer from government/defense industry context alone.

benefits_highlights
  Notable, differentiating perks only: equity/RSUs, retirement match, parental leave, unlimited PTO, signing bonus, relocation. Skip generic/universal benefits (health insurance, dental, vision). Max 5 items. Empty array if none mentioned.

languages_required
  Spoken/written human languages only. Omit English unless the JD explicitly calls it out as a non-default requirement. Empty array if not stated.

seniority_level
  Infer from title and description together. Title alone is not always reliable — a "Senior Engineer" JD that requires only 1 year of experience should be classified as "mid". Use: intern | junior | mid | senior | staff | principal | manager | director | vp | unknown.

role_type
  "individual_contributor" — purely hands-on, no direct reports
  "manager" — has direct reports and is primarily a people manager
  "hybrid" — has direct reports but also significant IC work (common at staff/principal level)
  "unknown" — not determinable from the text

salary_min / salary_max / salary_currency
  Extract only if a salary range is explicitly stated in the description. Integers in the unit posted (do not convert). salary_currency as ISO 4217 code (USD, GBP, EUR, etc.). All three null if no salary is mentioned.`
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
  }
}
