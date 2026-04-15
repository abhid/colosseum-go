import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'

export function SettingsPage() {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders })

  return (
    <div className="space-y-4">
      <SectionTitle title="Settings" subtitle="Provider and environment status." />
      <Card>
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Providers</h3>
        <div className="space-y-2">
          {(providers.data ?? []).length === 0 ? <EmptyState title="No providers detected" body="Configure provider credentials and restart the server." /> : (providers.data ?? []).map((p) => (
            <div key={p.provider} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-medium capitalize">{p.provider}</p>
              <p className="text-slate-600">Tools: {p.supports_tools ? 'Supported' : 'No'} • Streaming: {p.supports_streaming ? 'Supported' : 'No'}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="mb-2 text-sm font-semibold tracking-tight">Secrets</h3>
        <p className="text-sm text-slate-600">Configure provider keys with environment variables: <code className="font-mono">OPENAI_API_KEY</code> and <code className="font-mono">ANTHROPIC_API_KEY</code>.</p>
      </Card>
    </div>
  )
}
