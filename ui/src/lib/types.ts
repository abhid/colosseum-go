export type PlanningMode = 'off' | 'suggest' | 'required'

export type Agent = {
  id: string
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
  default_environment_id?: string
  default_credential_vault_id?: string
  output_contract_type?: 'none' | 'json_schema' | 'regex' | string
  output_contract_payload?: string
  planning_mode?: PlanningMode
  created_at: string
  updated_at: string
}

export type Run = {
  id: string
  agent_id: string
  status: string
  task: string
  workspace_path: string
  provider: string
  model: string
  max_steps: number
  environment_id: string
  credential_vault_id: string
  output_contract_type?: 'none' | 'json_schema' | 'regex' | string
  output_contract_payload?: string
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  error?: string
  replay_source_run_id?: string
  replay_from_step?: number
}

export type ChatSession = {
  id: string
  title: string
  agent_id: string
  status: 'active' | 'archived' | string
  created_at: string
  updated_at: string
  archived_at?: string
  pinned_at?: string
  latest_run_id?: string
  latest_run_status?: string
  latest_run_created_at?: string
  run_count?: number
}

export type ChatMessage = {
  id: string
  turn_index: number
  role: 'user' | 'assistant' | 'system' | string
  content: string
  source: string
  run_id?: string
  created_at: string
  updated_at: string
}

export type RunEvent = {
  id: string
  step_id: string
  event_type: string
  seq: number
  payload: Record<string, unknown>
  created_at: string
}

export type Artifact = {
  id: string
  step_id: string
  kind: string
  path: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export type ToolDef = {
  id: string
  name: string
  description: string
  input_schema: Record<string, unknown>
  kind: string
  config_json: Record<string, unknown>
  enabled: boolean
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export type ProviderInfo = {
  provider: string
  supports_tools: boolean
  supports_streaming: boolean
}

export type ProviderConfig = {
  id: string
  provider: string
  name: string
  config_json: string
  created_at: string
  updated_at: string
}

export type ProviderConfigTestResult = {
  ok: boolean
  message: string
  latency_ms: number
}

export type RunStep = {
  id: string
  idx: number
  step_type: string
  status: string
  input_json: string
  output_json: string
  error: string
  created_at: string
  started_at?: string
  ended_at?: string
}

export type ToolCall = {
  id: string
  step_id: string
  tool_name: string
  tool_version?: string
  input_json: string
  output_json: string
  status: string
  started_at?: string
  ended_at?: string
  error_class?: string
  error_message?: string
}

export type TraceSpan = {
  id: string
  parent_id: string
  name: string
  kind: string
  status: string
  started_at?: string
  ended_at?: string
  attrs_json: string
}

export type LLMRequestMessageSummary = {
  role?: string
  name?: string
  tool_call_id?: string
  content_preview?: string
  content_length?: number
  content_parts?: number
  content_part_types?: string[]
  content_part_preview?: string[]
}

export type LLMRequestSnapshot = {
  model?: string
  system_prompt?: string
  system_prompt_len?: number
  message_count?: number
  tool_count?: number
  tool_names?: string[]
  message_role_counts?: Record<string, number>
  messages?: LLMRequestMessageSummary[]
}

export type RunTelemetry = {
  steps: RunStep[]
  tool_calls: ToolCall[]
  spans: TraceSpan[]
  events: Array<{
    id: string
    step_id: string
    event_type: string
    seq: number
    payload_json: string
    created_at: string
  }>
}
