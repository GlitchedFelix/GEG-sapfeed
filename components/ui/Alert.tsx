import { AlertTriangle } from 'lucide-react'
import { cn } from './cn'

type Tone = 'warning' | 'error' | 'info'

const tones: Record<Tone, string> = {
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-accent-200 bg-accent-50 text-accent-700',
}

export default function Alert({
  tone = 'warning',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs', tones[tone], className)}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
