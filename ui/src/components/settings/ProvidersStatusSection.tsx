import type { UseQueryResult } from '@tanstack/react-query'

import { EmptyState, LoadingState, QueryErrorState } from '../Common'
import type { ProviderInfo } from '../../lib/types'

export function ProvidersStatusSection({ query }: { query: UseQueryResult<ProviderInfo[]> }) {
  return (
    <section data-section="providers" id="section-providers" className="scroll-mt-24 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">Providers</h3>
        <p className="mt-0.5 text-xs text-gray-500">Detected providers, based on server environment variables.</p>
      </div>
      {query.isLoading ? <LoadingState label="Loading providers…" /> : null}
      <QueryErrorState title="Failed to load providers" query={query} />
      {!query.isLoading && !query.isError ? (
        (query.data ?? []).length === 0 ? (
          <EmptyState
            title="No providers detected"
            body="Configure provider credentials (OPENAI_API_KEY or ANTHROPIC_API_KEY) and restart the server."
            compact
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {(query.data ?? []).map((p) => (
              <div
                key={p.provider}
                className="rounded-lg border border-gray-200 bg-white p-4 text-sm transition-colors hover:border-gray-300"
              >
                <div className="flex items-center gap-2">
                  <p className="font-medium capitalize text-gray-900">{p.provider}</p>
                  <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    detected
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Tools: {p.supports_tools ? 'yes' : 'no'} · Streaming: {p.supports_streaming ? 'yes' : 'no'}
                </p>
              </div>
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}
