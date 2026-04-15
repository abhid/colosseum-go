import type { Agent, Artifact, EvalRun, EvalSuite, ProviderInfo, Run, RunEvent, RunTelemetry, ToolDef } from './types'

const jsonHeaders = { 'Content-Type': 'application/json' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listAgents: () => request<Agent[]>('/api/agents'),
  createAgent: (body: Partial<Agent>) => request<{ id: string }>('/api/agents', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Partial<Agent>) =>
    request<{ id: string }>(`/api/agents/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
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
  createRun: (body: { agent_id: string; task: string; workspace_path?: string; source_workspace_path?: string; replay_source_run_id?: string; replay_from_step?: number; provider?: string; model?: string; max_steps?: number }) =>
    request<{ id: string; status: string }>('/api/runs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  replayRun: (id: string, body: { resume_from_step?: number; provider?: string; model?: string; max_steps?: number }) =>
    request<{ id: string; status: string }>(`/api/runs/${id}/replay`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  getRunTrace: (id: string) => request<RunEvent[]>(`/api/runs/${id}/trace`),
  getRunArtifacts: (id: string) => request<Artifact[]>(`/api/runs/${id}/artifacts`),
  cancelRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  approveRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/approve`, { method: 'POST' }),
  interruptRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/interrupt`, { method: 'POST' }),
  resumeRun: (id: string) => request<{ status: string }>(`/api/runs/${id}/resume`, { method: 'POST' }),
  steerRun: (id: string, payload: Record<string, unknown>) =>
    request<{ seq: number }>(`/api/runs/${id}/events`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(payload) }),
  listWorkflows: () => request<Array<Record<string, unknown>>>('/api/workflows'),
  createWorkflow: (body: Record<string, unknown>) => request<{ id: string }>('/api/workflows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateWorkflow: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/workflows/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) => request<{ deleted: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' }),
  listPolicies: () => request<Array<Record<string, unknown>>>('/api/policies'),
  createPolicy: (body: Record<string, unknown>) => request<{ id: string }>('/api/policies', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updatePolicy: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/policies/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deletePolicy: (id: string) => request<{ deleted: boolean }>(`/api/policies/${id}`, { method: 'DELETE' }),
  listSecrets: () => request<Array<Record<string, unknown>>>('/api/secrets'),
  createSecret: (body: { name: string; value: string }) => request<{ name: string }>('/api/secrets', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteSecret: (name: string) => request<{ deleted: boolean }>(`/api/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listProviderConfigs: () => request<Array<Record<string, unknown>>>('/api/provider-configs'),
  createProviderConfig: (body: Record<string, unknown>) => request<{ id: string }>('/api/provider-configs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateProviderConfig: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/provider-configs/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  deleteProviderConfig: (id: string) => request<{ deleted: boolean }>(`/api/provider-configs/${id}`, { method: 'DELETE' }),
  listEvalSuites: () => request<EvalSuite[]>('/api/evals/suites'),
  getEvalSuite: (id: string) => request<{ suite: EvalSuite; cases: Array<Record<string, unknown>>; runs: EvalRun[] }>(`/api/evals/suites/${id}`),
  createEvalSuite: (body: Record<string, unknown>) => request<{ id: string }>('/api/evals/suites', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  updateEvalSuite: (id: string, body: Record<string, unknown>) => request<{ id: string }>(`/api/evals/suites/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }),
  queueEvalRun: (id: string, body: Record<string, unknown>) => request<{ id: string; status: string }>(`/api/evals/suites/${id}/runs`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  listEvalRuns: () => request<EvalRun[]>('/api/evals/runs'),
  getEvalRun: (id: string) => request<{ run: EvalRun; cases: Array<Record<string, unknown>> }>(`/api/evals/runs/${id}`),
  getEvalRegression: (suiteID: string) => request<Record<string, unknown>>(`/api/evals/suites/${suiteID}/regression`),
}
