import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/app/components/dashboard/StatCard'
import { FitScoreBadge } from '@/app/components/ui/FitScoreBadge'
import { Briefcase, Flame, Star, ArrowRight } from 'lucide-react'

async function getOnboardingStatus(userId: string) {
  const [{ count: configCount }, { count: resumeCount }] = await Promise.all([
    supabaseAdmin.from('search_configs').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('is_active', true),
    supabaseAdmin.from('resumes').select('*', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  return {
    hasSearchConfig: (configCount ?? 0) > 0,
    hasResume: (resumeCount ?? 0) > 0,
  }
}

interface RecentJob {
  id: string
  canonical_title: string
  company: string
  job_scores: { fit_score: number | null }[] | null
}

async function getUserStats(userId: string) {
  const [{ data: user }, { count: totalApps }, { count: interviews }, { count: offers }, { data: recentJobs }] =
    await Promise.all([
      supabaseAdmin.from('users').select('name, xp, level, streak_days').eq('id', userId).single(),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'interview'),
      supabaseAdmin.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'offer'),
      supabaseAdmin
        .from('jobs')
        .select('id, canonical_title, company, job_scores(fit_score)')
        .eq('user_id', userId)
        .order('scraped_at', { ascending: false })
        .limit(5),
    ])

  return {
    user,
    totalApps: totalApps ?? 0,
    interviews: interviews ?? 0,
    offers: offers ?? 0,
    recentJobs: (recentJobs ?? []) as RecentJob[],
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  const [{ user, totalApps, interviews, offers, recentJobs }, { hasSearchConfig, hasResume }] = await Promise.all([
    getUserStats(session!.user.id),
    getOnboardingStatus(session!.user.id),
  ])

  const xpForNextLevel = (user?.level ?? 1) * 100
  const xpProgress = Math.min(((user?.xp ?? 0) / xpForNextLevel) * 100, 100)

  const stats = [
    { title: 'Total Applications', value: totalApps,   icon: 'Send'          as const, description: 'jobs applied to' },
    { title: 'Interviews',         value: interviews,   icon: 'CalendarCheck' as const, description: 'scheduled or completed' },
    { title: 'Offers',             value: offers,       icon: 'Briefcase'     as const, description: 'received so far' },
    {
      title: 'Success Rate',
      value: totalApps > 0 ? `${Math.round((offers / totalApps) * 100)}%` : '--',
      icon:  'Trophy' as const,
      description: 'offer / application ratio',
    },
  ]

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {user?.name ?? 'there'}!</h2>
        <p className="text-muted-foreground mt-1">Here&apos;s your job search overview.</p>
      </div>

      {(!hasResume || !hasSearchConfig) && (() => {
        const stepsComplete = [hasResume, hasSearchConfig].filter(Boolean).length
        const steps = [
          {
            label: 'Upload your resume',
            description: 'Claude uses your resume to score job fit and generate tailored applications',
            done: hasResume,
            href: '/dashboard/resume',
            linkText: 'Upload resume →',
          },
          {
            label: 'Create a search config',
            description: 'Tell JobQuest what roles and companies to watch for you',
            done: hasSearchConfig,
            href: '/dashboard/jobs',
            linkText: 'Create config →',
          },
          {
            label: 'Run your first search',
            description: 'JobQuest will scrape job boards and score results against your resume',
            done: false,
            href: null,
            linkText: null,
          },
        ]

        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Getting Started</span>
                <span className="text-sm font-normal text-muted-foreground">{stepsComplete} of 3 steps complete</span>
              </CardTitle>
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${(stepsComplete / 3) * 100}%` }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${step.done ? 'bg-green-500 border-green-500' : 'border-muted-foreground'}`}>
                    {step.done && (
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${step.done ? 'line-through text-muted-foreground' : ''}`}>{step.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                    {!step.done && step.href && (
                      <Link href={step.href} className="text-xs text-primary hover:underline mt-1 inline-block">
                        {step.linkText}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })()}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ title, value, icon, description }) => (
          <StatCard key={title} title={title} value={value} icon={icon} description={description} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <Badge variant="secondary" className="mb-1">On fire!</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Keep applying daily to maintain your streak</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4">
        <Link href="/dashboard/jobs" className="flex-1">
          <Button className="w-full" size="lg">Search Jobs</Button>
        </Link>
        <Link href="/dashboard/resume" className="flex-1">
          <Button className="w-full" size="lg" variant="outline">Analyze Resume</Button>
        </Link>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Job Matches</h3>
        {recentJobs.length > 0 ? (
          <Card>
            <CardContent className="divide-y p-0">
              {recentJobs.map((job) => {
                const fitScore = job.job_scores?.[0]?.fit_score ?? null
                return (
                  <Link
                    key={job.id}
                    href="/dashboard/jobs"
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{job.canonical_title}</p>
                      <p className="text-sm text-muted-foreground">{job.company}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                      <FitScoreBadge score={fitScore} />
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                )
              })}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Briefcase className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
              <p className="text-sm text-muted-foreground">No jobs found yet. Run a search to get started.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {totalApps === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground mb-4 opacity-50" />
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
    </div>
  )
}
