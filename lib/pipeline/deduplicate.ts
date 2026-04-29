// lib/pipeline/deduplicate.ts
// 2-stage deduplication pipeline. Free stages only — no Claude calls.
//
// Stage 1: source_job_id exact match in job_sources table  (fastest, DB index)
// Stage 2: SHA-256 hash of (company|title|location) in jobs.raw_hash  (fast, DB index)
// Stage 3: free title-similarity fuzzy check within the same company  (fast, in-memory)
//
// The pipeline calls these in two separate passes:
//   deduplicateEarly()  — Stages 1+2 (free, before location filter)
//   deduplicateFuzzy()  — Stage 3    (free, after location filter)

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str.toLowerCase()).digest('hex')
}

function hashJob(job: NormalizedJob): string {
  return sha256(job.company + '|' + job.canonical_title + '|' + job.location)
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function titlesAreSimilar(a: string, b: string): boolean {
  const na = normTitle(a)
  const nb = normTitle(b)
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer  = na.length <= nb.length ? nb : na
  return shorter.length > 8 && longer.includes(shorter)
}

// ── Stage 1 + 2: cheap DB deduplication ──────────────────────────────────────

export async function deduplicateEarly(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const survivors: NormalizedJob[] = []
  let filteredBySourceId = 0
  let filteredByHash     = 0

  for (const job of jobs) {
    if (job.source.source_job_id && job.source.name) {
      const { data: existing } = await supabaseAdmin
        .from('job_sources')
        .select('job_id')
        .eq('source_name', job.source.name)
        .eq('source_job_id', job.source.source_job_id)
        .maybeSingle()

      if (existing) {
        filteredBySourceId++
        continue
      }
    }

    const hash = hashJob(job)

    const { data: hashMatch } = await supabaseAdmin
      .from('jobs')
      .select('id')
      .eq('raw_hash', hash)
      .maybeSingle()

    if (hashMatch) {
      filteredByHash++
      continue
    }

    const withinBatchDup = survivors.some(j => j.raw_hash === hash)
    if (withinBatchDup) {
      filteredByHash++
      continue
    }

    survivors.push({ ...job, raw_hash: hash })
  }

  console.log(
    '[deduplicate/early] input=' + jobs.length +
    ' filtered_by_source_id=' + filteredBySourceId +
    ' filtered_by_hash=' + filteredByHash +
    ' survivors=' + survivors.length
  )

  return survivors
}

// ── Stage 3: free title-similarity fuzzy deduplication ───────────────────────

export async function deduplicateFuzzy(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const unique: NormalizedJob[] = []
  let filteredByFuzzy = 0

  for (const job of jobs) {
    const sameCompanyCandidates = unique.filter(
      j => j.company.toLowerCase() === job.company.toLowerCase()
    )

    const isFuzzyDup = sameCompanyCandidates.some(
      candidate => titlesAreSimilar(job.canonical_title, candidate.canonical_title)
    )

    if (isFuzzyDup) {
      filteredByFuzzy++
      continue
    }

    unique.push(job)
  }

  console.log(
    '[deduplicate/fuzzy] input=' + jobs.length +
    ' filtered_by_fuzzy=' + filteredByFuzzy +
    ' unique=' + unique.length
  )

  return unique
}

/** @deprecated Use deduplicateEarly() + deduplicateFuzzy() separately. */
export async function deduplicateJobs(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const afterEarly = await deduplicateEarly(jobs)
  return deduplicateFuzzy(afterEarly)
}
