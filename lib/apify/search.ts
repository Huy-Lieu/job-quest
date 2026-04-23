// lib/apify/search.ts
// Core Apify actor runner - fires a run, polls until SUCCEEDED/FAILED, returns items.
// Never throws. A failed or timed-out actor returns [] so the pipeline continues.

import type { RawApifyJob } from '@/lib/types'

const APIFY_TOKEN = process.env.APIFY_TOKEN

const POLL_INTERVAL_MS   = 5_000    // poll every 5 seconds
const DEFAULT_TIMEOUT_MS = 240_000  // abandon after 4 minutes

/**
 * Run any Apify actor with the given input and return its dataset items.
 *
 * - Fires POST /v2/acts/{actorId}/runs to start the run
 * - Polls GET /v2/actor-runs/{runId} every 5s until SUCCEEDED or FAILED
 * - On SUCCEEDED: fetches and returns /v2/datasets/{defaultDatasetId}/items
 * - On FAILED / ABORTED / timeout: logs a warning and returns [] -- never throws
 *
 * @param actorId   - Apify actor slug, e.g. "curious_coder/linkedin-jobs-scraper"
 * @param input     - Actor input object (shape varies per actor)
 * @param timeoutMs - Max ms to wait before abandoning the run (default: 4 minutes)
 */
export async function runApifyActor(
  actorId:   string,
  input:     object,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RawApifyJob[]> {
  if (!APIFY_TOKEN) {
    console.warn('[apify] APIFY_TOKEN is not set - skipping actor run:', actorId)
    return []
  }

  // Apify REST API requires "username~actor-name" form
  // Slashes in the path segment break URL routing
  const actorPath = actorId.replace('/', '~')

  // Step 1: Start the run
  let runId: string
  try {
    const startRes = await fetch(
      'https://api.apify.com/v2/acts/' + actorPath + '/runs?token=' + APIFY_TOKEN,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
        cache:   'no-store',
      }
    )

    if (!startRes.ok) {
      const body = await startRes.text().catch(() => '')
      console.warn(
        '[apify] Actor start failed (' + actorId + '): ' +
        startRes.status + ' ' + startRes.statusText + ' -- ' + body.slice(0, 300)
      )
      return []
    }

    const { data: run } = await startRes.json() as { data: { id: string } }
    runId = run.id
  } catch (err) {
    console.warn('[apify] Network error starting actor ' + actorId + ':', (err as Error).message)
    return []
  }

  // Step 2: Poll for completion every 5 seconds
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)

    let runStatus: string
    let defaultDatasetId: string

    try {
      const statusRes = await fetch(
        'https://api.apify.com/v2/actor-runs/' + runId + '?token=' + APIFY_TOKEN,
        { cache: 'no-store' }
      )
      if (!statusRes.ok) {
        console.warn('[apify] Status poll failed for run ' + runId + ': ' + statusRes.status)
        continue  // try again on next tick
      }
      const { data } = await statusRes.json() as {
        data: { status: string; defaultDatasetId: string }
      }
      runStatus        = data.status
      defaultDatasetId = data.defaultDatasetId
    } catch (err) {
      console.warn('[apify] Network error polling run ' + runId + ':', (err as Error).message)
      continue
    }

    if (runStatus === 'SUCCEEDED') {
      return fetchDatasetItems(defaultDatasetId)
    }

    if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {
      console.warn('[apify] Run ' + runId + ' ended with status ' + runStatus + ' (actor: ' + actorId + ')')
      return []
    }

    // RUNNING / READY - keep polling
  }

  console.warn('[apify] Run ' + runId + ' timed out after ' + timeoutMs + 'ms (actor: ' + actorId + ') - abandoning')
  return []
}

// Fetch all items from a completed Apify dataset.
// Returns [] on any error so callers never need to handle failures.
async function fetchDatasetItems(datasetId: string): Promise<RawApifyJob[]> {
  try {
    const res = await fetch(
      'https://api.apify.com/v2/datasets/' + datasetId + '/items?token=' + APIFY_TOKEN + '&format=json&clean=true',
      { cache: 'no-store' }
    )
    if (!res.ok) {
      console.warn('[apify] Dataset fetch failed for ' + datasetId + ': ' + res.status)
      return []
    }
    const items = await res.json()
    return Array.isArray(items) ? (items as RawApifyJob[]) : []
  } catch (err) {
    console.warn('[apify] Network error fetching dataset ' + datasetId + ':', (err as Error).message)
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
