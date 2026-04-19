import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { IconArrowRight } from '@tabler/icons-react'
import clsx from 'clsx'

import { FOCUS_RING } from '../../lib/tokens'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'

export function ManagedResourcesSection() {
  const environments = useQuery({ queryKey: queryKeys.environments, queryFn: api.listEnvironments })
  const vaults = useQuery({ queryKey: queryKeys.credentialVaults, queryFn: api.listCredentialVaults })

  return (
    <section data-section="resources" id="section-resources" className="scroll-mt-24 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">Managed resources</h3>
        <p className="mt-0.5 text-xs text-gray-500">Runtime environments and credential vaults that agents can bind to.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ResourceCard
          title="Environments"
          count={(environments.data ?? []).length}
          isLoading={environments.isLoading}
          isError={environments.isError}
          latest={latestUpdatedAt(environments.data ?? [])}
          to="/environments"
        />
        <ResourceCard
          title="Credential vaults"
          count={(vaults.data ?? []).length}
          isLoading={vaults.isLoading}
          isError={vaults.isError}
          latest={latestUpdatedAt(vaults.data ?? [])}
          to="/credential-vaults"
        />
      </div>
    </section>
  )
}

function ResourceCard({
  title,
  count,
  isLoading,
  isError,
  latest,
  to,
}: {
  title: string
  count: number
  isLoading: boolean
  isError: boolean
  latest: string
  to: string
}) {
  return (
    <Link
      to={to}
      className={clsx(
        'group flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300',
        FOCUS_RING,
      )}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-1 text-lg font-semibold text-gray-900">
          {isLoading ? '…' : isError ? '—' : count}
        </p>
        {latest ? <p className="mt-0.5 text-xs text-gray-500">last updated {latest}</p> : null}
      </div>
      <IconArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-gray-700" />
    </Link>
  )
}

function latestUpdatedAt(rows: Array<Record<string, unknown>>): string {
  let latest = 0
  for (const row of rows) {
    const raw = String(row['updated_at'] ?? row['created_at'] ?? '')
    const ts = new Date(raw).getTime()
    if (Number.isFinite(ts) && ts > latest) latest = ts
  }
  if (latest === 0) return ''
  const diff = Date.now() - latest
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}
