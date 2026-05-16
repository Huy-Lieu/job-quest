// lib/apify/ats-resolver.ts
// ATS URL resolution helpers — extract slugs from career URLs and map companies to Workday tenants

import type { WorkdayTenant } from './sources'
import type { OracleTenant }  from './ats-boards'

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
  // Semiconductors / EDA
  qualcomm:              { tenant: 'qualcomm',              dc: 'wd12', site: 'External' },           // confirmed OK (migrated from wd5)
  intel:                 { tenant: 'intel',                 dc: 'wd1',  site: 'External' },           // confirmed OK
  nvidia:                { tenant: 'nvidia',                dc: 'wd5',  site: 'NVIDIAExternalCareerSite' }, // confirmed OK
  // amd: removed -- does not use Workday (careers.amd.com)
  // synopsys: removed -- does not use Workday (synopsys.avature.net)
  cadence:               { tenant: 'cadence',               dc: 'wd1',  site: 'External_Careers' },  // confirmed OK
  // infineon: removed -- does not use Workday (jobs.infineon.com)
  // stmicroelectronics: removed -- does not use Workday (stmicroelectronics.eightfold.ai)
  nxp:                   { tenant: 'nxp',                   dc: 'wd3',  site: 'careers' },           // confirmed OK (was wd1/nxp_External_Careers)
  broadcom:              { tenant: 'broadcom',              dc: 'wd1',  site: 'External_Career' },   // confirmed OK (was External_Career_Site)
  marvell:               { tenant: 'marvell',               dc: 'wd1',  site: 'MarvellCareers' },    // confirmed OK (was wd5/External)
  microchip:             { tenant: 'microchiphr',           dc: 'wd5',  site: 'External' },          // confirmed OK (was microchiptechnology/wd1)
  // onsemi: removed -- does not use Workday (Oracle Cloud HCM at hctz.fa.us2.oraclecloud.com)
  // texasinstruments: removed -- does not use Workday (Oracle Cloud HCM at careers.ti.com)
  // Automotive OEMs
  // ford: removed -- does not use Workday (careers.ford.com)
  gm:                    { tenant: 'generalmotors',         dc: 'wd5',  site: 'Careers_GM' },        // confirmed OK (was Careers, then wrongly Global)
  'general motors':      { tenant: 'generalmotors',         dc: 'wd5',  site: 'Careers_GM' },
  stellantis:            { tenant: 'stellantis',            dc: 'wd3',  site: 'External_Career_Site_ID01' }, // confirmed via search (was Stellantis)
  toyota:                { tenant: 'toyota',                dc: 'wd503', site: 'TMNA' },             // confirmed OK (migrated from wd5/TMNA_External)
  // honda: removed -- no confirmed Workday portal found for Honda North America
  // Automotive Tier-1 suppliers
  // continental: removed -- uses SmartRecruiters (careers.smartrecruiters.com/continental)
  // aptiv: removed -- does not use Workday (custom portal at aptiv.com/en/jobs)
  // denso: removed -- does not use Workday (Oracle Cloud HCM)
  magna:                 { tenant: 'magna',                 dc: 'wd3',  site: 'Magna_External' },    // confirmed OK (was Magna)
  borgwarner:            { tenant: 'borgwarner',            dc: 'wd5',  site: 'BorgWarner_Careers' }, // confirmed OK (was External)
  // visteon: removed -- no confirmed Workday portal found
  harman:                { tenant: 'harman',                dc: 'wd3',  site: 'HARMAN' },            // confirmed OK (was wd5/Samsung_Harman_External)
  // bosch: removed -- does not use Workday (jobs.bosch.com)
  valeo:                 { tenant: 'valeo',                 dc: 'wd3',  site: 'valeo_jobs' },        // confirmed OK (was valeo_external)
  // forvia: removed -- does not use Workday (jobs.faurecia.com)
  // Autonomous / AV
  // waymo: removed -- no confirmed Workday portal found (waymo.com/careers)
  // mobileye: removed -- does not use Workday (custom portal at careers.mobileye.com)
  // Defense / Aerospace
  leidos:                { tenant: 'leidos',                dc: 'wd5',  site: 'External' },          // confirmed OK
  // l3harris: removed -- does not use Workday (careers.l3harris.com)
  northropgrumman:       { tenant: 'ngc',                   dc: 'wd1',  site: 'Northrop_Grumman_External_Site' }, // confirmed OK (was northropgrumman/wd5)
  'northrop grumman':    { tenant: 'ngc',                   dc: 'wd1',  site: 'Northrop_Grumman_External_Site' },
  rtx:                   { tenant: 'globalhr',              dc: 'wd5',  site: 'REC_RTX_Ext_Gateway' }, // confirmed OK (was rtx/ExternalCareerSite)
  raytheon:              { tenant: 'globalhr',              dc: 'wd5',  site: 'REC_RTX_Ext_Gateway' },
  // baesystems: removed -- does not use Workday (jobs.baesystems.com)
}

export function resolveWorkdayTenants(
  _careerUrls:     string[],
  targetCompanies: string[],
  userEntries?:    Record<string, WorkdayTenant>,
): WorkdayTenant[] {
  const merged: Record<string, WorkdayTenant> = { ...KNOWN_WORKDAY, ...(userEntries ?? {}) }

  if (!targetCompanies || targetCompanies.length === 0) {
    const seen = new Map<string, WorkdayTenant>()
    for (const t of Object.values(merged)) {
      seen.set(t.tenant + '/' + t.site, t)
    }
    return [...seen.values()]
  }

  const out = new Map<string, WorkdayTenant>()
  for (const c of targetCompanies) {
    const keySpaced   = c.toLowerCase().trim()
    const keyStripped = keySpaced.replace(/\s+/g, '')
    const known = merged[keySpaced] ?? merged[keyStripped]
    if (known) out.set(known.tenant + '/' + known.site, known)
  }

  return [...out.values()]
}

/** Known Oracle Cloud HCM tenants (confirmed via browser testing 2026-05-14) */
export const KNOWN_ORACLE: Record<string, OracleTenant> = {
  // Semiconductors
  onsemi:               { host: 'hctz', dc: 'us2', site: 'CX_1001', company: 'onsemi' },             // confirmed OK
  'on semi':            { host: 'hctz', dc: 'us2', site: 'CX_1001', company: 'onsemi' },
  texasinstruments:     { host: 'hcwt', dc: 'us2', site: 'CX',      company: 'Texas Instruments' },  // confirmed OK
  'texas instruments':  { host: 'hcwt', dc: 'us2', site: 'CX',      company: 'Texas Instruments' },
  // Automotive Tier-1
  denso:                { host: 'hcwt', dc: 'us2', site: 'CX',      company: 'DENSO' },              // confirmed OK
}

export function resolveOracleTenants(
  targetCompanies: string[],
): OracleTenant[] {
  if (!targetCompanies || targetCompanies.length === 0) {
    const seen = new Map<string, OracleTenant>()
    for (const t of Object.values(KNOWN_ORACLE)) {
      seen.set(t.host + '/' + t.site + '/' + t.company, t)
    }
    return [...seen.values()]
  }

  const out = new Map<string, OracleTenant>()
  for (const c of targetCompanies) {
    const key   = c.toLowerCase().trim()
    const known = KNOWN_ORACLE[key] ?? KNOWN_ORACLE[key.replace(/\s+/g, '')]
    if (known) out.set(known.host + '/' + known.site + '/' + known.company, known)
  }
  return [...out.values()]
}

/** Map known company names to career page base URLs (fallback for career_page Apify source) */
export function getKnownCareerUrls(companies: string[]): string[] {
  const knownUrls: Record<string, string> = {
    // Confirmed Workday companies (scraped via fetchWorkdayBoard; listed here as fallback)
    nvidia:              'https://www.nvidia.com/en-us/about-nvidia/careers/',
    qualcomm:            'https://www.qualcomm.com/company/careers',
    intel:               'https://www.intel.com/content/www/us/en/jobs/jobs-at-intel.html',
    broadcom:            'https://www.broadcom.com/company/careers',
    // Non-Workday / non-Oracle — career_page source covers these
    amd:                 'https://careers.amd.com/careers-home/jobs',
    synopsys:            'https://careers.synopsys.com/search-jobs',
    infineon:            'https://jobs.infineon.com/careers',
    stmicroelectronics:  'https://stmicroelectronics.eightfold.ai/careers',
    'applied intuition': 'https://www.appliedintuition.com/careers',
    aurora:              'https://aurora.tech/careers',
    waymo:               'https://waymo.com/careers/',
    bosch:               'https://www.bosch.com/careers/job-offers/',
    continental:         'https://careers.smartrecruiters.com/continental',
    forvia:              'https://jobs.faurecia.com/careers/job-offers',
    ford:                'https://careers.ford.com/search-jobs',
    honda:               'https://careers.honda.com/',
    visteon:             'https://visteon-panorama.darwinbox.com/ms/candidatev2/main/careers/home',
    aptiv:               'https://www.aptiv.com/en/jobs',
    mobileye:            'https://careers.mobileye.com/jobs',
    l3harris:            'https://careers.l3harris.com/en/search-jobs',
    baesystems:          'https://jobs.baesystems.com/global/en/search-results',
    'bae systems':       'https://jobs.baesystems.com/global/en/search-results',
  }
  return companies
    .map(c => knownUrls[c.toLowerCase()])
    .filter(Boolean) as string[]
}
