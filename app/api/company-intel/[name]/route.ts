// app/api/company-intel/[name]/route.ts
// On-demand company intelligence: check cache → Apify RAG fetch → Claude Sonnet synthesis
// Also writes role_alignment to jobs.role_alignment for the requesting job (if jobId provided).

import { NextResponse }    from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }     from '@/lib/auth'
import { supabaseAdmin }   from '@/lib/supabase'
import Anthropic           from '@anthropic-ai/sdk'
import { runApifyActor }   from '@/lib/apify/search'

const client = new Anthropic()

// ─────────────────────────────────────────────────────────────────────────────
// Claude prompts
// ─────────────────────────────────────────────────────────────────────────────

const INTEL_SYSTEM_PROMPT = `You are a senior business analyst specializing in technology companies. You synthesize recent news and public signals into concise, candidate-relevant intelligence.

Your output is used by job seekers to decide whether a company is a good fit and to prepare for interviews. Be factual and specific — never hallucinate financials, headcount, or product details. When information is absent or unclear, say so rather than filling in with assumptions.

Respond only with valid JSON matching the schema provided. No markdown fences, no preamble.`

const ROLE_ALIGNMENT_SYSTEM_PROMPT = `You are a career advisor helping a candidate understand how a specific role connects to a company's current strategic direction. Write in second person ("This role..."). Be concise and specific — 1–2 sentences maximum. Do not restate the job title or company name in the output.`

// ─────────────────────────────────────────────────────────────────────────────
// Apify RAG helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCompanyNews(companyName: string): Promise<string> {
  try {
    const query = `${companyName} company news strategy hiring 2024 2025`
    const results = await runApifyActor(
      'apify/rag-web-browser',
      { query, maxResults: 6, outputFormats: ['markdown'] },
      50_000
    )

    if (!results || results.length === 0) return 'No recent news found.'

    return results
      .slice(0, 6)
      .map((r: Record<string, unknown>, i: number) => {
        const meta    = r.metadata as Record<string, unknown> | undefined
        const title   = (meta?.title as string | undefined) ?? (r.url as string | undefined) ?? `Result ${i + 1}`
        const content = (r.markdown as string | undefined)?.slice(0, 600)?.replace(/\n+/g, ' ')
          ?? (meta?.description as string | undefined)
          ?? ''
        return `[${i + 1}] ${title}\n${content}`
      })
      .join('\n\n')
  } catch {
    return 'Company search unavailable — Apify actor timed out or failed.'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Sonnet — synthesize raw news into structured intel
// ─────────────────────────────────────────────────────────────────────────────

interface CompanyIntelResult {
  summary:            string
  recent_news:        string[]
  strategic_direction: string
  hiring_signals:     string[]
  red_flags:          string[]
}

async function synthesizeIntel(
  companyName: string,
  rawNews: string
): Promise<CompanyIntelResult> {
  const userPrompt = `Company: ${companyName}

Recent web search results:
${rawNews}

Extract and synthesize the above into the following JSON object. Be specific and evidence-based — reference actual news items where possible.

{
  "summary": "2–3 sentence company overview: what they do, current stage/scale, and one notable recent development",
  "recent_news": ["Up to 4 bullet strings summarizing notable recent events (funding, product launches, layoffs, acquisitions, leadership changes, etc.)"],
  "strategic_direction": "1–2 sentences on where the company is heading — growth areas, key bets, or stated priorities",
  "hiring_signals": ["Up to 3 bullet strings on hiring momentum or patterns visible from the news (e.g. 'Expanding ML team after Series C', 'Opening APAC offices Q1 2025')"],
  "red_flags": ["Up to 3 bullet strings on any concerning signals (layoffs, leadership exits, slowing growth, regulatory issues). Empty array if none found."]
}`

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [
      {
        type:          'text',
        text:          INTEL_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '{}'

  try {
    return JSON.parse(raw) as CompanyIntelResult
  } catch {
    // Fallback if parse fails
    return {
      summary:             `${companyName} — intel synthesis failed. Raw data unavailable.`,
      recent_news:         [],
      strategic_direction: '',
      hiring_signals:      [],
      red_flags:           [],
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Haiku — role alignment (per-job, written to jobs.role_alignment)
// ─────────────────────────────────────────────────────────────────────────────

async function computeRoleAlignment(
  jobTitle:           string,
  roleSummary:        string | null,
  strategicDirection: string
): Promise<string> {
  if (!strategicDirection) return ''

  const userPrompt = `Role title: ${jobTitle}
Role summary: ${roleSummary ?? '(not available)'}
Company strategic direction: ${strategicDirection}

Write 1–2 sentences explaining how this specific role connects to or enables the company's current strategic direction.`

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: [
        {
          type:          'text',
          text:          ROLE_ALIGNMENT_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })
    return response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  } catch {
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: { name: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyName = decodeURIComponent(params.name)
  if (!companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  // Optional jobId — if provided, we'll also write role_alignment to that job row
  const body = await request.json().catch(() => ({}))
  const jobId: string | null = body.jobId ?? null

  // ── 1. Check cache (7-day TTL) ────────────────────────────────────────────
  const { data: cached } = await supabaseAdmin
    .from('company_intel')
    .select('*')
    .eq('company_name', companyName)
    .gt('expires_at', new Date().toISOString())
    .single()

  let intel = cached

  if (!intel) {
    // ── 2. Fetch fresh data via Apify + synthesize with Claude Sonnet ────────
    const rawNews    = await fetchCompanyNews(companyName)
    const structured = await synthesizeIntel(companyName, rawNews)

    const now       = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const { data: upserted, error } = await supabaseAdmin
      .from('company_intel')
      .upsert(
        {
          company_name:        companyName,
          summary:             structured.summary,
          recent_news:         structured.recent_news,
          strategic_direction: structured.strategic_direction,
          hiring_signals:      structured.hiring_signals,
          red_flags:           structured.red_flags,
          raw_data:            rawNews,
          fetched_at:          now.toISOString(),
          expires_at:          expiresAt.toISOString(),
        },
        { onConflict: 'company_name' }
      )
      .select()
      .single()

    if (error) {
      console.error('[company-intel] Upsert error:', error)
      return NextResponse.json({ error: 'Failed to store intel' }, { status: 500 })
    }

    intel = upserted
  }

  // ── 3. Compute & store role_alignment for this specific job ──────────────
  if (jobId && intel?.strategic_direction) {
    // Load the job to get title + role_summary
    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('canonical_title, role_summary, role_alignment')
      .eq('id', jobId)
      .single()

    // Only recompute if not already set
    if (job && !job.role_alignment) {
      const alignment = await computeRoleAlignment(
        job.canonical_title,
        job.role_summary,
        intel.strategic_direction
      )
      if (alignment) {
        await supabaseAdmin
          .from('jobs')
          .update({ role_alignment: alignment })
          .eq('id', jobId)

        // Attach to response so the UI can render it immediately
        intel = { ...intel, role_alignment: alignment }
      }
    } else if (job?.role_alignment) {
      intel = { ...intel, role_alignment: job.role_alignment }
    }
  }

  return NextResponse.json({ intel })
}
