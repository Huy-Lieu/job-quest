// lib/pipeline/deduplicate.ts
// 3-stage deduplication pipeline. Fast stages first — Claude only as last resort.
//
// Stage 1: source_job_id exact match in job_sources table  (fastest, DB index)
// Stage 2: SHA-256 hash of (company|title|location) in jobs.raw_hash  (fast, DB index)
// Stage 3: Claude Haiku fuzzy YES/NO  (slow, ~50 calls/month — only for ambiguous pairs)

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { isFuzzyDuplicate } from '@/lib/claude/dedup'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str.toLowerCase()).digest('hex')
}

function hashJob(job: NormalizedJob): string {
  return sha256(job.company + '|' + job.canonical_title + '|' + job.location)
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Filter a batch of normalized jobs down to only genuinely new ones.
 *
 * Stages run sequentially per job (fast filter first):
 *   1. source_job_id match in job_sources  → existing: skip
 *   2. SHA-256 hash match in jobs          → existing: skip
 *   3. Claude Haiku fuzzy match vs same-company candidates already accepted
 *      this run                            → duplicate: skip
 *
 * Returns the subset of jobs that passed all stages, each augmented with its
 * computed raw_hash so the storage layer can persist it without recomputing.
 */
export async function deduplicateJobs(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const newJobs: NormalizedJob[] = []
  let filteredBySourceId = 0
  let filteredByHash    = 0
  let filteredByFuzzy   = 0

  for (const job of jobs) {
    // ── Stage 1: source job ID ────────────────────────────────────────────────
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

    // ── Stage 2: SHA-256 content hash ─────────────────────────────────────────
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

    // Also check jobs already accepted in this same run (within-batch dedup)
    const withinBatchHashDup = newJobs.some(j => j.raw_hash === hash)
    if (withinBatchHashDup) {
      filteredByHash++
      continue
    }

    // ── Stage 3: Claude Haiku fuzzy match ─────────────────────────────────────
    // Only compare against same-company jobs already accepted this run.
    // Avoids O(n²) Claude calls — at most a handful of same-company pairs.
    const sameCompanyCandidates = newJobs.filter(
      j => j.company.toLowerCase() === job.company.toLowerCase()
    )

    let fuzzyDup = false
    for (const candidate of sameCompanyCandidates) {
      const isDup = await isFuzzyDuplicate(job, candidate)
      if (isDup) {
        fuzzyDup = true
        break
      }
    }

    if (fuzzyDup) {
      filteredByFuzzy++
      continue
    }

    // ── Unique — accept ───────────────────────────────────────────────────────
    newJobs.push({ ...job, raw_hash: hash })
  }

  console.log(
    '[deduplicate] input=' + jobs.length +
    ' filtered_by_source_id=' + filteredBySourceId +
    ' filtered_by_hash=' + filteredByHash +
    ' filtered_by_fuzzy=' + filteredByFuzzy +
    ' unique=' + newJobs.length
  )

  return newJobs
}
