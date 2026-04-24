// app/api/search/run/route.ts
// Cron-triggered job search pipeline — same logic as the SSE stream route but
// no streaming. Called by Vercel Cron at 07:00 UTC daily via vercel.json.
//
// Auth: Authorization: Bearer CRON_SECRET (not session-based)
// Runs the full pipeline sequentially for every due active search config.

import { NextResponse }  from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SearchConfig } from '@/lib/types'
import { runPipelineForConfig } from '@/lib/search/run-pipeline'

// ── "due" threshold — how long after last_run_at before we re-run ─────────────

const INTERVAL_MS: Record<string, number> = {
  daily:  24 * 60 * 60 * 1000,
  '6h':    6 * 60 * 60 * 1000,
  manual: Infinity,   // never auto-triggered
}

function isDue(config: SearchConfig): boolean {
  if (config.schedule_interval === 'manual') return false
  if (!config.last_run_at) return true
  const intervalMs = INTERVAL_MS[config.schedule_interval] ?? INTERVAL_MS.daily
  return Date.now() - new Date(config.last_run_at).getTime() >= intervalMs
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''
  if (!cronSecret || authHeader !== 'Bearer ' + cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: configs, error: configsError } = await (supabaseAdmin as any)
    .from('search_configs')
    .select('*')
    .eq('is_active', true) as { data: SearchConfig[] | null; error: unknown }

  if (configsError || !configs) {
    return NextResponse.json({ error: 'Failed to load search configs' }, { status: 500 })
  }

  const dueConfigs = configs.filter(isDue)
  const summary = { configs_run: 0, jobs_added: 0, errors: [] as string[] }

  for (const config of dueConfigs) {
    try {
      const added = await runPipelineForConfig(config)
      summary.configs_run++
      summary.jobs_added += added
    } catch (err) {
      const msg = '[cron] Config ' + config.id + ' failed: ' + (err instanceof Error ? err.message : String(err))
      console.error(msg)
      summary.errors.push(msg)
    }
  }

  return NextResponse.json(summary, { status: 200 })
}
