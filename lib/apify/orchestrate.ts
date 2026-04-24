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
  type AtsSlugs,
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

  const query    = config.keywords.join(' OR ')
  const keywords = config.keywords
  const locations = config.locations ?? []

  // Pre-resolve URL-targeted source options once, shared across relevant sources
  const atsSlugs       = resolveAtsSlugs(config.career_page_urls ?? [], config.target_companies)
  const workdayTenants = resolveWorkdayTenants(config.career_page_urls ?? [], config.target_companies)
  const careerPageUrls = config.career_page_urls?.length
    ? config.career_page_urls
    : getKnownCareerUrls(config.target_companies)

  // Build per-source options so each buildInput() gets the right targetUrls
  function optionsFor(sourceName: string) {
    switch (sourceName) {
      case 'greenhouse':
        return {
          targetUrls:      buildAtsUrls('greenhouse', atsSlugs.greenhouse),
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

  // Fire all actor runs in parallel
  const settled = await Promise.allSettled(
    enabledSources.map(source => {
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
      console.log(`[apify/orchestrate] ${sourceName} → ${items.length} items`)
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
  const query    = config.keywords.join(' OR ')
  const keywords = config.keywords
  const locations = config.locations ?? []

  const atsSlugs       = resolveAtsSlugs(config.career_page_urls ?? [], config.target_companies)
  const workdayTenants = resolveWorkdayTenants(config.career_page_urls ?? [], config.target_companies)
  const careerPageUrls = config.career_page_urls?.length
    ? config.career_page_urls
    : getKnownCareerUrls(config.target_companies)

  function optionsFor(sourceName: string) {
    switch (sourceName) {
      case 'greenhouse': return { targetUrls: buildAtsUrls('greenhouse', atsSlugs.greenhouse), targetCompanies: config.target_companies }
      case 'lever':      return { targetUrls: buildAtsUrls('lever', atsSlugs.lever) }
      case 'ashby':      return { targetUrls: buildAtsUrls('ashby', atsSlugs.ashby) }
      case 'workday':    return { targetUrls: workdayTenants.map(t => `https://${t.tenant}.${t.dc}.myworkdayjobs.com/${t.site}`) }
      case 'career_page': return { targetUrls: careerPageUrls }
      case 'linkedin':   return { targetCompanies: config.target_companies }
      default: return {}
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
      console.log(`[apify/orchestrate] ${name} → ${result.value.length} items`)
      out[name] = result.value
    } else {
      console.warn(`[apify/orchestrate] ${name} FAILED:`, result.reason instanceof Error ? result.reason.message : result.reason)
      out[name] = []
    }
  }

  // Also include legacy ATS-specific fetchers for sources not in the Apify registry
  // (lever, ashby, smartrecruiters, workable, recruitee, teamtailor, personio use
  //  direct JSON APIs rather than Apify actors)
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

/** Fan out Workday fetches across tenants; each tenant is {tenant, dc, site}. */
async function runWorkdayBoards(
  tenants: WorkdayTenant[],
  query:   string
): Promise<RawApifyJob[]> {
  if (tenants.length === 0) return []
  const settled = await Promise.allSettled(tenants.map(t => sources.fetchWorkdayBoard(t, query)))
  return settled.flatMap(r => r.status === 'fulfilled' ? (r.value as RawApifyJob[]) : [])
}

