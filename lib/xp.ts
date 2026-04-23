import { supabaseAdmin } from '@/lib/supabase'
import { ApplicationStatus, BADGE_DEFINITIONS } from '@/lib/types'

// XP awarded per status
export const XP_VALUES: Partial<Record<ApplicationStatus, number>> = {
  saved:        10,
  applied:      20,
  phone_screen: 30,
  interview:    50,
  offer:        100,
}

export function calcLevel(xp: number): number {
  return Math.floor(xp / 100) + 1
}

// Update streak based on last_active
function calcStreak(lastActive: string | null, currentStreak: number): number {
  if (!lastActive) return 1

  const last = new Date(lastActive)
  const today = new Date()

  // Normalize to date only (no time)
  const lastDate = new Date(last.getFullYear(), last.getMonth(), last.getDate())
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return currentStreak      // already active today
  if (diffDays === 1) return currentStreak + 1  // consecutive day
  return 1                                       // streak broken
}

// Check and unlock achievements
async function checkAchievements(userId: string, newStreak: number) {
  // Get current counts
  const [{ count: totalApps }, { count: interviews }, { count: offers }, { data: existingBadges }] =
    await Promise.all([
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'interview'),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'offer'),
      supabaseAdmin.from('achievements').select('badge_key').eq('user_id', userId),
    ])

  const earned = new Set(existingBadges?.map((b) => b.badge_key) ?? [])
  const toUnlock: string[] = []

  const checks: { key: string; condition: boolean }[] = [
    { key: 'first_application', condition: (totalApps ?? 0) >= 1 },
    { key: 'five_applications',  condition: (totalApps ?? 0) >= 5 },
    { key: 'ten_applications',   condition: (totalApps ?? 0) >= 10 },
    { key: 'first_interview',    condition: (interviews ?? 0) >= 1 },
    { key: 'first_offer',        condition: (offers ?? 0) >= 1 },
    { key: 'streak_3',           condition: newStreak >= 3 },
    { key: 'streak_7',           condition: newStreak >= 7 },
  ]

  for (const { key, condition } of checks) {
    if (condition && !earned.has(key) && BADGE_DEFINITIONS[key]) {
      toUnlock.push(key)
    }
  }

  if (toUnlock.length > 0) {
    await supabaseAdmin.from('achievements').insert(
      toUnlock.map((badge_key) => ({ user_id: userId, badge_key }))
    )
  }

  return toUnlock
}

// Main function — call this after any application create/update
export async function awardXP(
  userId: string,
  status: ApplicationStatus,
  applicationId: string
): Promise<{ xpGained: number; newLevel: number; newBadges: string[] }> {
  const xpGained = XP_VALUES[status] ?? 0

  if (xpGained === 0) {
    return { xpGained: 0, newLevel: 1, newBadges: [] }
  }

  // Get current user stats
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('xp, level, streak_days, last_active')
    .eq('id', userId)
    .single()

  if (!user) return { xpGained: 0, newLevel: 1, newBadges: [] }

  const newXP = (user.xp ?? 0) + xpGained
  const newLevel = calcLevel(newXP)
  const newStreak = calcStreak(user.last_active, user.streak_days ?? 0)

  // Update user stats
  await supabaseAdmin
    .from('users')
    .update({
      xp: newXP,
      level: newLevel,
      streak_days: newStreak,
      last_active: new Date().toISOString(),
    })
    .eq('id', userId)

  // Update xp_awarded on the application
  await supabaseAdmin
    .from('applications')
    .update({ xp_awarded: xpGained })
    .eq('id', applicationId)

  // Check for new achievements
  const newBadges = await checkAchievements(userId, newStreak)

  return { xpGained, newLevel, newBadges }
}
