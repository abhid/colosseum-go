import type { Agent, PlanningMode } from './types'
import { parseStarterPrompts } from './agentConfig/parser'

export type AgentFormState = {
  name: string
  description: string
  provider: string
  model: string
  system_prompt: string
  allowed_tools: string[]
  starter_prompts: string[]
  default_task: string
  default_max_steps: number
  default_workspace_path: string
  default_environment_id: string
  default_credential_vault_id: string
  output_contract_type: 'none' | 'json_schema' | 'regex'
  output_contract_payload: string
  planning_mode: PlanningMode
}

export const EMPTY_AGENT_FORM: AgentFormState = {
  name: '',
  description: '',
  provider: '',
  model: '',
  system_prompt: '',
  allowed_tools: [],
  starter_prompts: [],
  default_task: '',
  default_max_steps: 30,
  default_workspace_path: '',
  default_environment_id: '',
  default_credential_vault_id: '',
  output_contract_type: 'none',
  output_contract_payload: '',
  planning_mode: 'off',
}

export function agentToFormState(agent: Agent): AgentFormState {
  const rawType = (agent.output_contract_type ?? 'none').toLowerCase()
  const outType: AgentFormState['output_contract_type'] =
    rawType === 'json_schema' || rawType === 'regex' ? (rawType as 'json_schema' | 'regex') : 'none'
  const rawPlanning = (agent.planning_mode ?? 'off').toLowerCase() as PlanningMode
  const planning: PlanningMode =
    rawPlanning === 'suggest' || rawPlanning === 'required' ? rawPlanning : 'off'
  return {
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    allowed_tools: agent.allowed_tools ?? [],
    starter_prompts: agent.starter_prompts ?? [],
    default_task: agent.default_task ?? '',
    default_max_steps: agent.default_max_steps ?? 30,
    default_workspace_path: agent.default_workspace_path ?? '',
    default_environment_id: agent.default_environment_id ?? '',
    default_credential_vault_id: agent.default_credential_vault_id ?? '',
    output_contract_type: outType,
    output_contract_payload: agent.output_contract_payload ?? '',
    planning_mode: planning,
  }
}

export function formStateToPatch(state: AgentFormState): Partial<Agent> {
  return {
    name: state.name,
    description: state.description,
    provider: state.provider,
    model: state.model,
    system_prompt: state.system_prompt,
    allowed_tools: state.allowed_tools,
    starter_prompts: state.starter_prompts,
    default_task: state.default_task,
    default_max_steps: state.default_max_steps,
    default_workspace_path: state.default_workspace_path,
    default_environment_id: state.default_environment_id,
    default_credential_vault_id: state.default_credential_vault_id,
    output_contract_type: state.output_contract_type,
    output_contract_payload: state.output_contract_payload,
    planning_mode: state.planning_mode,
  }
}

export function parseStarterPromptsText(text: string): string[] {
  return parseStarterPrompts(text)
}

export function starterPromptsToText(prompts: string[]): string {
  return prompts.join('\n')
}

export type FieldDiff = {
  field: string
  before: string
  after: string
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export function diffAgentForm(prev: AgentFormState, next: AgentFormState): FieldDiff[] {
  const fields: Array<keyof AgentFormState> = [
    'name',
    'description',
    'provider',
    'model',
    'system_prompt',
    'allowed_tools',
    'starter_prompts',
    'default_task',
    'default_max_steps',
    'default_workspace_path',
    'default_environment_id',
    'default_credential_vault_id',
    'output_contract_type',
    'output_contract_payload',
    'planning_mode',
  ]
  const out: FieldDiff[] = []
  for (const field of fields) {
    const a = normalize(prev[field])
    const b = normalize(next[field])
    if (a !== b) out.push({ field, before: a, after: b })
  }
  return out
}

export function isAgentFormDirty(prev: AgentFormState, next: AgentFormState): boolean {
  return diffAgentForm(prev, next).length > 0
}

export function validateContractPayload(type: AgentFormState['output_contract_type'], payload: string): string | null {
  if (type === 'none') return null
  const trimmed = payload.trim()
  if (!trimmed) return 'Contract payload is required.'
  if (type === 'json_schema') {
    try {
      JSON.parse(trimmed)
      return null
    } catch (err) {
      return `Invalid JSON: ${(err as Error).message}`
    }
  }
  if (type === 'regex') {
    try {
      new RegExp(trimmed)
      return null
    } catch (err) {
      return `Invalid regex: ${(err as Error).message}`
    }
  }
  return null
}

export function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    name: 'Name',
    description: 'Description',
    provider: 'Provider',
    model: 'Model',
    system_prompt: 'System prompt',
    allowed_tools: 'Allowed tools',
    starter_prompts: 'Starter prompts',
    default_task: 'Default task',
    default_max_steps: 'Max steps',
    default_workspace_path: 'Workspace path',
    default_environment_id: 'Environment',
    default_credential_vault_id: 'Credential vault',
    output_contract_type: 'Contract type',
    output_contract_payload: 'Contract payload',
    planning_mode: 'Planning mode',
  }
  return labels[field] ?? field
}
