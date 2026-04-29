// app/api/company-intel/[name]/route.ts
// On-demand company intelligence: check cache -> 3x Apify queries -> Sonnet synthesis (2 layers)
//
// Layer 1 (company, cached 7 days, shared across all jobs from same company):
//   company_snapshot, strategic_direction, leadership_culture, hiring_signals, red_flags
//   Stored in: company_intel table
//
// Layer 2 (role, per-job, stored in jobs.role_company_intel):
//   walking_into, business_context, what_this_means, interview_narrative
//   Requires: company context + role_summary + canonical_title
//
// role_alignment (1-2 sentence hook) stays in jobs.role_alignment (written by Haiku).
//
// Apify queries fired in parallel:
//   1. strategy + revenue + roadmap + risks (feeds strategic direction, snapshot, red flags)
//   2. engineering culture + team + how we work (feeds leadership/culture, walking_into)
//   3. hiring patterns + team expansion + roles (feeds hiring signals)

import { NextResponse }    from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }     from '@/lib/auth'
import { supabaseAdmin }   from '@/lib/supabase'
import Anthropic           from '@anthropic-ai/sdk'
import { runApifyActor }   from '@/lib/apify/search'

const client = new Anthropic()

// -----------------------------------------------------------------------------
// Shared system prompts
// -----------------------------------------------------------------------------

const COMPANY_SYSTEM_PROMPT = `You are a senior business analyst writing a candidate briefing memo for a job seeker. Synthesize recent web search results into structured, actionable company intelligence.

Rules:
- Be factual and specific. Reference actual news items where possible.
- Never hallucinate financials, headcount, or product details.
- When information is absent, use null or empty array — never fill in with assumptions.
- Each signal must include a "sentiment" field: "positive", "caution", or "risk".
- Write in present tense. Be direct. No marketing language.
- Respond only with valid JSON matching the schema. No markdown fences, no preamble.`

const ROLE_SYSTEM_PROMPT = `You are a career advisor writing a targeted briefing for a candidate interviewing at a company. Given the company's strategic context and this specific role, produce four sections of actionable interview-prep intelligence.

Rules:
- Write in second person where natural ("You're walking into...", "This role sits at...").
- Be specific and opinionated — vague generalities are useless to a candidate.
- Each signal must include a "sentiment" field: "positive", "caution", or "risk".
- Keep each bullet to 1–2 sentences maximum.
- Respond only with valid JSON matching the schema. No markdown fences, no preamble.`

const ROLE_ALIGNMENT_SYSTEM_PROMPT = `You are a career advisor. Write 1–2 sentences explaining how a specific role connects to a company's current strategic direction. Second person ("This role..."). No restating the job title or company name.`

// -----------------------------------------------------------------------------
// Apify helpers — 3 parallel targeted queries
// -----------------------------------------------------------------------------

function formatResults(results: unknown[]): string {
  if (!results || results.length === 0) return 'No results found.'
  return results
    .slice(0, 4)
    .map((r, i) => {
      const rec  = r as Record<string, unknown>
      const meta = rec.metadata as Record<string, unknown> | undefined
      const title   = (meta?.title as string | undefined) ?? (rec.url as string | undefined) ?? `Result ${i + 1}`
      const content = (rec.markdown as string | undefined)?.slice(0, 500)?.replace(/\n+/g, ' ')
        ?? (meta?.description as string | undefined)
        ?? ''
      return `[${i + 1}] ${title}\n${content}`
    })
    .join('\n\n')
}

async function fetchCompanyIntelSources(companyName: string): Promise<{
  strategyNews:   string
  cultureNews:    string
  hiringNews:     string
}> {
  const [strategy, culture, hiring] = await Promise.allSettled([
    runApifyActor(
      'apify/rag-web-browser',
      { query: `${companyName} strategy revenue product roadmap risks 2025 2026`, maxResults: 4, outputFormats: ['markdown'] },
      50_000
    ),
    runApifyActor(
      'apify/rag-web-browser',
      { query: `${companyName} engineering culture team structure how we work employee review`, maxResults: 4, outputFormats: ['markdown'] },
      50_000
    ),
    runApifyActor(
      'apify/rag-web-browser',
      { query: `${companyName} hiring expansion team growth jobs 2025 2026`, maxResults: 4, outputFormats: ['markdown'] },
      50_000
    ),
  ])

  return {
    strategyNews: strategy.status === 'fulfilled' ? formatResults(strategy.value) : 'Unavailable.',
    cultureNews:  culture.status  === 'fulfilled' ? formatResults(culture.value)  : 'Unavailable.',
    hiringNews:   hiring.status   === 'fulfilled' ? formatResults(hiring.value)   : 'Unavailable.',
  }
}

// -----------------------------------------------------------------------------
// Interfaces
// -----------------------------------------------------------------------------

interface Signal {
  text:      string
  sentiment: 'positive' | 'caution' | 'risk'
}

interface CompanyIntelResult {
  company_snapshot:    {
    stage:        string | null
    headcount:    string | null
    revenue:      string | null
    core_business: string | null
    key_products: string | null
  }
  strategic_direction: Signal[]
  leadership_culture:  Signal[]
  hiring_signals:      Signal[]
  red_flags:           Signal[]
}

export interface RoleCompanyIntel {
  walking_into:       Signal[]
  business_context:   Signal[]
  what_this_means:    Signal[]
  interview_narrative: string
}

// -----------------------------------------------------------------------------
// Claude Sonnet — Layer 1: company-level intel
// -----------------------------------------------------------------------------

async function synthesizeCompanyIntel(
  companyName: string,
  strategyNews: string,
  cultureNews:  string,
  hiringNews:   string
): Promise<CompanyIntelResult> {
  const userPrompt = `Company: ${companyName}

=== Strategy / Revenue / Roadmap / Risks ===
${strategyNews}

=== Engineering Culture / Team Structure ===
${cultureNews}

=== Hiring / Team Expansion ===
${hiringNews}

Synthesize the above into this JSON object. Each signal array item must have "text" (1–2 sentence string) and "sentiment" ("positive", "caution", or "risk").

{
  "company_snapshot": {
    "stage": "e.g. Public · NYSE: NVDA",
    "headcount": "e.g. ~32,000 employees",
    "revenue": "e.g. $96B TTM, +122% YoY — or null if unknown",
    "core_business": "1 sentence describing what the company does",
    "key_products": "comma-separated list of flagship products/platforms"
  },
  "strategic_direction": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "leadership_culture": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "hiring_signals": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "red_flags": [
    { "text": "...", "sentiment": "risk" }
  ]
}

strategic_direction: up to 3 signals on where the company is heading.
leadership_culture: up to 3 signals on engineering culture, management style, team norms.
hiring_signals: up to 3 signals on hiring momentum or role patterns.
red_flags: up to 3 signals on layoffs, exits, regulatory issues, competitive threats. Empty array if none.`

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1500,
    system: [
      {
        type:          'text',
        text:          COMPANY_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as CompanyIntelResult
  } catch {
    return {
      company_snapshot:    { stage: null, headcount: null, revenue: null, core_business: companyName, key_products: null },
      strategic_direction: [],
      leadership_culture:  [],
      hiring_signals:      [],
      red_flags:           [],
    }
  }
}

// -----------------------------------------------------------------------------
// Claude Sonnet — Layer 2: role-level intel
// -----------------------------------------------------------------------------

async function synthesizeRoleIntel(
  jobTitle:     string,
  roleSummary:  string | null,
  companyIntel: CompanyIntelResult
): Promise<RoleCompanyIntel> {
  const userPrompt = `Role: ${jobTitle}
Role summary: ${roleSummary ?? '(not available)'}

Company context:
- Core business: ${companyIntel.company_snapshot.core_business ?? ''}
- Strategic direction: ${companyIntel.strategic_direction.map(s => s.text).join(' | ')}
- Culture signals: ${companyIntel.leadership_culture.map(s => s.text).join(' | ')}
- Hiring signals: ${companyIntel.hiring_signals.map(s => s.text).join(' | ')}
- Red flags: ${companyIntel.red_flags.map(s => s.text).join(' | ') || 'None identified'}

Produce the following JSON for a candidate preparing to interview for this specific role:

{
  "walking_into": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "business_context": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "what_this_means": [
    { "text": "...", "sentiment": "positive|caution|risk" }
  ],
  "interview_narrative": "2–3 sentence paragraph. What angle should the candidate take in their interviews? What story connects their background to this company's current priorities? Be specific and direct."
}

walking_into: up to 3 signals about the immediate team environment, delivery pressure, org dynamics — things the candidate needs to know before day 1.
business_context: up to 2 signals explaining why this specific role matters to the company's current strategy or revenue.
what_this_means: up to 3 signals with a personal read for the candidate — career upside, comp considerations, risk/reward.
interview_narrative: the recommended interview angle in 2–3 sentences.`

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 800,
    system: [
      {
        type:          'text',
        text:          ROLE_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      } as Anthropic.TextBlockParam & { cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as RoleCompanyIntel
  } catch {
    return {
      walking_into:        [],
      business_context:    [],
      what_this_means:     [],
      interview_narrative: '',
    }
  }
}

// -----------------------------------------------------------------------------
// Claude Haiku — role alignment (1-2 sentence hook, existing behaviour)
// -----------------------------------------------------------------------------

async function computeRoleAlignment(
  jobTitle:           string,
  roleSummary:        string | null,
  strategicDirection: string
): Promise<string> {
  if (!strategicDirection) return ''

  const userPrompt = `Role title: ${jobTitle}
Role summary: ${roleSummary ?? '(not available)'}
Company strategic direction: ${strategicDirection}

Write 1-2 sentences explaining how this specific role connects to or enables the company's current strategic direction.`

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

// -----------------------------------------------------------------------------
// Route handler
// -----------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name } = await params
  const companyName = decodeURIComponent(name)
  if (!companyName) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
  }

  const body  = await request.json().catch(() => ({}))
  const jobId: string | null = body.jobId ?? null

  // 1. Check company-layer cache (7-day TTL)
  const { data: cached } = await supabaseAdmin
    .from('company_intel')
    .select('*')
    .eq('company_name', companyName)
    .gt('expires_at', new Date().toISOString())
    .single()

  let intel = cached
  let companyResult: CompanyIntelResult | null = null

  if (!intel) {
    // 2. Fetch from 3 parallel Apify queries
    const { strategyNews, cultureNews, hiringNews } = await fetchCompanyIntelSources(companyName)
    companyResult = await synthesizeCompanyIntel(companyName, strategyNews, cultureNews, hiringNews)

    const now       = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const { data: upserted, error } = await supabaseAdmin
      .from('company_intel')
      .upsert(
        {
          company_name:        companyName,
          summary:             companyResult.company_snapshot.core_business ?? companyName,
          recent_news:         [],
          strategic_direction: companyResult.strategic_direction.map(s => s.text).join(' '),
          hiring_signals:      JSON.stringify(companyResult.hiring_signals),
          red_flags:           JSON.stringify(companyResult.red_flags),
          company_snapshot:    companyResult.company_snapshot,
          strategic_signals:   companyResult.strategic_direction,
          leadership_culture:  companyResult.leadership_culture,
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
  } else {
    // Reconstruct companyResult from cached row for role synthesis
    companyResult = {
      company_snapshot:    intel.company_snapshot ?? { stage: null, headcount: null, revenue: null, core_business: companyName, key_products: null },
      strategic_direction: intel.strategic_signals ?? [],
      leadership_culture:  intel.leadership_culture ?? [],
      hiring_signals:      typeof intel.hiring_signals === 'string'
        ? tryParseSignals(intel.hiring_signals)
        : (intel.hiring_signals ?? []),
      red_flags:           typeof intel.red_flags === 'string'
        ? tryParseSignals(intel.red_flags)
        : (intel.red_flags ?? []),
    }
  }

  // 3. Role-layer intel (per-job)
  if (jobId) {
    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('canonical_title, role_summary, role_alignment, role_company_intel')
      .eq('id', jobId)
      .single()

    if (job) {
      // Role alignment (Haiku)
      if (!job.role_alignment) {
        const strategicText = companyResult.strategic_direction.map((s: Signal) => s.text).join('. ')
        const alignment = await computeRoleAlignment(job.canonical_title, job.role_summary, strategicText)
        if (alignment) {
          await supabaseAdmin.from('jobs').update({ role_alignment: alignment }).eq('id', jobId)
          intel = { ...intel, role_alignment: alignment }
        }
      } else {
        intel = { ...intel, role_alignment: job.role_alignment }
      }

      // Role intel (Sonnet)
      if (!job.role_company_intel && companyResult) {
        const roleIntel = await synthesizeRoleIntel(
          job.canonical_title,
          job.role_summary,
          companyResult
        )
        await supabaseAdmin
          .from('jobs')
          .update({ role_company_intel: roleIntel })
          .eq('id', jobId)
        intel = { ...intel, role_company_intel: roleIntel }
      } else if (job.role_company_intel) {
        intel = { ...intel, role_company_intel: job.role_company_intel }
      }
    }
  }

  return NextResponse.json({ intel })
}

function tryParseSignals(v: string): Signal[] {
  try { return JSON.parse(v) as Signal[] } catch { return [] }
}
