import { cn } from './cn'

type Tone = 'ctm' | 'ital' | 'neutral' | 'accent'

const tones: Record<Tone, string> = {
  ctm: 'bg-brand-ctm/10 text-brand-ctm ring-1 ring-inset ring-brand-ctm/20',
  ital: 'bg-brand-ital/10 text-brand-ital ring-1 ring-inset ring-brand-ital/20',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  accent: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200',
}

export default function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
