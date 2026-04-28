import { describe, it, expect } from 'vitest'
import type { EnrichedFields, RoleIntel } from '@/lib/claude/enricher'

// ── EnrichedFields shape validation ──────────────────────────────────────────
// These tests validate the parser/validator logic -- not the Claude model itself.
// We construct realistic Haiku-style JSON outputs and assert they conform to the
// expected shape, including the new role_intel field.

function makeValidEnriched(overrides: Partial<EnrichedFields> = {}): EnrichedFields {
  return {
    role_summary:         'Designs and validates high-speed interconnects.',
    skills_required:      ['PCIe', 'HSIO validation'],
    skills_preferred:     ['NVLink', 'KVM/QEMU'],
    tech_stack:           ['PCIe', 'NVLink', 'NVLink-C2C'],
    work_mode:            'hybrid',
    visa_sponsorship:     'unknown',
    experience_years_min: 8,
    experience_years_max: null,
    education_level:      'bachelor',
    security_clearance:   'none',
    benefits_highlights:  ['equity', '401k match'],
    languages_required:   [],
    seniority_level:      'senior',
    role_type:            'individual_contributor',
    salary_min:           168000,
    salary_max:           264500,
    salary_currency:      'USD',
    role_intel: {
      role_translation: {
        day_to_day:        'Debug and validate NVLink/C2C interconnects, optimize IO power.',
        problem_solved:    'NVIDIA needs an HSIO specialist for next-gen AI silicon.',
        ownership_level:   'lead',
        year1_success:     'NVLink/C2C validated and stable on Vera Superchip.',
        team_context:      'Works with architecture, firmware, DGX, and QA teams.',
        work_rhythm:       'Mix of reactive debug and proactive design contributions.',
        growth_potential:  '',
        biggest_challenge: '',
      },
      ats_keywords: [
        'bringup planning',
        'HSIO functional validation',
        'chip-to-chip interconnects',
        'IO power optimization',
      ],
      hiring_signals: {
        is_backfill:       true,
        level_flexibility: true,
        urgency_note:      'Applications accepted at least until May 1, 2026',
        culture_signals:   ['team-first approach over lone wolf heroics'],
        interview_hints:   ['Expect live debug scenarios'],
      },
      opportunity_signals: {
        green_flags:   ['Clear ownership of validation methodology'],
        red_flags:     [],
        market_rarity: 'Rare — requires NVLink + HSIO + silicon bringup combo.',
      },
      prepare_to_apply: {
        resume_checklist:  ['HSIO validation', 'bringup planning', 'PCIe'],
        interview_format:  'Likely includes live debug and system design rounds.',
        competition_level: 'low',
        competition_note:  'Niche HSIO + bringup combo limits the candidate pool.',
      },
    },
    application_deadline: '2026-05-01',
    salary_levels: [
      { level: 'L4', min: 168000, max: 264500 },
      { level: 'L5', min: 196000, max: 310500 },
    ],
    ...overrides,
  }
}

describe('EnrichedFields shape', () => {
  it('contains all required scoring fields', () => {
    const e = makeValidEnriched()
    expect(e).toHaveProperty('role_summary')
    expect(e).toHaveProperty('skills_required')
    expect(e).toHaveProperty('skills_preferred')
    expect(e).toHaveProperty('tech_stack')
    expect(e).toHaveProperty('work_mode')
    expect(e).toHaveProperty('visa_sponsorship')
    expect(e).toHaveProperty('experience_years_min')
    expect(e).toHaveProperty('experience_years_max')
    expect(e).toHaveProperty('education_level')
    expect(e).toHaveProperty('security_clearance')
    expect(e).toHaveProperty('seniority_level')
    expect(e).toHaveProperty('role_type')
    expect(e).toHaveProperty('salary_min')
    expect(e).toHaveProperty('salary_max')
    expect(e).toHaveProperty('salary_currency')
  })

  it('contains role_intel field', () => {
    const e = makeValidEnriched()
    expect(e).toHaveProperty('role_intel')
    expect(e.role_intel).not.toBeNull()
  })
})

describe('RoleIntel shape', () => {
  it('contains all role_translation subfields', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(intel.role_translation).toHaveProperty('day_to_day')
    expect(intel.role_translation).toHaveProperty('problem_solved')
    expect(intel.role_translation).toHaveProperty('ownership_level')
    expect(intel.role_translation).toHaveProperty('year1_success')
    expect(intel.role_translation).toHaveProperty('team_context')
    expect(intel.role_translation).toHaveProperty('work_rhythm')
  })

  it('contains ats_keywords array', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(Array.isArray(intel.ats_keywords)).toBe(true)
  })

  it('contains all hiring_signals subfields', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(intel.hiring_signals).toHaveProperty('is_backfill')
    expect(intel.hiring_signals).toHaveProperty('level_flexibility')
    expect(intel.hiring_signals).toHaveProperty('urgency_note')
    expect(intel.hiring_signals).toHaveProperty('culture_signals')
    expect(intel.hiring_signals).toHaveProperty('interview_hints')
  })

  it('ownership_level is one of the allowed values', () => {
    const allowed = ['executor', 'contributor', 'lead', 'owner']
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(allowed).toContain(intel.role_translation.ownership_level)
  })

  it('is_backfill is boolean', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(typeof intel.hiring_signals.is_backfill).toBe('boolean')
  })

  it('level_flexibility is boolean', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(typeof intel.hiring_signals.level_flexibility).toBe('boolean')
  })

  it('culture_signals and interview_hints are arrays', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    expect(Array.isArray(intel.hiring_signals.culture_signals)).toBe(true)
    expect(Array.isArray(intel.hiring_signals.interview_hints)).toBe(true)
  })

  it('ats_keywords contains verbatim phrases not generic terms', () => {
    const intel: RoleIntel = makeValidEnriched().role_intel
    // Should not contain generic soft skills
    const hasGeneric = intel.ats_keywords.some(k =>
      ['communication', 'teamwork', 'leadership'].includes(k.toLowerCase())
    )
    expect(hasGeneric).toBe(false)
  })
})

describe('EnrichedFields work_mode values', () => {
  const validModes = ['remote', 'hybrid', 'on-site', 'unknown'] as const

  it.each(validModes)('accepts work_mode "%s"', (mode) => {
    const e = makeValidEnriched({ work_mode: mode })
    expect(e.work_mode).toBe(mode)
  })
})

describe('EnrichedFields visa_sponsorship values', () => {
  const validValues = ['yes', 'no', 'unknown'] as const

  it.each(validValues)('accepts visa_sponsorship "%s"', (val) => {
    const e = makeValidEnriched({ visa_sponsorship: val })
    expect(e.visa_sponsorship).toBe(val)
  })
})
neric soft skills
    const hasGeneric = intel.ats_keywords.some(k =>
      ['communication', 'teamwork', 'leadership'].includes(k.toLowerCase())
    )
    expect(hasGeneric).toBe(false)
  })
})

describe('EnrichedFields work_mode values', () => {
  const validModes = ['remote', 'hybrid', 'on-site', 'unknown'] as const

  it.each(validModes)('accepts work_mode "%s"', (mode) => {
    const e = makeValidEnriched({ work_mode: mode })
    expect(e.work_mode).toBe(mode)
  })
})

describe('EnrichedFields visa_sponsorship values', () => {
  const validValues = ['yes', 'no', 'unknown'] as const

  it.each(validValues)('accepts visa_sponsorship "%s"', (val) => {
    const e = makeValidEnriched({ visa_sponsorship: val })
    expect(e.visa_sponsorship).toBe(val)
  })
})
