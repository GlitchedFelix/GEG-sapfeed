import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none'

export const buttonSizes: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-2 text-sm',
}

export const buttonVariants: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 shadow-card',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
}

export default function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonBase, buttonSizes[size], buttonVariants[variant], className)}
      {...props}
    />
  )
}
