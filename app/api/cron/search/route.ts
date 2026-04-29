// app/api/cron/search/route.ts
// Intended for Vercel Cron (e.g. 07:00 UTC) — triggers due configs via POST /api/search/run.
// Product note: scheduled automation is still optional; see jobquest-search-architecture.md.
// Configure in vercel.json when you enable it: { "crons": [{ "path": "/api/cron/search", "schedule": "0 7 * * *" }] }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  // Verify the request comes from Vercel Cron (or your own scheduler)
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Fetch all active search configs
  const { data: configs, error } = await supabaseAdmin
    .from('search_configs')
    .select('id, user_id, last_run_at, schedule_interval')
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter to configs that are due for a run
  const due = (configs ?? []).filter((c) => isSearchDue(c))

  // Trigger each search — fire and forget (don't await results)
  const baseUrl = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'
  const results = await Promise.allSettled(
    due.map((c) =>
      fetch(`${baseUrl}/api/search/run`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass an internal service token so the route handler accepts the call
          'X-Internal-Token': process.env.CRON_SECRET!,
        },
        body: JSON.stringify({ userId: c.user_id, configId: c.id }),
      })
    )
  )

  const triggered = results.filter((r) => r.status === 'fulfilled').length
  const failed    = results.length - triggered

  return NextResponse.json({ triggered, failed, total: due.length })
}

function isSearchDue(config: {
  last_run_at:       string | null
  schedule_interval: string | null
}): boolean {
  if (!config.last_run_at) return true  // never run before — always due

  const intervalHours: Record<string, number> = {
    daily:  24,
    '6h':    6,
    manual: Infinity,
  }

  const hours = intervalHours[config.schedule_interval ?? 'daily'] ?? 24
  const nextRun = new Date(config.last_run_at).getTime() + hours * 3_600_000
  return Date.now() >= nextRun
}
