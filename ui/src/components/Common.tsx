import type { PropsWithChildren } from 'react'

export function Card({ children }: PropsWithChildren) {
  return <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
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
  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium tracking-wide shadow-sm uppercase ${styles[status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>{status}</span>
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-8 text-center">
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  )
}
