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

/**
 * Known Workday tenants for common target companies.
 * Each entry is verified against the live myworkdayjobs.com URLs.
 * Companies that do NOT use Workday (iCIMS, Oracle Fusion, Eightfold, Taleo, etc.) are omitted.
 */
export const KNOWN_WORKDAY: Record<string, WorkdayTenant> = {
  // Semiconductors / EDA
  qualcomm:              { tenant: 'qualcomm',    dc: 'wd12', site: 'External' },           // wd12 confirmed
  intel:                 { tenant: 'intel',       dc: 'wd1',  site: 'External' },
  nvidia:                { tenant: 'nvidia',      dc: 'wd5',  site: 'NVIDIAExternalCareerSite' },
  // amd → uses iCIMS (careers.amd.com) — not Workday
  // synopsys → uses Avature (synopsys.avature.net) — not Workday
  cadence:               { tenant: 'cadence',     dc: 'wd1',  site: 'External_Careers' },
  // infineon → uses jobs.infineon.com — not Workday
  // stmicroelectronics → uses Eightfold AI — not Workday
  nxp:                   { tenant: 'nxp',         dc: 'wd3',  site: 'careers' },             // was wd1/nxp_External_Careers
  broadcom:              { tenant: 'broadcom',    dc: 'wd1',  site: 'External_Career' },     // was External_Career_Site
  marvell:               { tenant: 'marvell',     dc: 'wd1',  site: 'MarvellCareers' },      // was wd5/External
  microchip:             { tenant: 'microchiphr', dc: 'wd5',  site: 'External' },            // tenant is microchiphr, not microchiptechnology
  // onsemi → uses Oracle Fusion (hctz.fa.us2.oraclecloud.com) — not Workday
  // texasinstruments → uses careers.ti.com — not Workday
  // Automotive OEMs
  // ford → uses Oracle Fusion (efds.fa.em5.oraclecloud.com) — not Workday
  gm:                    { tenant: 'generalmotors', dc: 'wd5', site: 'Careers_GM' },         // was Careers
  'general motors':      { tenant: 'generalmotors', dc: 'wd5', site: 'Careers_GM' },
  stellantis:            { tenant: 'stellantis',  dc: 'wd3',  site: 'External_Career_Site_ID01' }, // was Stellantis
  toyota:                { tenant: 'toyota',      dc: 'wd5',  site: 'TMNA' },               // was TMNA_External
  // honda → uses careers.honda.com — not Workday
  // Automotive Tier-1 suppliers
  // continental → uses SmartRecruiters (careers.smartrecruiters.com/continental) — not Workday
  aptiv:                 { tenant: 'aptiv',       dc: 'wd5',  site: 'APTIV_CAREERS' },      // was External
  // denso → uses Oracle Fusion (hcwt.fa.us2.oraclecloud.com) — not Workday
  magna:                 { tenant: 'magna',       dc: 'wd3',  site: 'Magna' },
  borgwarner:            { tenant: 'borgwarner',  dc: 'wd5',  site: 'BorgWarner_Careers' }, // was External
  // visteon → no myworkdayjobs.com URL found — skipped
  harman:                { tenant: 'harman',      dc: 'wd3',  site: 'HARMAN' },             // was wd5/Samsung_Harman_External
  // bosch → uses jobs.bosch.com — not Workday
  valeo:                 { tenant: 'valeo',       dc: 'wd3',  site: 'valeo_jobs' },         // was valeo_external
  // forvia → unverified, skipped
  // Autonomous / AV
  // waymo → uses careers.withwaymo.com — not Workday
  // mobileye → uses careers.mobileye.com — not Workday
  // Defense / Aerospace
  leidos:                { tenant: 'leidos',      dc: 'wd5',  site: 'External' },
  // l3harris → uses careers.l3harris.com — not Workday
  northropgrumman:       { tenant: 'ngc',         dc: 'wd1',  site: 'Northrop_Grumman_External_Site' }, // tenant is ngc, not northropgrumman
  'northrop grumman':    { tenant: 'ngc',         dc: 'wd1',  site: 'Northrop_Grumman_External_Site' },
  rtx:                   { tenant: 'globalhr',    dc: 'wd5',  site: 'REC_RTX_Ext_Gateway' }, // tenant is globalhr
  raytheon:              { tenant: 'globalhr',    dc: 'wd5',  site: 'REC_RTX_Ext_Gateway' },
  // baesystems → uses Taleo/BrassRing (jobs.baesystems.com) — not Workday
  // 'bae systems' → same
}

export function resolveWorkdayTenants(_careerUrls: string[], targetCompanies: string[]): WorkdayTenant[] {
  // "Leave blank to search all" — return every known tenant when no companies specified
  if (!targetCompanies || targetCompanies.length === 0) {
    const seen = new Map<string, WorkdayTenant>()
    for (const t of Object.values(KNOWN_WORKDAY)) {
      seen.set(t.tenant + '/' + t.site, t)
    }
    return [...seen.values()]
  }

  const out = new Map<string, WorkdayTenant>()
  for (const c of targetCompanies) {
    const keySpaced   = c.toLowerCase().trim()           // "general motors", "bosch"
    const keyStripped = keySpaced.replace(/\s+/g, '')    // "generalmotors", "bosch"
    const known = KNOWN_WORKDAY[keySpaced] ?? KNOWN_WORKDAY[keyStripped]
    if (known) out.set(known.tenant + '/' + known.site, known)
  }

  return [...out.values()]
}

/**
 * Known Greenhouse slugs for companies that use Greenhouse as their ATS.
 * These are fetched via the free Greenhouse JSON API (no Apify credits).
 * Keyed by lowercased company name (both spaced and stripped forms where needed).
 */
export const KNOWN_GREENHOUSE: Record<string, string> = {
  waymo:               'waymo',
  aurora:              'aurora',
  'applied intuition': 'appliedintuition',
  appliedintuition:    'appliedintuition',
}

/**
 * Known career page URLs for companies not on Workday or any supported ATS.
 * These are scraped via the career_page source (Apify rag-web-browser).
 * Keyed by lowercased company name.
 */
export const KNOWN_CAREER_PAGES: Record<string, string> = {
  // Semiconductors — not on Workday
  amd:               'https://careers.amd.com/careers-home/',
  synopsys:          'https://careers.synopsys.com/',
  infineon:          'https://jobs.infineon.com/careers',
  stmicroelectronics:'https://stmicroelectronics.eightfold.ai/careers',
  onsemi:            'https://www.onsemi.com/careers/search-for-careers-worldwide',
  'texas instruments':'https://careers.ti.com/',
  texasinstruments:  'https://careers.ti.com/',
  // Automotive OEMs — not on Workday
  ford:              'https://efds.fa.em5.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs',
  honda:             'https://careers.honda.com/us/en',
  // Automotive Tier-1 — not on Workday
  continental:       'https://jobs.continental.com/en/',
  denso:             'https://densocareers.com/search/searchjobs',
  visteon:           'https://www.visteon.com/careers/join-us/default.aspx',
  // Defense — not on Workday
  l3harris:          'https://careers.l3harris.com/en/search-jobs',
  baesystems:        'https://jobs.baesystems.com/global/en/search-results',
  'bae systems':     'https://jobs.baesystems.com/global/en/search-results',
  // AV — not on Workday (Waymo + Aurora handled via Greenhouse above)
  mobileye:          'https://careers.mobileye.com/jobs',
}

/**
 * Resolve Greenhouse slugs for known companies.
 * Returns slugs matching any of the given target companies.
 * When targetCompanies is empty, returns all known slugs.
 */
export function resolveGreenhouseSlugs(targetCompanies: string[]): string[] {
  if (!targetCompanies || targetCompanies.length === 0) {
    return [...new Set(Object.values(KNOWN_GREENHOUSE))]
  }
  const seen = new Set<string>()
  for (const c of targetCompanies) {
    const key = c.toLowerCase().trim()
    const slug = KNOWN_GREENHOUSE[key] ?? KNOWN_GREENHOUSE[key.replace(/\s+/g, '')]
    if (slug) seen.add(slug)
  }
  return [...seen]
}

/** Map known company names to career page base URLs */
export function getKnownCareerUrls(companies: string[]): string[] {
  if (!companies || companies.length === 0) {
    return Object.values(KNOWN_CAREER_PAGES)
  }
  return companies
    .map(c => KNOWN_CAREER_PAGES[c.toLowerCase().trim()] ?? KNOWN_CAREER_PAGES[c.toLowerCase().trim().replace(/\s+/g, '')])
    .filter(Boolean) as string[]
}

