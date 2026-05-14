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
//
// Previously this ran 2 DB queries per job (serial N+1 loop).
// Now it runs exactly 2 bulk IN queries for the entire batch, then filters
// in memory — O(1) DB round-trips regardless of input size.

export async function deduplicateEarly(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  if (jobs.length === 0) return []

  // ── Step 1: compute hashes for all jobs upfront ───────────────────────────
  const withHashes = jobs.map(job => ({ job, hash: hashJob(job) }))

  // ── Step 2: bulk-fetch known source IDs in one query ─────────────────────
  // Collect all (source_name, source_job_id) pairs that have a source_job_id
  const sourceIdPairs = withHashes
    .filter(({ job }) => job.source.source_job_id && job.source.name)
    .map(({ job }) => job.source.source_job_id as string)

  const knownSourceIds = new Set<string>()  // key: "sourceName::sourceJobId"

  if (sourceIdPairs.length > 0) {
    const { data: existingSources } = await supabaseAdmin
      .from('job_sources')
      .select('source_name, source_job_id')
      .in('source_job_id', sourceIdPairs)

    for (const row of existingSources ?? []) {
      knownSourceIds.add(`${row.source_name}::${row.source_job_id}`)
    }
  }

  // ── Step 3: bulk-fetch known hashes in one query ──────────────────────────
  const allHashes = withHashes.map(({ hash }) => hash)

  const { data: existingJobs } = await supabaseAdmin
    .from('jobs')
    .select('raw_hash')
    .in('raw_hash', allHashes)

  const knownHashes = new Set<string>((existingJobs ?? []).map(r => r.raw_hash))

  // ── Step 4: single-pass in-memory filter ─────────────────────────────────
  const survivors: NormalizedJob[] = []
  const batchHashes = new Set<string>()   // within-batch dedup
  let filteredBySourceId = 0
  let filteredByHash     = 0

  for (const { job, hash } of withHashes) {
    // Stage 1: source ID exact match (DB)
    if (job.source.source_job_id && job.source.name) {
      const key = `${job.source.name}::${job.source.source_job_id}`
      if (knownSourceIds.has(key)) {
        filteredBySourceId++
        continue
      }
    }

    // Stage 2: hash match (DB or within this batch)
    if (knownHashes.has(hash) || batchHashes.has(hash)) {
      filteredByHash++
      continue
    }

    batchHashes.add(hash)
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
