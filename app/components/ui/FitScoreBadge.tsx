export function FitScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold border bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30">
        --
      </span>
    )
  }

  const color =
    score >= 70
      ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30'
      : score >= 50
        ? 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30'
        : 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30'

  return (
    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {score}%
    </span>
  )
}
