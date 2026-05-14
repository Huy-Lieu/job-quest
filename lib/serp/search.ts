// lib/serp/search.ts
// SerpAPI google_jobs integration with offset-based pagination

import type { SerpJobResult } from '@/lib/types'

const SERPAPI_KEY    = process.env.SERPAPI_KEY
export const SERP_MAX_OFFSET = 50 // hard cap — quality degrades beyond this

export interface SerpSearchResult {
  results:    SerpJobResult[]
  nextOffset: number
}

/**
 * Fire the SerpAPI google_jobs engine for a query + location.
 *
 * US-only intent: the caller (lib/pipeline/core.ts) always passes
 * config.locations[0] ?? 'United States' as the location, so in practice
 * this function is always called with a US location string. The `location`
 * parameter is kept generic to avoid a hard-coded assumption here, but the
 * pipeline is designed and tested for US-only job searching.
 *
 * @param query    - Keywords to search, e.g. "embedded software engineer"
 * @param location - Location filter; in practice always "United States" (see above)
 * @param daysAgo  - Recency filter: 1 = today, ≤7 = past week, else past month
 * @param offset   - Pagination cursor (serp_next_offset from search_configs). Defaults to 0.
 * @returns results array and the next cursor to persist back to search_configs.serp_next_offset
 *
 * Reset logic (nextOffset = 0) triggers when:
 *   - results.length < 10  — pool exhausted, Google returned a partial page
 *   - offset + 10 >= SERP_MAX_OFFSET  — hard safety cap reached
 * Otherwise nextOffset = offset + 10.
 *
 * The caller is responsible for persisting nextOffset back to search_configs:
 *   await supabaseAdmin
 *     .from('search_configs')
 *     .update({ serp_next_offset: nextOffset })
 *     .eq('id', config.id)
 */
export async function searchGoogleJobs(
  query:    string,
  location  = 'United States',
  daysAgo   = 7,
  offset    = 0,
): Promise<SerpSearchResult> {
  if (!SERPAPI_KEY) throw new Error('SERPAPI_KEY environment variable is not set')

  const chips =
    daysAgo === 1  ? 'date_posted:today' :
    daysAgo <= 7   ? 'date_posted:week'  :
                     'date_posted:month'

  const params = new URLSearchParams({
    engine:  'google_jobs',
    q:       query,
    location,
    chips,
    start:   String(offset),
    api_key: SERPAPI_KEY,
  })

  const res = await fetch(`https://serpapi.com/search.json?${params}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SerpAPI error ${res.status}: ${body}`)
  }

  const data = await res.json() as { jobs_results?: SerpJobResult[] }
  const results: SerpJobResult[] = data.jobs_results ?? []

  // Determine next offset:
  //   Reset to 0 if the pool is exhausted (partial page) or we'd exceed the hard cap
  const nextOffset = (results.length < 10 || offset + 10 >= SERP_MAX_OFFSET) ? 0 : offset + 10

  return { results, nextOffset }
}
