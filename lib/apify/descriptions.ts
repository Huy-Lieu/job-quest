// lib/apify/descriptions.ts
// Post-filter description enrichment for Workday jobs.
//
// Workday's CXS listing API only returns bullet fragments -- the full JD text
// lives on the public apply page rendered by a React SPA. Plain fetch returns
// an empty <div id="root">, so we use Apify's rag-web-browser actor which runs
// a real Chromium instance and returns rendered markdown.
//
// This runs AFTER early dedup + location filter so we only pay for survivors.
// Jobs are processed SEQUENTIALLY -- rag-web-browser requests 8192MB each, so
// parallel runs would exhaust the Apify memory limit immediately.
//
// Content extraction priority:
//   1. markdown field (full rendered page)
//   2. metadata.description (shorter but reliable fallback)
// Apify rag-web-browser sometimes returns markdown as "" while
// metadata.description contains the full JD -- always check both.

import { runApifyActor } from '@/lib/apify/search'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

/**
 * For each Workday job in the list that has a source URL, fetch the full
 * rendered job description via Apify rag-web-browser and replace the
 * bullet-fragment description.
 *
 * Jobs are processed one at a time so only one 8192MB actor runs at once,
 * staying within Apify memory limits. All Workday survivors are processed --
 * no artificial cap, since sequential execution prevents memory exhaustion.
 *
 * Content is extracted from the markdown field if populated (>= 100 chars),
 * falling back to metadata.description when markdown is empty (common for
 * Workday's React SPA pages where Chromium renders content into metadata
 * but not into the markdown conversion output).
 *
 * Non-Workday jobs are returned unchanged.
 * Any individual fetch failure silently falls back to the original description.
 */
export async function enrichWorkdayDescriptions(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  // No slice -- all Workday survivors run sequentially, one actor at a time
  const workdayIndices = jobs
    .map((j, i) => ({ i, url: j.source.url }))
    .filter(({ url }) => !!url && url.includes('myworkdayjobs.com'))

  if (workdayIndices.length === 0) return jobs

  console.log('[descriptions] fetching full JDs for ' + workdayIndices.length + ' workday jobs (sequential)')

  const enriched = [...jobs]
  let enrichedCount = 0

  for (const { i, url } of workdayIndices) {
    const t0 = Date.now()
    try {
      const items = await runApifyActor(
        'apify/rag-web-browser',
        { query: url, maxResults: 1, outputFormats: ['markdown'] },
        90_000  // 90s per job -- Chromium startup + React hydration can be slow
      )

      const first = items[0] as Record<string, unknown> | undefined
      if (!first) {
        console.warn(`[descriptions] job ${i}: no result from rag-web-browser (${Date.now() - t0}ms)`)
        continue
      }

      // Prefer full markdown; fall back to metadata.description (Workday SPA
      // sometimes renders content into metadata but not markdown conversion)
      const rawMarkdown = typeof first.markdown === 'string' ? first.markdown.trim() : ''
      const meta        = first.metadata as Record<string, unknown> | undefined
      const rawMeta     = typeof meta?.description === 'string' ? meta.description.trim() : ''

      const content = rawMarkdown.length >= 100 ? rawMarkdown : rawMeta
      if (content.length < 100) {
        console.warn(`[descriptions] job ${i}: content too short (markdown=${rawMarkdown.length} meta=${rawMeta.length}) (${Date.now() - t0}ms)`)
        continue
      }

      // Re-inject newlines before section headers that got collapsed into one paragraph.
      // Workday RAG-fetched markdown sometimes returns the full JD as a single block of text.
      const withBreaks = content.replace(
        /([.!?])\s+(What you[''']ll be doing|What we need to see|What we[''']re looking for|Ways to stand out from the crowd|Ways to stand out|About the role|About the team|About you|Responsibilities|Requirements|Qualifications|Preferred qualifications|Nice to have|Bonus points|Benefits|Who you are|The role|Your impact|Your background|Minimum qualifications|Basic qualifications|Key responsibilities|What you will do|What you['']ll do|What you bring|What you['']ll bring|You will|You have|We offer|We provide)/gi,
        '$1\n\n$2'
      )
      // Strip excessive whitespace but preserve paragraph breaks
      const cleaned = withBreaks.replace(/\n{3,}/g, '\n\n').trim()
      enriched[i] = { ...enriched[i], description: cleaned }
      enrichedCount++
      console.log(`[descriptions] job ${i} ok: ${Date.now() - t0}ms, source=${rawMarkdown.length >= 100 ? 'markdown' : 'metadata'}, chars=${cleaned.length}`)
    } catch (err) {
      // Individual failure -- keep original bullet-fragment description
      console.warn(`[descriptions] job ${i} failed: ${String(err)} (${Date.now() - t0}ms)`)
    }
  }

  console.log('[descriptions] enriched ' + enrichedCount + '/' + workdayIndices.length + ' workday jobs')
  return enriched
}
