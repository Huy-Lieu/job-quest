// lib/claude/dedup.ts
// Stage 3 deduplication only — called when source-ID and SHA-256 hash checks both fail.
// Batches multiple pairs into a single Claude Haiku call instead of one call per pair.

import Anthropic from '@anthropic-ai/sdk'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

const client = new Anthropic()

const SYSTEM_PROMPT =
  'You are a job listing deduplication assistant. ' +
  'You will receive multiple pairs of job listings. ' +
  'For each pair respond with YES if they describe the same role, or NO if they are different. ' +
  'Return ONLY a JSON array of strings, one per pair, in the same order. Example: ["YES","NO","YES"]'

function jobSummary(job: NormalizedJob): string {
  return [
    'Title: ' + job.canonical_title,
    'Company: ' + job.company,
    'Location: ' + job.location,
    'Description (first 300 chars): ' + job.description.slice(0, 300),
  ].join('\n')
}

export interface DedupPair {
  jobA: NormalizedJob
  jobB: NormalizedJob
}

/**
 * Batch deduplication — sends multiple pairs in a single Claude Haiku call.
 * Returns a boolean array parallel to the input pairs array.
 * true = same role (duplicate), false = different roles.
 * On any error returns all-false to avoid false-positive dedup.
 */
export async function areFuzzyDuplicates(pairs: DedupPair[]): Promise<boolean[]> {
  if (pairs.length === 0) return []

  try {
    const pairBlocks = pairs
      .map((pair, i) =>
        `Pair ${i + 1}:\n` +
        `Job A:\n${jobSummary(pair.jobA)}\n\n` +
        `Job B:\n${jobSummary(pair.jobB)}`
      )
      .join('\n\n---\n\n')

    const userPrompt =
      `Are the jobs in each pair the same role?\n\n${pairBlocks}\n\n` +
      `Return a JSON array of ${pairs.length} strings: "YES" or "NO" per pair, in order.`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20 + pairs.length * 6, // ~6 tokens per "YES"/"NO" entry
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]'
    // Strip markdown code fences Claude sometimes wraps around JSON output
    const raw = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed) || parsed.length !== pairs.length) {
      console.warn('[dedup] Unexpected response length, defaulting all to false')
      return pairs.map(() => false)
    }

    return parsed.map(v => String(v).trim().toUpperCase() === 'YES')
  } catch (err) {
    console.warn('[dedup] Batch call failed, defaulting all to false:', err)
    return pairs.map(() => false)
  }
}

/**
 * Single-pair convenience wrapper — kept for backward compatibility.
 * Prefer areFuzzyDuplicates() for multiple pairs.
 */
export async function isFuzzyDuplicate(
  jobA: NormalizedJob,
  jobB: NormalizedJob
): Promise<boolean> {
  const results = await areFuzzyDuplicates([{ jobA, jobB }])
  return results[0] ?? false
}
