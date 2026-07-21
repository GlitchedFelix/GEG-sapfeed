import { cn } from './cn'

export default function StatCard({
  label,
  value,
  emphasis = 'default',
}: {
  label: string
  value: string
  emphasis?: 'primary' | 'default'
}) {
  return (
    <div className="min-w-[6rem]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div
        className={cn(
          'mt-0.5 tabular-nums',
          emphasis === 'primary' ? 'text-base font-semibold text-accent-700' : 'text-sm font-semibold text-slate-800'
        )}
      >
        {value}
      </div>
    </div>
  )
}
