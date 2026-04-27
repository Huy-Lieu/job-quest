// lib/pipeline/deduplicate.ts
// 3-stage deduplication pipeline. Fast stages first — Claude only as last resort.
//
// Stage 1: source_job_id exact match in job_sources table  (fastest, DB index)
// Stage 2: SHA-256 hash of (company|title|location) in jobs.raw_hash  (fast, DB index)
// Stage 3: Claude Haiku fuzzy YES/NO  (slow — only after enrich, only for ambiguous pairs)
//
// The pipeline calls these in two separate passes:
//   deduplicateEarly()  — Stages 1+2 (free, before enrichment)
//   deduplicateFuzzy()  — Stage 3    (paid, after enrichment)

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { areFuzzyDuplicates, type DedupPair } from '@/lib/claude/dedup'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str.toLowerCase()).digest('hex')
}

function hashJob(job: NormalizedJob): string {
  return sha256(job.company + '|' + job.canonical_title + '|' + job.location)
}

// ── Stage 1 + 2: cheap DB deduplication ──────────────────────────────────────

/**
 * Stages 1 and 2 — free, DB-only deduplication.
 * Call this BEFORE enrichment to avoid paying Claude for jobs already in the DB.
 *
 * Stage 1: source_job_id exact match in job_sources
 * Stage 2: SHA-256 hash match in jobs.raw_hash (+ within-batch check)
 *
 * Returns surviving jobs, each augmented with their computed raw_hash.
 */
export async function deduplicateEarly(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const survivors: NormalizedJob[] = []
  let filteredBySourceId = 0
  let filteredByHash     = 0

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

    // Within-batch hash dedup — catches duplicates across sources in the same run
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

// ── Stage 3: Claude Haiku fuzzy deduplication ─────────────────────────────────

/**
 * Stage 3 — Claude Haiku fuzzy deduplication.
 * Call this AFTER enrichment, only on the survivors of deduplicateEarly().
 *
 * Compares each job against same-company jobs already accepted this run.
 * All pairs for a given job are sent in a single batched Claude call.
 *
 * Returns the final unique set.
 */
export async function deduplicateFuzzy(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const unique: NormalizedJob[] = []
  let filteredByFuzzy = 0

  for (const job of jobs) {
    const sameCompanyCandidates = unique.filter(
      j => j.company.toLowerCase() === job.company.toLowerCase()
    )

    if (sameCompanyCandidates.length > 0) {
      const pairs: DedupPair[] = sameCompanyCandidates.map(candidate => ({
        jobA: job,
        jobB: candidate,
      }))

      const results = await areFuzzyDuplicates(pairs)
      const isFuzzyDup = results.some(Boolean)

      if (isFuzzyDup) {
        filteredByFuzzy++
        continue
      }
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

// ── Legacy export — kept for backward compatibility ───────────────────────────

/**
 * @deprecated Use deduplicateEarly() + deduplicateFuzzy() separately.
 * This combines all 3 stages in one pass — wasteful when enrichment runs between them.
 */
export async function deduplicateJobs(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const afterEarly = await deduplicateEarly(jobs)
  return deduplicateFuzzy(afterEarly)
}
