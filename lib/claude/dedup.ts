// lib/claude/dedup.ts
// Stage 3 deduplication only — called when source-ID and SHA-256 hash checks both fail.
// Asks Claude Haiku to decide if two job listings describe the same role.

import Anthropic from '@anthropic-ai/sdk'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

const client = new Anthropic()

const SYSTEM_PROMPT =
  'You are a job listing deduplication assistant. Respond with YES or NO only.'

function jobSummary(job: NormalizedJob): string {
  return [
    'Title: ' + job.canonical_title,
    'Company: ' + job.company,
    'Location: ' + job.location,
    'Description (first 300 chars): ' + job.description.slice(0, 300),
  ].join('\n')
}

/**
 * Returns true if Haiku judges the two listings to be the same job role.
 * On any error (network, parse, etc.) returns false to avoid false-positive dedup.
 */
export async function isFuzzyDuplicate(
  jobA: NormalizedJob,
  jobB: NormalizedJob
): Promise<boolean> {
  try {
    const userPrompt =
      'Are these two job listings for the same role?\n\n' +
      'Job A:\n' + jobSummary(jobA) + '\n\n' +
      'Job B:\n' + jobSummary(jobB)

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      system: [
        {
          type:          'text',
          text:          SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text =
      response.content[0]?.type === 'text' ? response.content[0].text : ''

    return text.trim().toUpperCase() === 'YES'
  } catch {
    return false
  }
}
