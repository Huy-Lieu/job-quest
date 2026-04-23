// lib/claude/scorer.ts
// Batch job fit scorer — 5 jobs per Claude Sonnet call.
// Uses enriched fields (skills_required, role_summary) — NOT raw description text.

import Anthropic from '@anthropic-ai/sdk'
import type { NormalizedJob } from '@/lib/pipeline/normalize'
import type { EnrichedFields } from '@/lib/claude/enricher'

const client = new Anthropic()

// ── public types ──────────────────────────────────────────────────────────────

export interface EnrichedJob extends NormalizedJob {
  enriched: EnrichedFields
}

export interface ResumeData {
  skills:           string[]
  experience_years: number
  education:        { degree: string; field: string }
  key_keywords:     string[]
}

export interface JobScore {
  fit_score:      number       // 0-100
  fit_reason:     string       // 2-3 sentences
  skills_matched: string[]
  skills_missing: string[]
  recommended:    boolean
}

// ── helpers ───────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  )
}

const FALLBACK_SCORE: JobScore = {
  fit_score:      0,
  fit_reason:     'Scoring unavailable',
  skills_matched: [],
  skills_missing: [],
  recommended:    false,
}

// ── system prompt (cached) ────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a technical recruiter evaluating job fit for a specific candidate. ' +
  'You will be given the candidate resume summary and a batch of job listings. ' +
  'For each job return a structured fit score based strictly on skill overlap, ' +
  'seniority match, and role alignment. Do not factor in location or compensation unless asked. ' +
  'Return ONLY a valid JSON array — no markdown fences, no explanation, no preamble.'

// ── prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(batch: EnrichedJob[], resume: ResumeData): string {
  const candidateBlock =
    'CANDIDATE:\n' +
    'Skills: ' + (resume.skills.join(', ') || 'Not specified') + '\n' +
    'Experience: ' + resume.experience_years + ' year(s)\n' +
    'Education: ' + resume.education.degree + ' in ' + resume.education.field + '\n' +
    'Key keywords: ' + (resume.key_keywords.join(', ') || 'Not specified')

  const jobBlocks = batch
    .map((job, i) => {
      const e = job.enriched
      return (
        '[' + i + '] ' + job.canonical_title + ' at ' + job.company + '\n' +
        'Summary: ' + (e.role_summary || 'N/A') + '\n' +
        'Required skills: ' + (e.skills_required?.join(', ') || 'N/A') + '\n' +
        'Preferred skills: ' + (e.skills_preferred?.join(', ') || 'N/A') + '\n' +
        'Seniority: ' + (e.seniority_level || 'unknown') + '\n' +
        'Min experience: ' + (e.experience_years_min != null ? e.experience_years_min + ' yrs' : 'N/A')
      )
    })
    .join('\n\n')

  return (
    candidateBlock + '\n\n' +
    'JOBS:\n' + jobBlocks + '\n\n' +
    'Score each job. Return a JSON array with exactly one object per job in input order:\n' +
    '[\n' +
    '  {\n' +
    '    "index": 0,\n' +
    '    "fit_score": 0-100,\n' +
    '    "fit_reason": "2-3 sentence explanation of fit or gap",\n' +
    '    "skills_matched": ["skill1", "skill2"],\n' +
    '    "skills_missing": ["skill3"],\n' +
    '    "recommended": true\n' +
    '  }\n' +
    ']\n\n' +
    'Rules:\n' +
    '- fit_score: 0-100. 80+ = strong match. 50-79 = partial. Below 50 = weak.\n' +
    '- recommended: true when fit_score >= 70.\n' +
    '- skills_matched: candidate skills that appear in this job\'s required/preferred lists.\n' +
    '- skills_missing: required skills the candidate does not appear to have.\n' +
    '- fit_reason: factual, specific to this job. No filler phrases.\n' +
    '- index must match the [N] prefix exactly.'
  )
}

// ── batch scorer ──────────────────────────────────────────────────────────────

async function scoreBatch(batch: EnrichedJob[], resume: ResumeData): Promise<JobScore[]> {
  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1500,
    system: [
      {
        type:          'text',
        text:          SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
    ],
    messages: [{
      role:    'user',
      content: buildPrompt(batch, resume),
    }],
  })

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''

  const parsed = JSON.parse(raw) as Array<{ index: number } & JobScore>

  if (!Array.isArray(parsed) || parsed.length !== batch.length) {
    throw new Error('Expected ' + batch.length + ' results, got ' + (Array.isArray(parsed) ? parsed.length : 'non-array'))
  }

  return parsed
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...score }) => score as JobScore)
}

async function scoreJobsOneByOne(jobs: EnrichedJob[], resume: ResumeData): Promise<JobScore[]> {
  const results: JobScore[] = []
  for (const job of jobs) {
    try {
      const single = await scoreBatch([job], resume)
      results.push(single[0])
    } catch {
      results.push({ ...FALLBACK_SCORE })
    }
  }
  return results
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Score an array of enriched jobs against the candidate's resume data.
 * Processes in batches of 5. Falls back to per-job processing if a batch parse fails.
 * On complete failure for a job: returns fit_score=0, fit_reason="Scoring unavailable".
 */
export async function scoreJobsBatch(
  jobs: EnrichedJob[],
  resume: ResumeData
): Promise<JobScore[]> {
  const batches = chunkArray(jobs, 5)
  const allScores: JobScore[] = []

  for (const batch of batches) {
    try {
      const scores = await scoreBatch(batch, resume)
      allScores.push(...scores)
    } catch (err) {
      console.warn(
        '[scorer] Batch parse failed (' + (err as Error).message + '), falling back to per-job'
      )
      const scores = await scoreJobsOneByOne(batch, resume)
      allScores.push(...scores)
    }
  }

  return allScores
}
