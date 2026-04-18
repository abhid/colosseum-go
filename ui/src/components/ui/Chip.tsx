import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  children: ReactNode
}

const toneClasses: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'border-gray-200 bg-gray-50 text-gray-600',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
}

export function Chip({ tone = 'neutral', className, children, ...rest }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
