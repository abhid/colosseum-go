import type { PropsWithChildren, ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { IconLoader2 } from '@tabler/icons-react'
import clsx from 'clsx'

type CardProps = PropsWithChildren<{ className?: string; padding?: 'sm' | 'md' | 'none' }>

export function Card({ children, className, padding = 'md' }: CardProps) {
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-4' : 'p-6'
  return (
    <div className={clsx('min-w-0 rounded-lg border border-gray-200 bg-white shadow-sm', pad, className)}>
      {children}
    </div>
  )
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    running: 'bg-blue-50 text-blue-700 border-blue-200',
    completed: 'bg-green-50 text-green-700 border-green-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
    interrupted: 'bg-purple-50 text-purple-700 border-purple-200',
  }
  const style = styles[status?.toLowerCase?.()] || 'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <span className={clsx('rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide', style)}>
      {status}
    </span>
  )
}

type EmptyStateProps = {
  title: string
  body?: string
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ title, body, icon, action, compact = false }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-dashed border-gray-300 bg-gray-50/60 text-center',
        compact ? 'p-4' : 'p-8',
      )}
    >
      {icon ? <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center text-gray-400">{icon}</div> : null}
      <h3 className="text-sm font-semibold tracking-tight text-gray-900">{title}</h3>
      {body ? <p className={clsx('mx-auto mt-1 max-w-md text-sm text-gray-500', compact && 'text-xs')}>{body}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

type LoadingStateProps = {
  label?: string
  variant?: 'spinner' | 'text' | 'skeleton'
  className?: string
}

export function LoadingState({ label = 'Loading…', variant = 'spinner', className }: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div className={clsx('space-y-2', className)} aria-label={label} role="status">
        <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
      </div>
    )
  }
  if (variant === 'text') {
    return <p className={clsx('text-sm text-gray-500', className)}>{label}</p>
  }
  return (
    <div className={clsx('flex items-center gap-2 text-sm text-gray-500', className)} role="status" aria-live="polite">
      <IconLoader2 size={16} className="animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export function QueryErrorState({
  title = 'Unable to load data',
  query,
  className,
}: {
  title?: string
  query: UseQueryResult<unknown, Error>
  className?: string
}) {
  if (!query.isError) return null
  return (
    <div
      className={clsx(
        'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700',
        className,
      )}
      role="alert"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs">{query.error?.message ?? 'Unknown error'}</p>
    </div>
  )
}

export function ErrorBanner({ title = 'Something went wrong', message, className }: { title?: string; message?: string; className?: string }) {
  if (!message) return null
  return (
    <div className={clsx('rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700', className)} role="alert">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs">{message}</p>
    </div>
  )
}
