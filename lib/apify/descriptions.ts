// lib/apify/descriptions.ts
// Post-filter description enrichment for sources whose listing APIs return
// incomplete or empty job descriptions.
//
// Sources that need rag-web-browser (Chromium render):
//   • Workday       — CXS listing API returns bulletFields[] only (~50-150 chars)
//   • SmartRecruiters — listing API always returns description: ''
//   • Workable      — listing API returns snippet only; full JD is on the detail page
//   • Recruitee     — API can return truncated HTML; enriched when description < 500 chars
//
// Sources that do NOT need enrichment (full description already in actor output):
//   • LinkedIn      — scrapeJobDetails: true fetches full HTML
//   • Indeed        — fetchJobDetails: true fetches full HTML
//   • Greenhouse    — ?content=true API returns full HTML
//   • Lever         — descriptionPlain/description from JSON API is complete
//   • Ashby         — descriptionHtml/descriptionPlain from JSON API is complete
//
// Jobs are processed in parallel batches of 3.
// 3 concurrent × 8192MB = 24GB — safely under the Apify free tier 32GB limit.
// No cap on total jobs — all detected jobs are enriched, batch by batch.

import { runApifyActor } from '@/lib/apify/search'
import type { NormalizedJob } from '@/lib/pipeline/normalize'

const SECTION_HEADERS_RE = /What you(?:'ll| will) be doing|What we need to see|What we(?:'re| are) looking for|Ways to stand out from the crowd|Ways to stand out|About the role|About the team|About you|Responsibilities|Requirements|Qualifications|Preferred qualifications|Nice to have|Bonus points|Benefits|Who you are|The role|Your impact|Your background|Minimum qualifications|Basic qualifications|Key responsibilities|What you will do|What you(?:'ll)? do|What you bring|You will|You have|We offer|We provide/gi

const BATCH_SIZE = 3  // 3 concurrent × 8192MB = 24GB, safe under Apify free 32GB

/**
 * Detect whether a job needs rag-web-browser description enrichment.
 * Returns true for:
 *   - Workday jobs (URL contains myworkdayjobs.com) — always
 *   - SmartRecruiters jobs (URL contains smartrecruiters.com) — always
 *   - Workable jobs (URL contains workable.com) — always
 *   - Recruitee jobs (source name is 'recruitee') — only when description < 500 chars
 */
function needsEnrichment(job: NormalizedJob): boolean {
  const url = job.source.url ?? ''
  if (url.includes('myworkdayjobs.com'))  return true
  if (url.includes('smartrecruiters.com')) return true
  if (url.includes('workable.com'))        return true
  if (job.source.name === 'recruitee' && job.description.length < 500) return true
  return false
}

/**
 * Fetch the full rendered job description for a single job URL via
 * Apify rag-web-browser. Returns the cleaned description string, or
 * null if the fetch failed or returned content that was too short.
 */
async function fetchDescription(url: string, jobIndex: number): Promise<string | null> {
  const t0 = Date.now()
  try {
    const items = await runApifyActor(
      'apify/rag-web-browser',
      { query: url, maxResults: 1, outputFormats: ['markdown'] },
      120_000   // 120s timeout per job (up from 90s — SmartRecruiters/Workable can be slower)
    )

    const first = items[0] as Record<string, unknown> | undefined
    if (!first) {
      console.warn(`[descriptions] job ${jobIndex}: no result from rag-web-browser (${Date.now() - t0}ms)`)
      return null
    }

    const rawMarkdown = typeof first.markdown === 'string' ? first.markdown.trim() : ''
    const meta        = first.metadata as Record<string, unknown> | undefined
    const rawMeta     = typeof meta?.description === 'string' ? meta.description.trim() : ''

    const content = rawMarkdown.length >= 100 ? rawMarkdown : rawMeta
    if (content.length < 100) {
      console.warn(`[descriptions] job ${jobIndex}: content too short (markdown=${rawMarkdown.length} meta=${rawMeta.length}) (${Date.now() - t0}ms)`)
      return null
    }

    // Decode HTML entities (some sources leave &amp; etc. in markdown)
    const decoded = content
      .replace(/&amp;/g,  '&')
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g,  "'")
      .replace(/&nbsp;/g, ' ')

    // Re-inject newlines before section headers collapsed into one paragraph
    const withBreaks = decoded.replace(
      new RegExp('([.!?])\\s+(' + SECTION_HEADERS_RE.source + ')', 'gi'),
      '$1\n\n$2'
    )

    // Split "Header: content" into two lines
    const withHeaderSplit = withBreaks.replace(
      new RegExp('^(' + SECTION_HEADERS_RE.source + '):\\s+', 'gim'),
      '$1\n'
    )

    // Collapse excessive whitespace
    const cleaned = withHeaderSplit.replace(/\n{3,}/g, '\n\n').trim()

    console.log(
      `[descriptions] job ${jobIndex} ok: ${Date.now() - t0}ms,`,
      `source=${rawMarkdown.length >= 100 ? 'markdown' : 'metadata'},`,
      `chars=${cleaned.length}`
    )
    return cleaned
  } catch (err) {
    console.warn(`[descriptions] job ${jobIndex} failed: ${String(err)} (${Date.now() - t0}ms)`)
    return null
  }
}

/**
 * Enrich job descriptions for sources that return incomplete text at listing time.
 *
 * Detected sources: Workday, SmartRecruiters, Workable, Recruitee (when short).
 * Processes in parallel batches of 3 (safe within Apify free tier 32GB limit).
 * All detected jobs are processed — no cap on total count.
 */
export async function enrichDescriptions(
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  const targets = jobs
    .map((j, i) => ({ i, url: j.source.url, source: j.source.name }))
    .filter(({ i }) => needsEnrichment(jobs[i]))

  if (targets.length === 0) return jobs

  console.log(
    `[descriptions] enriching ${targets.length} jobs in batches of ${BATCH_SIZE}`,
    `(sources: ${[...new Set(targets.map(t => t.source))].join(', ')})`
  )

  const enriched = [...jobs]
  let enrichedCount = 0

  // Process in parallel batches of BATCH_SIZE
  for (let b = 0; b < targets.length; b += BATCH_SIZE) {
    const batch = targets.slice(b, b + BATCH_SIZE)
    const batchNum = Math.floor(b / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(targets.length / BATCH_SIZE)
    console.log(`[descriptions] batch ${batchNum}/${totalBatches}: jobs [${batch.map(t => t.i).join(', ')}]`)

    const results = await Promise.allSettled(
      batch.map(({ i, url }) => fetchDescription(url, i))
    )

    for (let k = 0; k < batch.length; k++) {
      const result = results[k]
      const { i } = batch[k]
      if (result.status === 'fulfilled' && result.value !== null) {
        enriched[i] = { ...enriched[i], description: result.value }
        enrichedCount++
      }
    }
  }

  console.log(`[descriptions] enriched ${enrichedCount}/${targets.length} jobs`)
  return enriched
}
