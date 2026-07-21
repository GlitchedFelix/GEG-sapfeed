import { cn } from './cn'

interface Option<T extends string> {
  value: T
  label: string
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex rounded-md bg-slate-100 p-0.5', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === opt.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
