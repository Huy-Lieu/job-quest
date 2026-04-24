// lib/apify/ats-resolver.ts
// ATS URL resolution helpers — extract slugs from career URLs and map companies to Workday tenants

import type { WorkdayTenant } from './sources'

/** Build direct ATS board URLs from slugs for use as rag-web-browser startUrls. */
export function buildAtsUrls(ats: string, slugs: string[]): string[] {
  return slugs.map(slug => {
    switch (ats) {
      case 'greenhouse': return `https://boards.greenhouse.io/${slug}`
      case 'lever':      return `https://jobs.lever.co/${slug}`
      case 'ashby':      return `https://jobs.ashbyhq.com/${slug}`
      default:           return slug
    }
  })
}

export interface AtsSlugs {
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
export function resolveAtsSlugs(careerUrls: string[], targetCompanies: string[]): AtsSlugs {
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
export const KNOWN_WORKDAY: Record<string, WorkdayTenant> = {
  qualcomm:              { tenant: 'qualcomm',              dc: 'wd5', site: 'External' },
  intel:                 { tenant: 'intel',                 dc: 'wd1', site: 'External' },
  synopsys:              { tenant: 'synopsys',              dc: 'wd1', site: 'Synopsys_Careers' },
  infineon:              { tenant: 'infineon',              dc: 'wd3', site: 'Infineon' },
  stmicroelectronics:    { tenant: 'stmicroelectronics',    dc: 'wd3', site: 'STMicroelectronics_Careers' },
  nxp:                   { tenant: 'nxp',                   dc: 'wd1', site: 'nxp_External_Careers' },
  broadcom:              { tenant: 'broadcom',              dc: 'wd1', site: 'External_Career_Site' },
  leidos:                { tenant: 'leidos',                dc: 'wd5', site: 'External' },
}

export function resolveWorkdayTenants(careerUrls: string[], targetCompanies: string[]): WorkdayTenant[] {
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
export function getKnownCareerUrls(companies: string[]): string[] {
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
