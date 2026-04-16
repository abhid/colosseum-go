export function parseStarterPrompts(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  )
}

export type AgentConfigPatch = {
  name?: string
  description?: string
  provider?: string
  model?: string
  system_prompt?: string
  starter_prompts_text?: string
  default_task?: string
  allowed_tools?: string[]
}

export function parseAgentConfigText(text: string, format: 'yaml' | 'json'): { ok: true; patch: AgentConfigPatch } | { ok: false; error: string } {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Agent config cannot be empty.' }
  const data = format === 'json' ? parseAgentConfigJSON(raw) : parseAgentConfigYAML(raw)
  if (data.ok === false) return { ok: false, error: data.error }
  const out: AgentConfigPatch = {}
  const value = data.value
  if (typeof value.name === 'string') out.name = value.name
  if (typeof value.description === 'string') out.description = value.description
  if (typeof value.system === 'string') out.system_prompt = value.system
  if (typeof value.default_task === 'string') out.default_task = value.default_task
  if (Array.isArray(value.starter_prompts)) out.starter_prompts_text = value.starter_prompts.map((v) => String(v)).join('\n')
  if (Array.isArray(value.tools)) {
    out.allowed_tools = value.tools
      .map((tool) => (tool && typeof tool === 'object' ? String((tool as Record<string, unknown>).type ?? '').trim() : ''))
      .filter(Boolean)
  }
  if (typeof value.model === 'string') {
    const parsedModel = parseModelFromConfig(value.model)
    out.provider = parsedModel.provider
    out.model = parsedModel.model
  }
  return { ok: true, patch: out }
}

function parseAgentConfigJSON(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Agent config JSON must be an object.' }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON.' }
  }
}

function parseAgentConfigYAML(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const lines = raw.split('\n')
    const out: Record<string, unknown> = {}
    let i = 0
    for (; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim() || line.trimStart().startsWith('#')) continue
      if (line.startsWith('  ')) continue
      const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
      if (!match) return { ok: false, error: `Invalid YAML near line ${i + 1}.` }
      const key = match[1]
      const inline = match[2]
      if (inline) {
        out[key] = parseYAMLScalar(inline)
        continue
      }
      const list: unknown[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const child = lines[j]
        if (!child.trim()) continue
        if (!child.startsWith('  - ')) break
        const itemRaw = child.slice(4).trim()
        if (itemRaw.includes(':')) {
          const kv = itemRaw.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
          if (!kv) return { ok: false, error: `Invalid list item near line ${j + 1}.` }
          list.push({ [kv[1]]: parseYAMLScalar(kv[2]) })
        } else {
          list.push(parseYAMLScalar(itemRaw))
        }
      }
      out[key] = list
      i = j - 1
    }
    return { ok: true, value: out }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid YAML.' }
  }
}

function parseYAMLScalar(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "''" || trimmed === '""') return ''
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

function parseModelFromConfig(raw: string) {
  const normalized = raw.trim()
  if (!normalized) return { provider: 'openai', model: '' }
  const slash = normalized.indexOf('/')
  if (slash < 0) return { provider: 'openai', model: normalized }
  const providerPart = normalized.slice(0, slash).trim().toLowerCase()
  const modelPart = normalized.slice(slash + 1).trim()
  if (!providerPart) return { provider: 'openai', model: modelPart }
  if (providerPart === 'openai' || providerPart === 'anthropic') return { provider: providerPart, model: modelPart }
  return { provider: providerPart, model: modelPart }
}

export function toSimpleYAML(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>)
          if (entries.length === 0) return `${pad}- {}`
          const [firstKey, firstVal] = entries[0]
          const firstLine = `${pad}- ${firstKey}: ${toSimpleYAMLScalar(firstVal)}`
          const restLines = entries
            .slice(1)
            .map(([k, v]) => `${'  '.repeat(indent + 1)}${k}: ${toSimpleYAMLScalar(v)}`)
            .join('\n')
          return restLines ? `${firstLine}\n${restLines}` : firstLine
        }
        return `${pad}- ${toSimpleYAMLScalar(item)}`
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([key, val]) => {
        if (Array.isArray(val)) {
          if (val.length === 0) return `${pad}${key}: []`
          return `${pad}${key}:\n${toSimpleYAML(val, indent + 1)}`
        }
        if (val && typeof val === 'object') {
          return `${pad}${key}:\n${toSimpleYAML(val, indent + 1)}`
        }
        return `${pad}${key}: ${toSimpleYAMLScalar(val)}`
      })
      .join('\n')
  }
  return `${pad}${toSimpleYAMLScalar(value)}`
}

function toSimpleYAMLScalar(value: unknown): string {
  if (value === null || value === undefined) return "''"
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const raw = String(value)
  if (!raw) return "''"
  if (/^[A-Za-z0-9._:/-]+$/.test(raw)) return raw
  return `'${raw.replace(/'/g, "''")}'`
}
