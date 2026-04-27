// lib/search/run-pipeline.ts
// Cron-triggered pipeline wrapper — owns search_runs row lifecycle.
// Pipeline logic lives in lib/pipeline/core.ts.

import { supabaseAdmin }   from '@/lib/supabase'
import { runPipelineCore } from '@/lib/pipeline/core'
import type { SearchConfig } from '@/lib/types'

async function setProgress(
  runId: string,
  stage: string,
  extra: Record<string, unknown> = {}
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabaseAdmin as any)
    .from('search_runs')
    .update({ progress: { stage, ...extra } })
    .eq('id', runId)
}

export async function runPipelineForConfig(config: SearchConfig): Promise<number> {
  const userId = config.user_id

  // Create search_runs row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, error: runError } = await (supabaseAdmin as any)
    .from('search_runs')
    .insert({ user_id: userId, config_id: config.id, status: 'running' })
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (runError || !run) throw new Error('Failed to create search_runs row')
  const runId = run.id

  try {
    const result = await runPipelineCore(config, userId, async (stage, data) => {
      await setProgress(runId, stage, data)
    })

    // Mark run complete
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({
        status:        'complete',
        completed_at:  now,
        jobs_found:    result.found,
        jobs_new:      result.inserted,
        jobs_enriched: result.enriched,
        jobs_scored:   result.scored,
        progress:      {
          stage:     'complete',
          found:     result.found,
          unique:    result.unique,
          scored:    result.scored,
          jobsAdded: result.inserted,
        },
      })
      .eq('id', runId)

    console.log(
      '[cron] Config', config.id, 'complete —',
      'found:', result.found,
      'new:', result.inserted,
      'scored:', result.scored,
    )
    return result.inserted

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ status: 'failed', error_text: message, progress: { stage: 'failed', message } })
      .eq('id', runId)
    throw err
  }
}
