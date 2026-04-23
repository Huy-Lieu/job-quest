import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { BADGE_DEFINITIONS } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Star,
  Flame,
  Trophy,
  Lock,
  Check,
  Send,
  CalendarCheck,
  Briefcase,
  FileText,
  GraduationCap,
} from 'lucide-react'

function getLevelName(level: number): string {
  if (level <= 1) return 'Job Seeker'
  if (level <= 3) return 'Active Applicant'
  if (level <= 6) return 'Experienced Candidate'
  if (level <= 10) return 'Senior Applicant'
  return 'Job Hunt Master'
}

async function getProfileData(userId: string) {
  const [
    { data: user },
    { count: totalApplications },
    { count: saved },
    { count: applied },
    { count: phoneScreen },
    { count: interview },
    { count: offer },
    { count: rejected },
    { data: achievements },
    { count: masterResumes },
  ] = await Promise.all([
    supabaseAdmin.from('users').select('name, xp, level, streak_days').eq('id', userId).single(),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'saved'),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'applied'),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'phone_screen'),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'interview'),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'offer'),
    supabaseAdmin
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'rejected'),
    supabaseAdmin
      .from('achievements')
      .select('badge_key, earned_at')
      .eq('user_id', userId),
    supabaseAdmin
      .from('resumes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'master'),
  ])

  return {
    user,
    totalApplications: totalApplications ?? 0,
    statusCounts: {
      saved: saved ?? 0,
      applied: applied ?? 0,
      phoneScreen: phoneScreen ?? 0,
      interview: interview ?? 0,
      offer: offer ?? 0,
      rejected: rejected ?? 0,
    },
    achievements: achievements ?? [],
    masterResumes: masterResumes ?? 0,
  }
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  const { user, totalApplications, statusCounts, achievements, masterResumes } = await getProfileData(
    session!.user.id
  )

  const level = user?.level ?? 1
  const xp = user?.xp ?? 0
  const streakDays = user?.streak_days ?? 0
  const xpForNextLevel = level * 100
  const xpProgress = Math.min((xp / xpForNextLevel) * 100, 100)

  const levelName = getLevelName(level)

  const earnedBadgeKeys = new Set(achievements.map((a) => a.badge_key))

  const funnelStages = [
    { label: 'Saved', count: statusCounts.saved, icon: Briefcase },
    { label: 'Applied', count: statusCounts.applied, icon: Send },
    { label: 'Phone Screen', count: statusCounts.phoneScreen, icon: CalendarCheck },
    { label: 'Interview', count: statusCounts.interview, icon: Trophy },
    { label: 'Offer', count: statusCounts.offer, icon: GraduationCap },
  ]

  const getConversionRate = (from: number, to: number): string => {
    if (from === 0) return '--'
    return `${Math.round((to / from) * 100)}%`
  }

  const conversionRates = [
    getConversionRate(totalApplications, statusCounts.phoneScreen),
    getConversionRate(statusCounts.phoneScreen, statusCounts.interview),
    getConversionRate(statusCounts.interview, statusCounts.offer),
  ]

  const statsGrid = [
    {
      label: 'Total Applied',
      value: totalApplications,
      icon: Send,
    },
    {
      label: 'Interviews',
      value: statusCounts.interview,
      icon: Trophy,
    },
    {
      label: 'Offers',
      value: statusCounts.offer,
      icon: Briefcase,
    },
    {
      label: 'Streak',
      value: `${streakDays}d`,
      icon: Flame,
    },
    {
      label: 'Resumes',
      value: masterResumes,
      icon: FileText,
    },
    {
      label: 'PhD Saved',
      value: statusCounts.saved,
      icon: GraduationCap,
    },
  ]

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      {/* Level Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border-0">
        <CardContent className="pt-6">
          <div className="flex items-start gap-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white text-2xl font-bold">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{user?.name ?? 'User'}</h1>
              <p className="text-lg text-muted-foreground mt-1">
                Level {level}: {levelName}
              </p>
              <div className="flex items-center gap-2 mt-4 bg-white/50 dark:bg-white/10 p-3 rounded-lg">
                <Progress value={xpProgress} className="flex-1 h-2" />
                <span className="text-sm font-medium ml-2 whitespace-nowrap">
                  {xp} / {xpForNextLevel} XP
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid 2x3 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statsGrid.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Application Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Application Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {funnelStages.map((stage, idx) => {
            const Icon = stage.icon
            const conversionRate = idx < conversionRates.length ? conversionRates[idx] : null
            const showArrow = idx < funnelStages.length - 1

            return (
              <div key={stage.label}>
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{stage.label}</p>
                    <p className="text-xs text-muted-foreground">{stage.count} applications</p>
                  </div>
                  {conversionRate && (
                    <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">{conversionRate}</div>
                  )}
                </div>
                {showArrow && <div className="text-xs text-muted-foreground ml-4 text-center py-1"></div>}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Achievement Badges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Achievements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Object.entries(BADGE_DEFINITIONS).map(([key, badge]) => {
              const isEarned = earnedBadgeKeys.has(key)
              return (
                <div
                  key={key}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg text-center transition-all ${
                    isEarned
                      ? 'bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800'
                      : 'bg-muted/50 border border-muted'
                  }`}
                >
                  <div className="text-2xl">{badge.icon}</div>
                  <p className="text-xs font-medium leading-tight">{badge.label}</p>
                  <div className="mt-1">
                    {isEarned ? (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
