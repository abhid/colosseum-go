import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import type { ToolDef } from '../lib/types'
import { queryKeys } from '../lib/queryKeys'

export function ToolsPage() {
  const toolsQuery = useQuery({ queryKey: queryKeys.tools, queryFn: api.listTools, refetchInterval: 3000 })

  const defs = useMemo(() => (toolsQuery.data ?? []) as ToolDef[], [toolsQuery.data])

  return (
    <div className="space-y-4">
      <SectionTitle title="Tools Console" subtitle="Inspect available tools. Tool extension will move to MCP integrations." />

      <Card>
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-gray-900">Tool Management</h3>
        <p className="text-sm text-gray-600">
          Custom tool authoring is intentionally disabled in-app. Use MCP server integrations for extending tool capabilities.
        </p>
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Future direction: external MCP servers as the primary extension surface.
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Registered Tools</h3>
        {toolsQuery.isLoading ? <LoadingState label="Loading tools…" /> : null}
        <QueryErrorState title="Failed to load tools" query={toolsQuery} />
        {!toolsQuery.isLoading && !toolsQuery.isError && defs.length === 0 ? <EmptyState title="No tools" body="No tools are registered in this runtime." /> : (
          <div className="space-y-3">
            {defs.map((t) => (
              <div key={t.id} className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t.kind} | {t.enabled ? 'enabled' : 'disabled'}
                    </p>
                    <p className="mt-2 text-sm text-gray-700">{t.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
