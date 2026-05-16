// lib/apify/orchestrate.ts
// Parallel orchestration — fires all enabled Apify sources simultaneously,
// tolerates partial failures, and returns a single flat RawApifyJob[] array.

import type { SearchConfig, RawApifyJob } from '@/lib/types'
import { getEnabledSources }              from './sources'
import { runApifyActorWithError }          from './search'
import { fetchWorkdayBoard, fetchOracleBoard } from './ats-boards'
import type { WorkdayTenant, OracleTenant }   from './ats-boards'
import {
  buildAtsUrls, resolveAtsSlugs, resolveWorkdayTenants, resolveOracleTenants, getKnownCareerUrls,
} from './ats-resolver'

export interface OrchestrateResult {
  jobs:         RawApifyJob[]
  sourceErrors: Record<string, string>
}

export async function orchestrateApify(
  config:              SearchConfig,
  userWorkdayEntries?: Record<string, WorkdayTenant>,
): Promise<OrchestrateResult> {
  const enabledSources = getEnabledSources(config)

  if (enabledSources.length === 0) {
    console.log('[apify/orchestrate] No Apify sources enabled — skipping')
    return { jobs: [], sourceErrors: {} }
  }

  const keywords  = config.keywords
  const locations = config.locations ?? []

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
  const workdayQuery = bestWorkdayToken(keywords) || keywords[0] || ''
  console.log(`[apify/orchestrate] Workday query: "${workdayQuery}"`)

  console.log(`[apify/orchestrate] target_companies: ${JSON.stringify(config.target_companies)}`)
  console.log(`[apify/orchestrate] workday_disabled: ${JSON.stringify(config.workday_disabled)}`)
  const atsSlugs       = resolveAtsSlugs([], config.target_companies)
  const disabled       = new Set((config.workday_disabled ?? []).map(t => t.toLowerCase()))
  const workdayTenants = resolveWorkdayTenants([], config.target_companies, userWorkdayEntries)
    .filter(t => !disabled.has(t.tenant.toLowerCase()))
  console.log(`[apify/orchestrate] resolved workday tenants: ${JSON.stringify(workdayTenants)}`)
  const careerPageUrls  = getKnownCareerUrls(config.target_companies)
  const oracleTenants   = resolveOracleTenants(config.target_companies)
  console.log(`[apify/orchestrate] resolved oracle tenants: ${JSON.stringify(oracleTenants)}`)

  const allGreenhouseSlugs = atsSlugs.greenhouse
  console.log(`[apify/orchestrate] greenhouse slugs: ${JSON.stringify(allGreenhouseSlugs)}`)

  function optionsFor(sourceName: string) {
    switch (sourceName) {
      case 'greenhouse':
        return { targetUrls: buildAtsUrls('greenhouse', allGreenhouseSlugs), targetCompanies: config.target_companies }
      case 'lever':
        return { targetUrls: buildAtsUrls('lever', atsSlugs.lever) }
      case 'ashby':
        return { targetUrls: buildAtsUrls('ashby', atsSlugs.ashby) }
      case 'workday':
        return {}
      case 'career_page':
        return { targetUrls: careerPageUrls }
      case 'phd':
        return { targetUrls: [] }
      case 'linkedin':
        return { targetCompanies: config.target_companies }
      default:
        return {}
    }
  }

  const settled = await Promise.allSettled(
    enabledSources.map(source => {
      if (source.name === 'workday') {
        if (workdayTenants.length === 0) {
          console.log('[apify/orchestrate] Workday: no tenants resolved')
          return Promise.resolve({ source: source.label, items: [] as RawApifyJob[], error: null })
        }
        console.log(`[apify/orchestrate] Workday: querying ${workdayTenants.length} tenant(s) via CXS API`)
        return Promise.allSettled(
          workdayTenants.map(t => fetchWorkdayBoard(t, workdayQuery, 50))
        ).then(results => {
          const items: RawApifyJob[] = []
          const tenantErrors: string[] = []
          for (const r of results) {
            if (r.status === 'fulfilled') items.push(...r.value as RawApifyJob[])
            else tenantErrors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
          }
          const error = tenantErrors.length > 0 ? tenantErrors.join('; ') : null
          return { source: source.label, items, error }
        })
      }
      if (source.name === 'oracle') {
        if (oracleTenants.length === 0) {
          console.log('[apify/orchestrate] Oracle: no tenants resolved')
          return Promise.resolve({ source: source.label, items: [] as RawApifyJob[], error: null })
        }
        console.log(`[apify/orchestrate] Oracle: querying ${oracleTenants.length} tenant(s)`)
        return Promise.allSettled(
          oracleTenants.map((t: OracleTenant) => fetchOracleBoard(t, workdayQuery, 50))
        ).then((results: PromiseSettledResult<Record<string, unknown>[]>[]) => {
          const items: RawApifyJob[] = []
          const tenantErrors: string[] = []
          for (const r of results) {
            if (r.status === 'fulfilled') items.push(...r.value as RawApifyJob[])
            else tenantErrors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
          }
          const error = tenantErrors.length > 0 ? tenantErrors.join('; ') : null
          return { source: source.label, items, error }
        })
      }
      const input = source.buildInput(keywords, locations, optionsFor(source.name))
      return runApifyActorWithError(source.actorId, input)
        .then(({ jobs, error }) => ({ source: source.label, items: jobs, error }))
    })
  )

  let totalJobs = 0
  const allJobs: RawApifyJob[]               = []
  const sourceErrors: Record<string, string> = {}

  for (let i = 0; i < settled.length; i++) {
    const result     = settled[i]
    const sourceName = enabledSources[i].label

    if (result.status === 'fulfilled') {
      const { items, error } = result.value
      console.log(`[apify/orchestrate] ${sourceName} -> ${items.length} items`)
      allJobs.push(...items)
      totalJobs += items.length
      if (error) {
        console.warn(`[apify/orchestrate] ${sourceName} partial error: ${error}`)
        sourceErrors[sourceName] = error
      }
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(`[apify/orchestrate] ${sourceName} FAILED: ${reason}`)
      sourceErrors[sourceName] = reason
    }
  }

  console.log(`[apify/orchestrate] Total raw jobs collected: ${totalJobs}`)
  return { jobs: allJobs, sourceErrors }
}
