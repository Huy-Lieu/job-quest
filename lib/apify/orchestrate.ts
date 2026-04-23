// lib/apify/orchestrate.ts
// Parallel orchestration — fires all enabled Apify sources simultaneously,
// tolerates partial failures, and returns a single flat RawApifyJob[] array.

import type { SearchConfig, RawApifyJob } from '@/lib/types'
import { getEnabledSources }              from './sources'
import { runApifyActor }                  from './search'
import * as sources                       from './sources'
import type { WorkdayTenant }             from './sources'

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

/** Build direct ATS board URLs from slugs for use as rag-web-browser startUrls. */
function buildAtsUrls(ats: string, slugs: string[]): string[] {
  return slugs.map(slug => {
    switch (ats) {
      case 'greenhouse': return `https://boards.greenhouse.io/${slug}`
      case 'lever':      return `https://jobs.lever.co/${slug}`
      case 'ashby':      return `https://jobs.ashbyhq.com/${slug}`
      default:           return slug
    }
  })
}

interface AtsSlugs {
  greenhouse:      string[]
  lever:           string[]
  ashby:           string[]
  smartrecruiters: string[]
  workable:        string[]
  recruitee:       string[]
  teamtailor:      string[]
  personio:        string[]
}

/**
 * Extract ATS slugs from career_page_urls when they match a known ATS host,
 * otherwise fall back to slugifying target_companies (lowercased, hyphenated)
 * and letting each ATS endpoint 404 gracefully if the company isn't on it.
 */
function resolveAtsSlugs(careerUrls: string[], targetCompanies: string[]): AtsSlugs {
  const slugs: AtsSlugs = {
    greenhouse:      [],
    lever:           [],
    ashby:           [],
    smartrecruiters: [],
    workable:        [],
    recruitee:       [],
    teamtailor:      [],
    personio:        [],
  }

  const sets = {
    greenhouse:      new Set<string>(),
    lever:           new Set<string>(),
    ashby:           new Set<string>(),
    smartrecruiters: new Set<string>(),
    workable:        new Set<string>(),
    recruitee:       new Set<string>(),
    teamtailor:      new Set<string>(),
    personio:        new Set<string>(),
  }

  for (const url of careerUrls) {
    const gh = url.match(/boards(?:-api)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([^/?&#]+)/)?.[1]
    if (gh) sets.greenhouse.add(gh)
    const lv = url.match(/jobs\.lever\.co\/([^/?#]+)/)?.[1]
    if (lv) sets.lever.add(lv)
    const ab = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/)?.[1]
    if (ab) sets.ashby.add(ab)
    const sr = url.match(/(?:careers|jobs)\.smartrecruiters\.com\/([^/?#]+)/)?.[1]
    if (sr) sets.smartrecruiters.add(sr)
    const wk = url.match(/apply\.workable\.com\/([^/?#]+)/)?.[1]
    if (wk) sets.workable.add(wk)
    const rc = url.match(/([^./]+)\.recruitee\.com/)?.[1]
    if (rc) sets.recruitee.add(rc)
    const tt = url.match(/([^./]+)\.teamtailor\.com/)?.[1]
    if (tt) sets.teamtailor.add(tt)
    const pn = url.match(/([^./]+)\.jobs\.personio\.(?:de|com)/)?.[1]
    if (pn) sets.personio.add(pn)
  }

  const slugified = targetCompanies
    .map((c) => c.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)

  for (const s of slugified) {
    sets.greenhouse.add(s)
    sets.lever.add(s)
    sets.ashby.add(s)
    sets.smartrecruiters.add(s)
    sets.workable.add(s)
    sets.recruitee.add(s)
    sets.teamtailor.add(s)
    sets.personio.add(s)
  }

  for (const k of Object.keys(sets) as Array<keyof AtsSlugs>) {
    slugs[k] = [...sets[k]]
  }
  return slugs
}

/** Known Workday tenants for common target companies (used when career_page_urls don't supply one). */
const KNOWN_WORKDAY: Record<string, WorkdayTenant> = {
  qualcomm:              { tenant: 'qualcomm',              dc: 'wd5', site: 'External' },
  intel:                 { tenant: 'intel',                 dc: 'wd1', site: 'External' },
  synopsys:              { tenant: 'synopsys',              dc: 'wd1', site: 'Synopsys_Careers' },
  infineon:              { tenant: 'infineon',              dc: 'wd3', site: 'Infineon' },
  stmicroelectronics:    { tenant: 'stmicroelectronics',    dc: 'wd3', site: 'STMicroelectronics_Careers' },
  nxp:                   { tenant: 'nxp',                   dc: 'wd1', site: 'nxp_External_Careers' },
  broadcom:              { tenant: 'broadcom',              dc: 'wd1', site: 'External_Career_Site' },
  leidos:                { tenant: 'leidos',                dc: 'wd5', site: 'External' },
}

function resolveWorkdayTenants(careerUrls: string[], targetCompanies: string[]): WorkdayTenant[] {
  const out = new Map<string, WorkdayTenant>()

  for (const url of careerUrls) {
    const m = url.match(/https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:en-US\/|wday\/cxs\/[^/]+\/)?([^/?#]+)/i)
    if (m) {
      const [, tenant, dc, site] = m
      out.set(tenant + '/' + site, { tenant, dc, site })
    }
  }

  for (const c of targetCompanies) {
    const key   = c.toLowerCase().trim().replace(/\s+/g, '')
    const known = KNOWN_WORKDAY[key]
    if (known) out.set(known.tenant + '/' + known.site, known)
  }

  return [...out.values()]
}

/** Map known company names to career page base URLs */
function getKnownCareerUrls(companies: string[]): string[] {
  const knownUrls: Record<string, string> = {
    nvidia:              'https://www.nvidia.com/en-us/about-nvidia/careers/',
    qualcomm:            'https://www.qualcomm.com/company/careers',
    intel:               'https://www.intel.com/content/www/us/en/jobs/jobs-at-intel.html',
    amd:                 'https://www.amd.com/en/corporate/careers',
    broadcom:            'https://www.broadcom.com/company/careers',
    'applied intuition': 'https://www.appliedintuition.com/careers',
    aurora:              'https://aurora.tech/careers',
    waymo:               'https://waymo.com/careers/',
  }
  return companies
    .map(c => knownUrls[c.toLowerCase()])
    .filter(Boolean) as string[]
}
