import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BADGE_DEFINITIONS, Achievement } from '@/lib/types'
import { Lock } from 'lucide-react'

async function getAchievements(userId: string): Promise<Achievement[]> {
  const { data } = await supabaseAdmin
    .from('achievements')
    .select('*')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false })
  return data ?? []
}

export default async function AchievementsPage() {
  const session = await getServerSession(authOptions)
  const earned = await getAchievements(session!.user.id)
  const earnedKeys = new Set(earned.map((a) => a.badge_key))
  const allBadges = Object.entries(BADGE_DEFINITIONS)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Achievements</h2>
        <p className="text-muted-foreground mt-1">
          {earnedKeys.size} of {allBadges.length} badges earned
        </p>
      </div>

      {/* Earned */}
      {earnedKeys.size > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Earned</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {earned.map((a) => {
              const badge = BADGE_DEFINITIONS[a.badge_key]
              if (!badge) return null
              return (
                <Card key={a.id} className="border-primary/20 bg-primary/5">
                  <CardContent className="flex flex-col items-center text-center py-6 gap-2">
                    <span className="text-4xl">{badge.icon}</span>
                    <p className="font-semibold text-sm">{badge.label}</p>
                    <p className="text-xs text-muted-foreground">{badge.description}</p>
                    <Badge variant="secondary" className="text-xs">
                      {new Date(a.earned_at).toLocaleDateString()}
                    </Badge>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Locked */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Locked</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {allBadges
            .filter(([key]) => !earnedKeys.has(key))
            .map(([key, badge]) => (
              <Card key={key} className="opacity-50">
                <CardContent className="flex flex-col items-center text-center py-6 gap-2">
                  <div className="relative">
                    <span className="text-4xl grayscale">{badge.icon}</span>
                    <Lock className="h-4 w-4 absolute -bottom-1 -right-1 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-sm">{badge.label}</p>
                  <p className="text-xs text-muted-foreground">{badge.description}</p>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {earnedKeys.size === 0 && (
        <p className="text-center text-sm text-muted-foreground py-4">
          Start applying to jobs to earn your first badge!
        </p>
      )}
    </div>
  )
}
