export function pickPreferredOpenAIModel(models: string[], current: string) {
  const trimmedCurrent = current.trim()
  if (trimmedCurrent && models.includes(trimmedCurrent)) return trimmedCurrent
  const preferredOrder = ['gpt-5.4', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o']
  for (const candidate of preferredOrder) {
    if (models.includes(candidate)) return candidate
  }
  return models[0] || trimmedCurrent || 'gpt-5.4'
}

export function providerDisplayName(provider: string) {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'anthropic') return 'Anthropic'
  if (!normalized) return ''
  return normalized[0].toUpperCase() + normalized.slice(1)
}

export function formatProviderModel(provider: string, model: string) {
  const p = provider.trim()
  const m = model.trim()
  if (!p && !m) return ''
  const label = providerDisplayName(p || 'openai')
  if (!m) return `${label}/`
  return `${label}/${m}`
}

export function parseProviderModelInput(value: string, providerIDs: string[], fallbackProvider: string) {
  const raw = value.trim()
  const fallback = fallbackProvider || providerIDs[0] || ''
  if (!raw) return { provider: fallback, model: '' }
  const slash = raw.indexOf('/')
  if (slash < 0) {
    return { provider: fallback, model: raw }
  }
  const providerPart = raw.slice(0, slash).trim().toLowerCase()
  const modelPart = raw.slice(slash + 1).trim()
  const matchedProvider =
    providerIDs.find((p) => p.toLowerCase() === providerPart) ||
    providerIDs.find((p) => providerDisplayName(p).toLowerCase() === providerPart) ||
    fallback
  return { provider: matchedProvider, model: modelPart }
}
