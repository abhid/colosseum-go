export function parseTimeMs(value?: string): number {
  if (!value) return NaN
  const n = Date.parse(value)
  return Number.isNaN(n) ? NaN : n
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return `${h}h ${remM}m`
}

export function parseJSONStringRecord(value: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export function prettyJSON(value: string): string {
  const parsed = parseJSONStringRecord(value)
  if (parsed) return JSON.stringify(parsed, null, 2)
  return value || '{}'
}

export function tryParseJSON(value: string): Record<string, unknown> | string {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return value
  }
}
