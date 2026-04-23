'use client'

interface Step {
  id: string
  label: string
}

interface AnalysisStepBarProps {
  currentStep: number
  steps: Step[]
}

export function AnalysisStepBar({ currentStep, steps }: AnalysisStepBarProps) {
  return (
    <div className="space-y-2 w-full max-w-sm">
      {steps.map((step, i) => (
        <div key={step.id} className={`flex items-center gap-2 text-sm transition-opacity ${i <= currentStep ? 'opacity-100' : 'opacity-30'}`}>
          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${i < currentStep ? 'bg-green-500' : i === currentStep ? 'bg-primary animate-pulse' : 'bg-muted'}`} />
          {step.label}
        </div>
      ))}
    </div>
  )
}
