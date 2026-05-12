// lib/apify/orchestrate.ts
// Parallel orchestration — fires all enabled Apify sources simultaneously,
// tolerates partial failures, and returns a single flat RawApifyJob[] array.

import type { SearchConfig, RawApifyJob } from '@/lib/types'
import { getEnabledSources }              from './sources'
import { runApifyActor }                  from './search'
import * as sources                       from './sources'
import type { WorkdayTenant }             from './sources'
import {
  buildAtsUrls, resolveAtsSlugs, resolveWorkdayTenants, getKnownCareerUrls,
  resolveGreenhouseSlugs,
} from './ats-resolver'

/**
 * Run all Apify sources enabled in the user's SearchConfig in parallel.
 *
 * Design:
 * - Calls getEnabledSources(config) to resolve the active source registry entries
 * - Each source's buildInput() constructs the actor-specific input object
 * - URL-targeted sources (greenhouse, workday, career_page, phd) receive
 *   pre-resolved targetUrls derived from config.career_page_urls + config.target_companies
 * - All actors fire concurrently via Promise.allSettled — one failure never kills the run
 * - Results are flattened into a single RawApifyJob[] before returning
 * - Each source is logged with its result count or failure reason
 *
 * @returns Flat array of all raw job objects across all sources that succeeded
 */
export async function orchestrateApify(config: SearchConfig): Promise<RawApifyJob[]> {
  const enabledSources = getEnabledSources(config)

  if (enabledSources.length === 0) {
    console.log('[apify/orchestrate] No Apify sources enabled — skipping')
    return []
  }

  const query     = config.keywords.join(' OR ')
  const keywords  = config.keywords
  const locations = config.locations ?? []

  // Workday's searchText is plain-text, not Boolean — a long "A OR B OR C" string
  // performs poorly. Use the single most specific keyword token instead (the first
  // keyword after stripping generic stop-words), then rely on the title-relevance
  // filter to drop off-topic results.
  const WORKDAY_STOP = new Set(['engineer','senior','staff','principal','lead','junior',
    'associate','manager','developer','architect','specialist','analyst','software','hardware'])
  function bestWorkdayToken(kws: string[]): string {
    for (const phrase of kws) {
      const tokens = phrase.toLowerCase().split(/[\s\-\/,]+/)
        .map(t => t.replace(/[^a-z0-9+#.]/g, ''))
        .filter(t => t.length >= 2 && !WORKDAY_STOP.has(t))
      if (tokens.length > 0) return tokens[0]
    }
    return kws[0] ?? ''
  }
  const workdayQuery = bestWorkdayToken(keywords)
  console.log(`[apify/orchestrate] Workday query: "${workdayQuery}" (from keywords: [${keywords.join(', ')}])`)

  // Pre-resolve URL-targeted source options once, shared across relevant sources
  console.log(`[apify/orchestrate] target_companies: ${JSON.stringify(config.target_companies)}`)
  console.log(`[apify/orchestrate] workday_disabled: ${JSON.stringify(config.workday_disabled)}`)
  const atsSlugs       = resolveAtsSlugs([], config.target_companies)
  const disabled       = new Set((config.workday_disabled ?? []).map(t => t.toLowerCase()))
  const workdayTenants = resolveWorkdayTenants([], config.target_companies)
    .filter(t => !disabled.has(t.tenant.toLowerCase()))
  console.log(`[apify/orchestrate] resolved workday tenants: ${JSON.stringify(workdayTenants)}`)
  const careerPageUrls = getKnownCareerUrls(config.target_companies)

  // Merge KNOWN_GREENHOUSE slugs into the greenhouse ATS slug list so that
  // companies like Waymo and Aurora (which use Greenhouse but not via slugified name)
  // are always included without needing an explicit career_page URL.
  const extraGreenhouseSlugs = resolveGreenhouseSlugs(config.target_companies)
  const allGreenhouseSlugs   = [...new Set([...atsSlugs.greenhouse, ...extraGreenhouseSlugs])]
  console.log(`[apify/orchestrate] greenhouse slugs: ${JSON.stringify(allGreenhouseSlugs)}`)

  // Build per-source options so each buildInput() gets the right targetUrls
  function optionsFor(sourceName: string) {
    switch (sourceName) {
      case 'greenhouse':
        return {
          targetUrls:      buildAtsUrls('greenhouse', allGreenhouseSlugs),
          targetCompanies: config.target_companies,
        }
      case 'lever':
        return { targetUrls: buildAtsUrls('lever', atsSlugs.lever) }
      case 'ashby':
        return { targetUrls: buildAtsUrls('ashby', atsSlugs.ashby) }
      case 'workday':
        return { targetUrls: workdayTenants.map(t =>
          `https://${t.tenant}.${t.dc}.myworkdayjobs.com/${t.site}`) }
      case 'career_page':
        return { targetUrls: careerPageUrls }
      case 'phd':
        return { targetUrls: [] }   // phd source falls back to its built-in defaults
      case 'linkedin':
        return { targetCompanies: config.target_companies }
      default:
        return {}
    }
  }

  // Fire all actor runs in parallel.
  // Workday uses shahidirfan/Workday-Job-Scraper (no proxy needed, handles CXS auth internally).
  // All tenant career page URLs are batched into a single actor run.
  const settled = await Promise.allSettled(
    enabledSources.map(source => {
      if (source.name === 'workday') {
        if (workdayTenants.length === 0) {
          console.log('[apify/orchestrate] Workday: no tenants resolved — add target companies or leave blank for all')
          return Promise.resolve({ source: source.label, items: [] as RawApifyJob[] })
        }
        console.log(`[apify/orchestrate] Workday: querying ${workdayTenants.length} tenant(s) via shahidirfan/Workday-Job-Scraper`)
        return runWorkdayBoards(workdayTenants, workdayQuery, 50)
          .then(items => ({ source: source.label, items }))
      }
      const input = source.buildInput(keywords, locations, optionsFor(source.name))
      return runApifyActor(source.actorId, input)
        .then(items => ({ source: source.label, items }))
    })
  )

  // Log results and flatten
  let totalJobs = 0
  const allJobs: RawApifyJob[] = []

  for (let i = 0; i < settled.length; i++) {
    const result     = settled[i]
    const sourceName = enabledSources[i].label

    if (result.status === 'fulfilled') {
      const { items } = result.value
      console.log(`[apify/orchestrate] ${sourceName} -> ${items.length} items`)
      allJobs.push(...items)
      totalJobs += items.length
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(`[apify/orchestrate] ${sourceName} FAILED: ${reason}`)
    }
  }

  console.log(`[apify/orchestrate] Total raw jobs collected: ${totalJobs}`)
  return allJobs
}

/**
 * Legacy entry point — returns a named map keyed by source for callers that
 * need per-source result counts (e.g. search run audit logging).
 * Delegates to orchestrateApify internally; kept for backward compat.
 */
export async function runFullSearch(config: SearchConfig): Promise<Record<string, RawApifyJob[]>> {
  const enabledSources = getEnabledSources(config)
  const query     = config.keywords.join(' OR ')
  const keywords  = config.keywords
  const locations = config.locations ?? []

  const atsSlugs       = resolveAtsSlugs([], config.target_companies)
  const _disabled      = new Set((config.workday_disabled ?? []).map(t => t.toLowerCase()))
  const workdayTenants = resolveWorkdayTenants([], config.target_companies)
    .filter(t => !_disabled.has(t.tenant.toLowerCase()))
  const careerPageUrls = getKnownCareerUrls(config.target_companies)

  function optionsFor(sourceName: string) {
    switch (sourceName) {
      case 'greenhouse':  return { targetUrls: buildAtsUrls('greenhouse', atsSlugs.greenhouse), targetCompanies: config.target_companies }
      case 'lever':       return { targetUrls: buildAtsUrls('lever', atsSlugs.lever) }
      case 'ashby':       return { targetUrls: buildAtsUrls('ashby', atsSlugs.ashby) }
      case 'workday':     return { targetUrls: workdayTenants.map(t => `https://${t.tenant}.${t.dc}.myworkdayjobs.com/${t.site}`) }
      case 'career_page': return { targetUrls: careerPageUrls }
      case 'linkedin':    return { targetCompanies: config.target_companies }
      default:            return {}
    }
  }

  const settled = await Promise.allSettled(
    enabledSources.map(source =>
      runApifyActor(source.actorId, source.buildInput(keywords, locations, optionsFor(source.name)))
    )
  )

  const out: Record<string, RawApifyJob[]> = {}
  for (let i = 0; i < settled.length; i++) {
    const name   = enabledSources[i].name
    const result = settled[i]
    if (result.status === 'fulfilled') {
      console.log(`[apify/orchestrate] ${name} -> ${result.value.length} items`)
      out[name] = result.value
    } else {
      console.warn(`[apify/orchestrate] ${name} FAILED:`, result.reason instanceof Error ? result.reason.message : result.reason)
      out[name] = []
    }
  }

  // Also include legacy ATS-specific fetchers for sources not in the Apify registry
  const legacyEnabled = new Set(config.sources)
  const legacySources: Array<[string, Promise<RawApifyJob[]>]> = []

  if (legacyEnabled.has('lever') && atsSlugs.lever.length)
    legacySources.push(['lever', runAtsBoards(atsSlugs.lever, sources.fetchLeverBoard)])
  if (legacyEnabled.has('ashby') && atsSlugs.ashby.length)
    legacySources.push(['ashby', runAtsBoards(atsSlugs.ashby, sources.fetchAshbyBoard)])
  if (legacyEnabled.has('smartrecruiters') && atsSlugs.smartrecruiters.length)
    legacySources.push(['smartrecruiters', runAtsBoards(atsSlugs.smartrecruiters, sources.fetchSmartRecruitersBoard)])
  if (legacyEnabled.has('workable') && atsSlugs.workable.length)
    legacySources.push(['workable', runAtsBoards(atsSlugs.workable, sources.fetchWorkableBoard)])
  if (legacyEnabled.has('recruitee') && atsSlugs.recruitee.length)
    legacySources.push(['recruitee', runAtsBoards(atsSlugs.recruitee, sources.fetchRecruiteeBoard)])
  if (legacyEnabled.has('teamtailor') && atsSlugs.teamtailor.length)
    legacySources.push(['teamtailor', runAtsBoards(atsSlugs.teamtailor, sources.fetchTeamtailorBoard)])
  if (legacyEnabled.has('personio') && atsSlugs.personio.length)
    legacySources.push(['personio', runAtsBoards(atsSlugs.personio, sources.fetchPersonioBoard)])
  if (legacyEnabled.has('hn_hiring'))
    legacySources.push(['hn_hiring', sources.fetchHNWhoIsHiring(config.keywords) as Promise<RawApifyJob[]>])
  if (legacyEnabled.has('clearancejobs'))
    legacySources.push(['clearancejobs', sources.scrapeClearanceJobs(query) as Promise<RawApifyJob[]>])
  if (legacyEnabled.has('yc_waas'))
    legacySources.push(['yc_waas', sources.scrapeYcWaas(query) as Promise<RawApifyJob[]>])

  if (legacySources.length) {
    const legacySettled = await Promise.allSettled(legacySources.map(([, p]) => p))
    for (let i = 0; i < legacySettled.length; i++) {
      const [name] = legacySources[i]
      const result = legacySettled[i]
      out[name] = result.status === 'fulfilled' ? result.value : []
    }
  }

  return out
}

/** Fan out fetcher across slugs in parallel; swallows individual failures. */
async function runAtsBoards(
  slugs:   string[],
  fetcher: (slug: string) => Promise<Record<string, unknown>[]>
): Promise<RawApifyJob[]> {
  if (slugs.length === 0) return []
  const settled = await Promise.allSettled(slugs.map(s => fetcher(s)))
  return settled.flatMap(r => r.status === 'fulfilled' ? (r.value as RawApifyJob[]) : [])
}

/**
 * Run all Workday tenants in a single shahidirfan/Workday-Job-Scraper actor call.
 * Maps the actor's output fields to our RawApifyJob schema.
 */
async function runWorkdayBoards(
  tenants: WorkdayTenant[],
  query:   string,
  limit:   number = 50,
): Promise<RawApifyJob[]> {
  if (tenants.length === 0) return []

  const startUrls = tenants.map(t => ({
    url: `https://${t.tenant}.${t.dc}.myworkdayjobs.com/${t.site}`,
  }))

  const raw = await runApifyActor('shahidirfan/Workday-Job-Scraper', {
    startUrls,
    results_wanted: limit * tenants.length,
    max_pages:      5,
    proxyConfiguration: { useApifyProxy: false },
  })

  // Map actor output fields → RawApifyJob (normalizer-compatible)
  return raw
    .filter((r: RawApifyJob) => r.type !== 'job_workday_blocked' && r.title)
    .map((r: RawApifyJob) => ({
      title:         r.title,
      company:       r.company ?? r.hiring_org ?? '',
      location:      r.locations ?? r.city ?? 'Unknown',
      url:           r.apply_url ?? r.job_url ?? '',
      description:   r.description_text ?? r.description_html ?? '',
      postedAt:      r.posted_at ?? null,
      source_job_id: r.requisition_id ?? r.external_path ?? null,
    }))
}
