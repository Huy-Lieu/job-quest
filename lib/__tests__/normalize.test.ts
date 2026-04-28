import { describe, it, expect } from 'vitest'
import { inferCountryCode, normalizeJob } from '@/lib/pipeline/normalize'
import type { RawApifyJob } from '@/lib/types'

// ── inferCountryCode ──────────────────────────────────────────────────────────

describe('inferCountryCode', () => {
  describe('REMOTE', () => {
    it('returns REMOTE for exact "Remote"', () => {
      expect(inferCountryCode('Remote')).toBe('REMOTE')
    })

    it('returns REMOTE for "Fully Remote"', () => {
      expect(inferCountryCode('Fully Remote')).toBe('REMOTE')
    })

    it('returns REMOTE for "San Francisco, CA (Remote)"', () => {
      expect(inferCountryCode('San Francisco, CA (Remote)')).toBe('REMOTE')
    })
  })

  describe('MULTI', () => {
    it('returns MULTI for "Multiple Locations"', () => {
      expect(inferCountryCode('Multiple Locations')).toBe('MULTI')
    })

    it('returns MULTI for "3 locations"', () => {
      expect(inferCountryCode('3 locations')).toBe('MULTI')
    })
  })

  describe('US detection via state code', () => {
    it('infers US from "Austin, TX"', () => {
      expect(inferCountryCode('Austin, TX')).toBe('US')
    })

    it('infers US from "Santa Clara, CA"', () => {
      expect(inferCountryCode('Santa Clara, CA')).toBe('US')
    })

    it('infers US from "New York, NY"', () => {
      expect(inferCountryCode('New York, NY')).toBe('US')
    })

    it('infers US from "Washington, DC"', () => {
      expect(inferCountryCode('Washington, DC')).toBe('US')
    })
  })

  describe('US detection via explicit suffix', () => {
    it('infers US from "Austin, TX, US"', () => {
      expect(inferCountryCode('Austin, TX, US')).toBe('US')
    })

    it('infers US from "New York, NY, USA"', () => {
      expect(inferCountryCode('New York, NY, USA')).toBe('US')
    })
  })

  describe('known country names', () => {
    it('maps "London, United Kingdom" to GB', () => {
      expect(inferCountryCode('London, United Kingdom')).toBe('GB')
    })

    it('maps "Toronto, Canada" to CA', () => {
      expect(inferCountryCode('Toronto, Canada')).toBe('CA')
    })

    it('maps "Berlin, Germany" to DE', () => {
      expect(inferCountryCode('Berlin, Germany')).toBe('DE')
    })

    it('maps "Tel Aviv, Israel" to IL', () => {
      expect(inferCountryCode('Tel Aviv, Israel')).toBe('IL')
    })

    it('maps "Singapore" to SG', () => {
      expect(inferCountryCode('Singapore')).toBe('SG')
    })

    it('maps "Ho Chi Minh City, Vietnam" to VN', () => {
      expect(inferCountryCode('Ho Chi Minh City, Vietnam')).toBe('VN')
    })
  })

  describe('UNKNOWN fallback', () => {
    it('returns UNKNOWN for empty string', () => {
      expect(inferCountryCode('')).toBe('UNKNOWN')
    })

    it('returns UNKNOWN for unrecognised location', () => {
      expect(inferCountryCode('Narnia')).toBe('UNKNOWN')
    })

    it('returns UNKNOWN for a city with no country context', () => {
      expect(inferCountryCode('Paris')).toBe('UNKNOWN')
    })
  })
})

// ── normalizeJob ──────────────────────────────────────────────────────────────

describe('normalizeJob', () => {
  const base: RawApifyJob = {
    title:       'Senior Engineer',
    company:     'Acme Corp',
    location:    'Austin, TX',
    description: 'Build things.',
    url:         'https://example.com/job/123',
  }

  it('maps title, company, location correctly', () => {
    const result = normalizeJob(base, 'linkedin')
    expect(result.canonical_title).toBe('Senior Engineer')
    expect(result.company).toBe('Acme Corp')
    expect(result.location).toBe('Austin, TX')
  })

  it('infers country_code from location', () => {
    const result = normalizeJob(base, 'linkedin')
    expect(result.country_code).toBe('US')
  })

  it('sets source name correctly', () => {
    const result = normalizeJob(base, 'greenhouse')
    expect(result.source.name).toBe('greenhouse')
  })

  it('defaults raw_hash to empty string (filled by dedup layer)', () => {
    const result = normalizeJob(base, 'linkedin')
    expect(result.raw_hash).toBe('')
  })

  it('picks fallback fields when primary field is absent', () => {
    const raw: RawApifyJob = { jobTitle: 'Staff Engineer', companyName: 'Beta Inc', location: 'Remote' }
    const result = normalizeJob(raw, 'indeed')
    expect(result.canonical_title).toBe('Staff Engineer')
    expect(result.company).toBe('Beta Inc')
    expect(result.country_code).toBe('REMOTE')
  })

  it('detects PhD role correctly', () => {
    const phd: RawApifyJob = { ...base, title: 'PhD Research Fellowship in ML' }
    expect(normalizeJob(phd, 'phd').is_phd).toBe(true)
  })

  it('does not flag non-PhD roles', () => {
    expect(normalizeJob(base, 'linkedin').is_phd).toBe(false)
  })

  it('normalises full-time job type by default', () => {
    expect(normalizeJob(base, 'linkedin').job_type).toBe('full_time')
  })

  it('normalises contract job type', () => {
    const raw: RawApifyJob = { ...base, employmentType: 'Contract' }
    expect(normalizeJob(raw, 'linkedin').job_type).toBe('contract')
  })

  it('normalises internship job type', () => {
    const raw: RawApifyJob = { ...base, employmentType: 'Internship' }
    expect(normalizeJob(raw, 'linkedin').job_type).toBe('internship')
  })

  it('strips "(Remote)" suffix from title', () => {
    const raw: RawApifyJob = { ...base, title: 'Senior Engineer (Remote)' }
    expect(normalizeJob(raw, 'linkedin').canonical_title).toBe('Senior Engineer')
  })

  describe('salary parsing', () => {
    it('parses salary range from salary field', () => {
      const raw: RawApifyJob = { ...base, salary: '$120,000 - $150,000' }
      const result = normalizeJob(raw, 'linkedin')
      expect(result.salary_min).toBe(120000)
      expect(result.salary_max).toBe(150000)
    })

    it('parses salary from description when salary field absent', () => {
      const raw: RawApifyJob = { ...base, description: 'We offer $130k-$160k per year.' }
      const result = normalizeJob(raw, 'linkedin')
      expect(result.salary_min).toBe(130000)
      expect(result.salary_max).toBe(160000)
    })

    it('returns null salary when none mentioned', () => {
      const result = normalizeJob(base, 'linkedin')
      expect(result.salary_min).toBeNull()
      expect(result.salary_max).toBeNull()
    })
  })
})
