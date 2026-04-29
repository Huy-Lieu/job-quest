'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'

type ThemeValue = 'light' | 'dark' | 'system'

const OPTIONS: Array<{ value: ThemeValue; Icon: typeof Sun; label: string }> = [
  { value: 'light',  Icon: Sun,     label: 'Light'  },
  { value: 'dark',   Icon: Moon,    label: 'Dark'   },
  { value: 'system', Icon: Monitor, label: 'System' },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  // Reserve space pre-mount to avoid layout shift
  if (!theme) return <div className="h-9" aria-hidden />

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex rounded-md bg-muted p-0.5"
    >
      {OPTIONS.map(({ value, Icon, label }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-sm transition-colors ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}
