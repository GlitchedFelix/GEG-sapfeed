import { cn } from './cn'

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean
}

export default function Panel({ padded = true, className, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-card',
        padded && 'px-3 py-2',
        className
      )}
      {...props}
    />
  )
}
