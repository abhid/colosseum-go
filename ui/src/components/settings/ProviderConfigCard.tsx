import { useState } from 'react'
import clsx from 'clsx'

import { Button } from '../ui/Button'
import { FOCUS_RING } from '../../lib/tokens'
import type { ProviderConfig, ProviderInfo } from '../../lib/types'
import { DeleteConfigButton, ProviderConfigEditor } from './ProviderConfigEditor'

export function ProviderConfigCard({
  config,
  availableProviders,
}: {
  config: ProviderConfig
  availableProviders: ProviderInfo[]
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ProviderConfigEditor
        mode="edit"
        existing={config}
        availableProviders={availableProviders}
        onClose={() => setEditing(false)}
      />
    )
  }

  const keyCount = countConfigKeys(config.config_json)
  const updated = formatRelative(config.updated_at)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-900">{config.name}</p>
            <span className={clsx('rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600', FOCUS_RING)}>
              {config.provider}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {keyCount} config {keyCount === 1 ? 'key' : 'keys'} · updated {updated}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <DeleteConfigButton id={config.id} onDeleted={() => setEditing(false)} />
        </div>
      </div>
    </div>
  )
}

function countConfigKeys(raw: string): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.values(parsed as Record<string, unknown>).filter((v) => v !== '' && v != null).length
    }
  } catch {
    return 0
  }
  return 0
}

function formatRelative(iso: string): string {
  if (!iso) return 'recently'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 'recently'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}
