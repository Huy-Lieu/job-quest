import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { runApifyActor } from '@/lib/apify/search'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function callClaude(prompt: string, maxTokens = 2048): Promise<string> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  })
  return (msg.content[0] as { type: string; text: string }).text
}

/**
 * Company research via Apify RAG Web Browser — replaces SerpAPI.
 * Returns up to 5 result snippets formatted the same way the old serpSearch did.
 */
async function apifySearch(query: string): Promise<string> {
  try {
    const results = await runApifyActor(
      'apify/rag-web-browser',
      { query, maxResults: 5, outputFormats: ['markdown'] },
      45_000 // 45-second timeout — company research is best-effort
    )

    if (!results || results.length === 0) return 'No recent news found.'

    return results
      .slice(0, 5)
      .map((r: Record<string, unknown>, i: number) => {
        const meta    = r.metadata as Record<string, unknown> | undefined
        const title   = (meta?.title as string | undefined) ?? (r.url as string | undefined) ?? `Result ${i + 1}`
        const snippet = (meta?.description as string | undefined)
          ?? (r.markdown as string | undefined)?.slice(0, 300)?.replace(/\n+/g, ' ')
          ?? ''
        return `[${i + 1}] ${title}\n${snippet}`
      })
      .join('\n\n')
  } catch {
    // Company research is optional — don't let a search failure abort the full analysis
    return 'Company search unavailable — Apify actor timed out or failed.'
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { masterId, jobDescription, jobId, runCompanySearch, companySearchQuery } = body

  if (!masterId || !jobDescription) {
    return NextResponse.json({ error: 'masterId and jobDescription are required' }, { status: 400 })
  }

  const { data: master, error: masterError } = await supabaseAdmin
    .from('resume_versions')
    .select('content, variant_name')
    .eq('id', masterId)
    .eq('user_id', session.user.id)
    .single()

  if (masterError || !master?.content) {
    return NextResponse.json({ error: 'Master resume not found' }, { status: 404 })
  }

  // - Layer 1: Job Analysis -
  const jobAnalysis = await callClaude(`
You are a job application expert. Analyze this job description thoroughly.

JOB DESCRIPTION:
${jobDescription}

Provide a structured analysis with these sections:
1. **Role Summary** — What this role actually does day-to-day
2. **Required Skills** — Hard requirements (must-haves)
3. **Nice-to-Have Skills** — Preferred but not required
4. **ATS Keywords** — Key terms to include in a resume
5. **Seniority & Culture Signals** — What level they are hiring, what the team culture is like
6. **Red Flags / Watch-outs** — Anything unusual or concerning in the JD

Be concise but thorough. Use markdown formatting.
`, 1500)

  // - Layer 2: Company Intel (optional) -
  let companyIntel: string | null = null
  if (runCompanySearch && companySearchQuery) {
    const searchResults = await apifySearch(companySearchQuery)
    companyIntel = await callClaude(`
You are a company research analyst. Based on these recent news snippets, summarize what is happening at this company.

SEARCH QUERY: "${companySearchQuery}"

SEARCH RESULTS:
${searchResults}

Provide a structured briefing with:
1. **Recent Developments** — Key news, launches, funding, changes
2. **Hiring Signals** — Is this company growing, stable, or contracting?
3. **Culture & Values** — What can you infer about the team/culture?
4. **Talking Points** — 2-3 things to mention in an interview to show research

If the results are thin or irrelevant, say so honestly. Use markdown formatting.
`, 1200)
  }

  // - Layer 3: Gap Analysis + ATS Score -
  const gapAnalysisRaw = await callClaude(`
You are a resume expert. Compare this resume against the job description.

MASTER RESUME:
${master.content}

JOB ANALYSIS:
${jobAnalysis}

ORIGINAL JOB DESCRIPTION:
${jobDescription}

Provide:
1. **ATS Score** — Rate match from 0-100 on its own line exactly like: ATS_SCORE: 72
2. **Strong Matches** — Skills/experience that align well
3. **Gaps** — What is missing or weak relative to this role
4. **Quick Wins** — Small rewording changes that would help immediately
5. **Structural Suggestions** — Should anything be reordered or cut?

Use markdown formatting.
`, 1500)

  const scoreMatch = gapAnalysisRaw.match(/ATS_SCORE:\s*(\d+)/)
  const atsScore = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1]))) : 50
  const gapAnalysis = gapAnalysisRaw.replace(/ATS_SCORE:\s*\d+\n?/, '').trim()

  // - Layer 4: Tailored Resume × 2 (parallel) -
  const [tailoredConservative, tailoredAggressive] = await Promise.all([
    callClaude(`
You are a professional resume writer. Rewrite this resume to better match the job — CONSERVATIVE mode.

Rules:
- Keep everything factually accurate — only reword, reorder, or re-emphasize
- Do NOT add skills or experiences that are not already in the original
- Optimize for ATS keywords from the job description
- Lead with the most relevant experience for this role
- Use strong action verbs

MASTER RESUME:
${master.content}

JOB DESCRIPTION:
${jobDescription}

Output the full tailored resume text ready to copy-paste. No preamble or commentary.
`, 4096),
    callClaude(`
You are a professional resume writer. Rewrite this resume to better match the job — AGGRESSIVE mode.

Rules:
- Expand on adjacent skills (if they used similar tools, mention the target tool)
- Infer and highlight transferable skills that are implied but not explicitly stated
- Add context and detail to make experiences sound more relevant
- Be bold but not dishonest — stretch the framing, not the facts
- Optimize heavily for ATS keywords

MASTER RESUME:
${master.content}

JOB DESCRIPTION:
${jobDescription}

Output the full tailored resume text ready to copy-paste. No preamble or commentary.
`, 4096),
  ])

  // - Layer 5: Prep Briefing -
  const prepBriefing = await callClaude(`
You are an interview coach. Prepare a briefing document for this interview.

JOB DESCRIPTION:
${jobDescription}

${companyIntel ? `COMPANY INTEL:\n${companyIntel}` : ''}

CANDIDATE RESUME:
${master.content}

Provide:
1. **Likely Interview Questions** — 8-10 questions they will probably ask, with suggested answer frameworks
2. **Stories to Prepare** — 3-4 STAR-format story prompts based on resume gaps vs job requirements
3. **Questions to Ask Them** — 5 smart questions that show research and genuine interest
4. **Company Talking Points** — What to reference to show you have done your homework
5. **Salary Negotiation Notes** — Any signals from the JD about comp range or leverage

Use markdown formatting.
`, 3000)

  // - Layer 6: Cover Letter -
  const coverLetter = await callClaude(`
You are a professional cover letter writer. Write a compelling cover letter for this application.

JOB DESCRIPTION:
${jobDescription}

${companyIntel ? `RECENT COMPANY NEWS (use 1-2 specific details to show research):\n${companyIntel}` : ''}

CANDIDATE RESUME:
${master.content}

Write a 3-paragraph cover letter:
- Para 1: Hook — why this company and role specifically (reference something real/recent if possible)
- Para 2: Value — 2-3 specific experiences from the resume that directly address their needs
- Para 3: Close — enthusiasm, call to action, next steps

Tone: confident, specific, not generic. Avoid cliches like "I am excited to apply" or "I would be a great fit."
Output just the cover letter text, no extra commentary.
`, 1200)

  // - Persist full analysis as JSON so all tabs survive page refresh -
  const analysisJson = JSON.stringify({
    jobAnalysis,
    companyIntel,
    gapAnalysis,
    atsScore,
    tailoredConservative,
    tailoredAggressive,
    prepBriefing,
    coverLetter,
  })

  const { data: saved, error: saveError } = await supabaseAdmin
    .from('resume_versions')
    .insert({
      user_id: session.user.id,
      job_id: jobId ?? null,
      type: 'customized',
      variant_name: `Customized — ${new Date().toLocaleDateString()}`,
      content: analysisJson,
      ats_score: atsScore,
    })
    .select()
    .single()

  if (saveError) {
    console.error('Failed to save resume version:', saveError)
  }

  return NextResponse.json({
    id: saved?.id ?? null,
    jobAnalysis,
    companyIntel,
    gapAnalysis,
    atsScore,
    tailoredConservative,
    tailoredAggressive,
    prepBriefing,
    coverLetter,
  })
}
