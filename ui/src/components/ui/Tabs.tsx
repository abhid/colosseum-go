import type { ReactNode } from 'react'
import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'

export type TabItem = {
  id: string
  label: ReactNode
}

type Props = {
  tabs: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, value, onChange, className }: Props) {
  return (
    <div role="tablist" className={clsx('flex items-end gap-0 border-b border-gray-200', className)}>
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              FOCUS_RING,
              active
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
