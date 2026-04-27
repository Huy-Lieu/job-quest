// app/api/search/stream/route.ts
// SSE streaming wrapper around the shared pipeline core.
// Owns: auth, search_runs row lifecycle, SSE emission, cancellation.
// Pipeline logic lives in lib/pipeline/core.ts.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { supabaseAdmin }    from '@/lib/supabase'
import { cancelRun, isCancelled, clearCancellation } from '@/lib/search/cancellation'
import { runPipelineCore }  from '@/lib/pipeline/core'
import type { SearchConfig } from '@/lib/types'

export const maxDuration = 300
export const dynamic     = 'force-dynamic'

// ── SSE helpers ───────────────────────────────────────────────────────────────

function makeStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  function emit(event: string, data: object) {
    const chunk = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'
    controller.enqueue(encoder.encode(chunk))
  }

  function close() {
    try { controller.close() } catch { /* already closed */ }
  }

  return { stream, emit, close }
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const configId = searchParams.get('configId') ?? searchParams.get('searchConfigId')
  if (!configId) {
    return NextResponse.json({ error: 'configId is required' }, { status: 400 })
  }

  const userId = session.user.id
  const { stream, emit, close } = makeStream()

  // Run pipeline in background — response streams independently
  runStreamPipeline(userId, configId, emit, close).catch(err => {
    console.error('[search/stream] Unhandled pipeline error:', err)
    close()
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}

// ── Streaming pipeline wrapper ────────────────────────────────────────────────

async function runStreamPipeline(
  userId:   string,
  configId: string,
  emit:     (event: string, data: object) => void,
  close:    () => void,
) {
  // Load search config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: config, error: configError } = await (supabaseAdmin as any)
    .from('search_configs')
    .select('*')
    .eq('id', configId)
    .eq('user_id', userId)
    .single() as { data: SearchConfig | null; error: unknown }

  if (configError || !config) {
    emit('error', { message: 'Search config not found' })
    close()
    return
  }

  // Create search_runs row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run, error: runError } = await (supabaseAdmin as any)
    .from('search_runs')
    .insert({ user_id: userId, config_id: configId, status: 'running' })
    .select()
    .single() as { data: { id: string } | null; error: unknown }

  if (runError || !run) {
    emit('error', { message: 'Failed to create search run' })
    close()
    return
  }

  const runId = run.id

  // Progress map: stage → SSE progress percentage
  const STAGE_PROGRESS: Record<string, number> = {
    scraping:      10,
    normalizing:   25,
    enriching:     45,
    deduplicating: 60,
    scoring:       80,
  }

  /** Emit SSE progress event and write to polling fallback column. */
  async function progress(stage: string, data: Record<string, unknown>) {
    const payload = { stage, progress: STAGE_PROGRESS[stage] ?? 50, ...data }
    emit('progress', payload)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ progress: payload })
      .eq('id', runId)
  }

  /** Mark run failed, emit error event, close stream. */
  async function fail(message: string) {
    emit('error', { message })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({ status: 'failed', error_text: message })
      .eq('id', runId)
    close()
  }

  /** Abort if the user cancelled this run between pipeline stages. */
  async function checkCancelled(): Promise<boolean> {
    if (!isCancelled(runId)) return false
    clearCancellation(runId)
    emit('cancelled', { message: 'Search cancelled by user' })
    close()
    return true
  }

  try {
    let lastStage = ''

    const result = await runPipelineCore(config, userId, async (stage, data) => {
      // Check cancellation at every stage boundary
      if (await checkCancelled()) throw new Error('__cancelled__')
      lastStage = stage
      await progress(stage, data)
    })

    // Handle cancellation that fired during the last stage
    if (isCancelled(runId)) {
      clearCancellation(runId)
      emit('cancelled', { message: 'Search cancelled by user' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin as any)
        .from('search_runs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', runId)
      close()
      return
    }

    void lastStage // suppress unused warning

    // Mark run complete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .from('search_runs')
      .update({
        status:        'complete',
        completed_at:  new Date().toISOString(),
        jobs_found:    result.found,
        jobs_new:      result.inserted,
        jobs_enriched: result.enriched,
        jobs_scored:   result.scored,
      })
      .eq('id', runId)

    emit('complete', {
      stage:     'complete',
      progress:  100,
      found:     result.found,
      enriched:  result.enriched,
      unique:    result.unique,
      scored:    result.scored,
      jobsAdded: result.inserted,
      runId,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === '__cancelled__') {
      // Cancellation already handled inside the onProgress callback
      return
    }
    await fail(message)
    return
  }

  clearCancellation(runId)
  close()
}

// ── DELETE — cancel an in-flight run ─────────────────────────────────────────

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const runId = searchParams.get('runId')
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })

  cancelRun(runId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabaseAdmin as any)
    .from('search_runs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), error_text: 'Cancelled by user' })
    .eq('id', runId)
    .eq('user_id', session.user.id)
    .eq('status', 'running')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ── POST — same as GET but reads configId from JSON body ──────────────────────

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const configId = body?.configId
  if (!configId) return NextResponse.json({ error: 'configId is required' }, { status: 400 })

  const url = new URL(request.url)
  url.searchParams.set('configId', configId)
  return GET(new Request(url.toString(), { headers: request.headers }))
}
