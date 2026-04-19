import type { Agent, Artifact, ChatMessage, ChatSession, ProviderConfig, ProviderConfigTestResult, ProviderInfo, Run, RunEvent, RunTelemetry, ToolDef } from './types'

const jsonHeaders = { 'Content-Type': 'application/json' }

async function parseErrorMessage(res: Response): Promise<string> {
  const raw = await res.text()
  let message = raw
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        message = parsed.error
      } else if (typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message
      }
    } catch {
      // Keep raw response text as message.
    }
  }
  return message || `Request failed: ${res.status}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res))
  }
  return res.json() as Promise<T>
}

export const api = {
  listAgents: () => request<Agent[]>('/api/agents'),
  createAgent: (body: Partial<Agent>) => request<{ id: string }>('/api/agents', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Partial<Agent>) =>
    request<{ id: string }>(`/api/agents/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteAgent: (id: string, force = false) =>
    request<{ deleted: boolean; deleted_runs?: number }>(`/api/agents/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  listTools: () => request<ToolDef[]>('/api/tools'),
  listProviders: () => request<ProviderInfo[]>('/api/providers'),
  listOpenAIModels: () => request<string[]>('/api/providers/openai/models'),
  enhanceSystemPrompt: (body: { prompt: string; provider?: string; model?: string }) =>
    request<{ provider: string; model: string; prompt: string }>('/api/prompts/enhance', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  createTool: (body: Record<string, unknown>) => request<{ id: string }>('/api/tools', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateTool: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/tools/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteTool: (id: string) => request<{ deleted: boolean }>(`/api/tools/${id}`, { method: 'DELETE' }),
  testTool: (id: string, body: { workspace_path: string; input: Record<string, unknown> }) =>
    request<{ ok: boolean; output: Record<string, unknown>; log: string; error?: string }>(`/api/tools/${id}/test`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  listRuns: () => request<Run[]>('/api/runs'),
  getRun: (id: string) => request<Run>(`/api/runs/${id}`),
  getRunTelemetry: (id: string) => request<RunTelemetry>(`/api/runs/${id}/telemetry`),
  createRun: (body: { agent_id: string; task: string; workspace_path?: string; source_workspace_path?: string; replay_source_run_id?: string; replay_from_step?: number; provider?: string; model?: string; max_steps?: number; environment_id?: string; credential_vault_id?: string; output_contract_type?: string; output_contract_payload?: string }) =>
    request<{ id: string; status: string }>('/api/runs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  replayRun: (id: string, body: { resume_from_step?: number; provider?: string; model?: string; max_steps?: number; environment_id?: string; credential_vault_id?: string; output_contract_type?: string; output_contract_payload?: string }) =>
    request<{ id: string; status: string }>(`/api/runs/${id}/replay`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  getRunTrace: (id: string) => request<RunEvent[]>(`/api/runs/${id}/trace`),
  getRunArtifacts: (id: string) => request<Artifact[]>(`/api/runs/${id}/artifacts`),
  getRunArtifactContentURL: (runID: string, artifactID: string) => `/api/runs/${runID}/artifacts/${artifactID}/content`,
  cancelRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  approveRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/approve`, { method: 'POST' }),
  interruptRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/interrupt`, { method: 'POST' }),
  resumeRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/resume`, { method: 'POST' }),
  steerRun: (id: string, payload: Record<string, unknown>) =>
    request<{ seq: number }>(`/api/runs/${id}/events`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  uploadRunFiles: async (id: string, files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    const res = await fetch(`/api/runs/${id}/files`, { method: 'POST', body: form })
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res))
    }
    return res.json() as Promise<{ uploaded: Array<Record<string, unknown>>; count: number }>
  },
  listChatSessions: () => request<ChatSession[]>('/api/chat/sessions'),
  createChatSession: (body: { agent_id: string; title?: string }) =>
    request<{ id: string; title: string; agent_id: string; status: string }>('/api/chat/sessions', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  getChatSession: (id: string) => request<ChatSession>(`/api/chat/sessions/${id}`),
  patchChatSession: (id: string, body: { title?: string; archived?: boolean; pinned?: boolean }) =>
    request<{ id: string; updated: boolean }>(`/api/chat/sessions/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }),
  listChatMessages: (id: string) => request<ChatMessage[]>(`/api/chat/sessions/${id}/messages`),
  sendChatMessage: (id: string, body: { content: string; source?: string }) =>
    request<{ session_id: string; run_id: string; turn_index: number; status: string }>(`/api/chat/sessions/${id}/messages`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  uploadChatAttachments: async (id: string, files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    const res = await fetch(`/api/chat/sessions/${id}/attachments`, { method: 'POST', body: form })
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res))
    }
    return res.json() as Promise<{ uploaded: Array<Record<string, unknown>>; count: number; run_id: string }>
  },
  listPolicies: () => request<Array<Record<string, unknown>>>('/api/policies'),
  createPolicy: (body: Record<string, unknown>) => request<{ id: string }>('/api/policies', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updatePolicy: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/policies/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deletePolicy: (id: string) => request<{ deleted: boolean }>(`/api/policies/${id}`, { method: 'DELETE' }),
  listSecrets: () => request<Array<Record<string, unknown>>>('/api/secrets'),
  createSecret: (body: { name: string; value: string }) => request<{ name: string }>('/api/secrets', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteSecret: (name: string) => request<{ deleted: boolean }>(`/api/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listProviderConfigs: () => request<ProviderConfig[]>('/api/provider-configs'),
  createProviderConfig: (body: { provider: string; name: string; config: unknown }) =>
    request<{ id: string }>('/api/provider-configs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateProviderConfig: (id: string, body: { provider: string; name: string; config: unknown }) =>
    request<{ id: string }>(`/api/provider-configs/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteProviderConfig: (id: string) => request<{ deleted: boolean }>(`/api/provider-configs/${id}`, { method: 'DELETE' }),
  testProviderConfig: (id: string) =>
    request<ProviderConfigTestResult>(`/api/provider-configs/${id}/test`, { method: 'POST' }),
  listEnvironments: () => request<Array<Record<string, unknown>>>('/api/environments'),
  createEnvironment: (body: Record<string, unknown>) => request<{ id: string }>('/api/environments', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateEnvironment: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/environments/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteEnvironment: (id: string) => request<{ deleted: boolean }>(`/api/environments/${id}`, { method: 'DELETE' }),
  listCredentialVaults: () => request<Array<Record<string, unknown>>>('/api/credential-vaults'),
  createCredentialVault: (body: Record<string, unknown>) => request<{ id: string }>('/api/credential-vaults', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateCredentialVault: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/credential-vaults/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteCredentialVault: (id: string) => request<{ deleted: boolean }>(`/api/credential-vaults/${id}`, { method: 'DELETE' }),
  listCredentialVaultItems: (id: string) => request<Array<Record<string, unknown>>>(`/api/credential-vaults/${id}/items`),
  upsertCredentialVaultItem: (id: string, body: { secret_name: string; alias?: string }) =>
    request<{ vault_id: string; secret_name: string }>(`/api/credential-vaults/${id}/items`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteCredentialVaultItem: (id: string, secretName: string) =>
    request<{ deleted: boolean }>(`/api/credential-vaults/${id}/items/${encodeURIComponent(secretName)}`, { method: 'DELETE' }),
}
