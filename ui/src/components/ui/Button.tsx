import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'
import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-gray-900 text-white hover:bg-gray-800 active:bg-black border border-gray-900',
  secondary: 'bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 border border-gray-300',
  ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-transparent',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 border border-red-600',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS_RING,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  )
})
