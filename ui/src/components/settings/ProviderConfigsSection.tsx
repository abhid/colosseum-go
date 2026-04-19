import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'

import { Button } from '../ui/Button'
import { EmptyState, LoadingState, QueryErrorState } from '../Common'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import type { ProviderInfo } from '../../lib/types'
import { ProviderConfigCard } from './ProviderConfigCard'
import { ProviderConfigEditor } from './ProviderConfigEditor'

export function ProviderConfigsSection({ availableProviders }: { availableProviders: ProviderInfo[] }) {
  const configs = useQuery({ queryKey: queryKeys.providerConfigs, queryFn: api.listProviderConfigs })
  const [creating, setCreating] = useState(false)

  return (
    <section data-section="configs" id="section-configs" className="scroll-mt-24 space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-gray-900">Provider configurations</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Named credentials and overrides per provider. Stored in the database.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          disabled={creating || availableProviders.length === 0}
          leadingIcon={<IconPlus className="h-3.5 w-3.5" />}
        >
          New configuration
        </Button>
      </div>

      {creating ? (
        <ProviderConfigEditor
          mode="create"
          availableProviders={availableProviders}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {configs.isLoading ? <LoadingState label="Loading provider configurations…" /> : null}
      <QueryErrorState title="Failed to load provider configurations" query={configs} />

      {!configs.isLoading && !configs.isError ? (
        (configs.data ?? []).length === 0 && !creating ? (
          <EmptyState
            title="No provider configurations yet"
            body="Detected providers use environment variables by default. Add a configuration here to override or test named credentials."
            compact
          />
        ) : (
          <div className="space-y-2">
            {(configs.data ?? []).map((c) => (
              <ProviderConfigCard key={c.id} config={c} availableProviders={availableProviders} />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}
