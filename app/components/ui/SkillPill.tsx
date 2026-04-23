type SkillVariant = 'required' | 'preferred' | 'tech' | 'matched' | 'missing' | 'default'

const variantStyles: Record<SkillVariant, string> = {
  required: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  preferred: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  tech: 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30',
  matched: 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30',
  missing: 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
  default: 'bg-secondary text-secondary-foreground',
}

export function SkillPill({
  label,
  variant = 'default',
}: {
  label: string
  variant?: SkillVariant
}) {
  const styles = variantStyles[variant]

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles}`}>
      {label}
    </span>
  )
}
