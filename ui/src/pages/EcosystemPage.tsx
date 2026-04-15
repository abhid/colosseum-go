import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Card, EmptyState, SectionTitle } from '../components/Common'

export function EcosystemPage() {
  const qc = useQueryClient()
  const workflows = useQuery({ queryKey: ['ecosystem', 'workflows'], queryFn: api.listWorkflows })
  const policies = useQuery({ queryKey: ['ecosystem', 'policies'], queryFn: api.listPolicies })
  const secrets = useQuery({ queryKey: ['ecosystem', 'secrets'], queryFn: api.listSecrets })
  const providerConfigs = useQuery({ queryKey: ['ecosystem', 'provider-configs'], queryFn: api.listProviderConfigs })
  const providersQ = useQuery({ queryKey: ['providers'], queryFn: api.listProviders })
  const providerIDs = useMemo(() => (providersQ.data ?? []).map((p) => p.provider), [providersQ.data])

  const [workflowName, setWorkflowName] = useState('Code Fix Workflow')
  const [workflowDef, setWorkflowDef] = useState('{"steps":["prepare","implement","test","summarize"]}')
  const [policyName, setPolicyName] = useState('Default Safety')
  const [policyDef, setPolicyDef] = useState('{"deny_commands":["rm -rf /"]}')
  const [secretName, setSecretName] = useState('GITHUB_TOKEN')
  const [secretValue, setSecretValue] = useState('')
  const [provider, setProvider] = useState('')
  const [providerName, setProviderName] = useState('default')
  const [providerCfg, setProviderCfg] = useState('{"base_url":"https://api.openai.com"}')

  useEffect(() => {
    if (providerIDs.length === 0) {
      setProvider('')
      return
    }
    if (!providerIDs.includes(provider)) {
      setProvider(providerIDs[0])
    }
  }, [providerIDs, provider])

  const createWorkflow = useMutation({ mutationFn: () => api.createWorkflow({ name: workflowName, definition: JSON.parse(workflowDef) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'workflows'] }) })
  const deleteWorkflow = useMutation({ mutationFn: (id: string) => api.deleteWorkflow(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'workflows'] }) })

  const createPolicy = useMutation({ mutationFn: () => api.createPolicy({ name: policyName, definition: JSON.parse(policyDef), enabled: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'policies'] }) })
  const deletePolicy = useMutation({ mutationFn: (id: string) => api.deletePolicy(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'policies'] }) })

  const createSecret = useMutation({ mutationFn: () => api.createSecret({ name: secretName, value: secretValue }), onSuccess: () => { setSecretValue(''); qc.invalidateQueries({ queryKey: ['ecosystem', 'secrets'] }) } })
  const deleteSecret = useMutation({ mutationFn: (name: string) => api.deleteSecret(name), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'secrets'] }) })

  const createProviderConfig = useMutation({ mutationFn: () => api.createProviderConfig({ provider, name: providerName, config: JSON.parse(providerCfg) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'provider-configs'] }) })
  const deleteProviderConfig = useMutation({ mutationFn: (id: string) => api.deleteProviderConfig(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'provider-configs'] }) })

  return (
    <div className="space-y-4">
      <SectionTitle title="Ecosystem Console" subtitle="Manage workflows, policies, secrets, and provider configs in one place." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Workflows</h3>
          <input className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
          <textarea className="mt-3 h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={workflowDef} onChange={(e) => setWorkflowDef(e.target.value)} />
          <button className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800" onClick={() => createWorkflow.mutate()}>Create Workflow</button>
          <div className="mt-4 space-y-2">{(workflows.data ?? []).length === 0 ? <EmptyState title="No workflows" body="Create workflow templates for repeatable runs." /> : (workflows.data ?? []).map((w) => <div key={String(w.id)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm"><span>{String(w.name)}</span><button className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50" onClick={() => deleteWorkflow.mutate(String(w.id))}>Delete</button></div>)}</div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Policies</h3>
          <input className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={policyName} onChange={(e) => setPolicyName(e.target.value)} />
          <textarea className="mt-3 h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={policyDef} onChange={(e) => setPolicyDef(e.target.value)} />
          <button className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800" onClick={() => createPolicy.mutate()}>Create Policy</button>
          <div className="mt-4 space-y-2">{(policies.data ?? []).length === 0 ? <EmptyState title="No policies" body="Create policy rules for governance." /> : (policies.data ?? []).map((p) => <div key={String(p.id)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm"><span>{String(p.name)}</span><button className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50" onClick={() => deletePolicy.mutate(String(p.id))}>Delete</button></div>)}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Secrets</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={secretName} onChange={(e) => setSecretName(e.target.value)} />
            <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={secretValue} placeholder="Secret value" onChange={(e) => setSecretValue(e.target.value)} />
          </div>
          <button className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800" onClick={() => createSecret.mutate()}>Save Secret</button>
          <div className="mt-4 space-y-2">{(secrets.data ?? []).length === 0 ? <EmptyState title="No secrets" body="Store named secrets for tool/provider usage." /> : (secrets.data ?? []).map((s) => <div key={String(s.name)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm"><span>{String(s.name)}</span><button className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50" onClick={() => deleteSecret.mutate(String(s.name))}>Delete</button></div>)}</div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Provider Configs</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providerIDs.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <input className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Config name" />
          </div>
          <textarea className="mt-3 h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400" value={providerCfg} onChange={(e) => setProviderCfg(e.target.value)} />
          {providerIDs.length === 0 ? <p className="mt-2 text-xs text-gray-500">No providers are configured. Set provider API keys and restart.</p> : null}
          <button className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50" disabled={!provider} onClick={() => createProviderConfig.mutate()}>Save Provider Config</button>
          <div className="mt-4 space-y-2">{(providerConfigs.data ?? []).length === 0 ? <EmptyState title="No provider configs" body="Add named provider profiles for routing and overrides." /> : (providerConfigs.data ?? []).map((p) => <div key={String(p.id)} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm"><span>{String(p.provider)} / {String(p.name)}</span><button className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50" onClick={() => deleteProviderConfig.mutate(String(p.id))}>Delete</button></div>)}</div>
        </Card>
      </div>
    </div>
  )
}
