import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Briefcase, Send, CalendarCheck, Trophy, Flame, Star } from 'lucide-react'

async function getUserStats(userId: string) {
  const [{ data: user }, { count: totalApps }, { count: interviews }, { count: offers }] =
    await Promise.all([
      supabaseAdmin.from('users').select('name, xp, level, streak_days').eq('id', userId).single(),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'interview'),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'offer'),
    ])

  return {
    user,
    totalApps: totalApps ?? 0,
    interviews: interviews ?? 0,
    offers: offers ?? 0,
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  const { user, totalApps, interviews, offers } = await getUserStats(session!.user.id)

  const xpForNextLevel = (user?.level ?? 1) * 100
  const xpProgress = Math.min(((user?.xp ?? 0) / xpForNextLevel) * 100, 100)

  const stats = [
    {
      title: 'Total Applications',
      value: totalApps,
      icon: Send,
      description: 'jobs applied to',
    },
    {
      title: 'Interviews',
      value: interviews,
      icon: CalendarCheck,
      description: 'scheduled or completed',
    },
    {
      title: 'Offers',
      value: offers,
      icon: Briefcase,
      description: 'received so far',
    },
    {
      title: 'Success Rate',
      value: totalApps > 0 ? `${Math.round((offers / totalApps) * 100)}%` : '—',
      icon: Trophy,
      description: 'offer / application ratio',
    },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {user?.name ?? 'there'} 👋</h2>
        <p className="text-muted-foreground mt-1">Here&apos;s your job search overview.</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ title, value, icon: Icon, description }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gamification */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* XP / Level */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-yellow-500" />
              Level {user?.level ?? 1}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{user?.xp ?? 0} XP</span>
              <span>{xpForNextLevel} XP to next level</span>
            </div>
            <Progress value={xpProgress} className="h-2" />
          </CardContent>
        </Card>

        {/* Streak */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-orange-500" />
              Daily Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">{user?.streak_days ?? 0}</span>
              <span className="text-muted-foreground mb-1">days</span>
              {(user?.streak_days ?? 0) >= 3 && (
                <Badge variant="secondary" className="mb-1">🔥 On fire!</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Keep applying daily to maintain your streak</p>
          </CardContent>
        </Card>
      </div>

      {/* Empty state for new users */}
      {totalApps === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">No applications yet</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Start tracking your job applications to see your stats here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
