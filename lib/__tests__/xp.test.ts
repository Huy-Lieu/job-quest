import { describe, it, expect } from 'vitest'
import { calcLevel, XP_VALUES } from '@/lib/xp'

// ── calcLevel ─────────────────────────────────────────────────────────────────

describe('calcLevel', () => {
  it('returns level 1 at 0 XP', () => {
    expect(calcLevel(0)).toBe(1)
  })

  it('returns level 1 below 100 XP', () => {
    expect(calcLevel(99)).toBe(1)
  })

  it('returns level 2 at exactly 100 XP', () => {
    expect(calcLevel(100)).toBe(2)
  })

  it('returns level 2 at 199 XP', () => {
    expect(calcLevel(199)).toBe(2)
  })

  it('returns level 3 at 200 XP', () => {
    expect(calcLevel(200)).toBe(3)
  })

  it('returns level 11 at 1000 XP', () => {
    expect(calcLevel(1000)).toBe(11)
  })

  it('handles large XP values correctly', () => {
    expect(calcLevel(9999)).toBe(100)
  })
})

// ── XP_VALUES ─────────────────────────────────────────────────────────────────

describe('XP_VALUES', () => {
  it('awards 10 XP for saved', () => {
    expect(XP_VALUES['saved']).toBe(10)
  })

  it('awards 20 XP for applied', () => {
    expect(XP_VALUES['applied']).toBe(20)
  })

  it('awards 30 XP for phone_screen', () => {
    expect(XP_VALUES['phone_screen']).toBe(30)
  })

  it('awards 50 XP for interview', () => {
    expect(XP_VALUES['interview']).toBe(50)
  })

  it('awards 100 XP for offer', () => {
    expect(XP_VALUES['offer']).toBe(100)
  })

  it('has higher XP for later funnel stages', () => {
    expect(XP_VALUES['applied']!).toBeGreaterThan(XP_VALUES['saved']!)
    expect(XP_VALUES['phone_screen']!).toBeGreaterThan(XP_VALUES['applied']!)
    expect(XP_VALUES['interview']!).toBeGreaterThan(XP_VALUES['phone_screen']!)
    expect(XP_VALUES['offer']!).toBeGreaterThan(XP_VALUES['interview']!)
  })
})
