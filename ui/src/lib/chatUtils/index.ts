import type { Artifact, ChatMessage } from '../types'

export type UiMessage = ChatMessage & { role: 'user' | 'assistant' | 'system' | 'thinking' }
export type ArtifactReference = { runID: string; artifact: Artifact }
export type ImageGalleryItem = { key: string; runID: string; artifact: Artifact; url: string }

export function collapseAssistantThinking(messages: UiMessage[]): UiMessage[] {
  const out: UiMessage[] = []
  let idx = 0
  while (idx < messages.length) {
    const current = messages[idx]
    if (current.role !== 'assistant') {
      out.push(current)
      idx += 1
      continue
    }
    const runID = current.run_id
    const block: UiMessage[] = []
    while (idx < messages.length && messages[idx].role === 'assistant' && messages[idx].run_id === runID) {
      block.push(messages[idx])
      idx += 1
    }
    if (block.length === 1) {
      out.push(block[0])
      continue
    }
    const finalMessage = block[block.length - 1]
    const detail = block.slice(0, -1).map((msg) => `- ${truncate(msg.content, 120)}`).join('\n')
    out.push({
      ...finalMessage,
      id: `${finalMessage.id}:thinking`,
      role: 'thinking',
      content: detail || 'Reviewed prior reasoning steps before final output.',
    })
    out.push(finalMessage)
  }
  return out
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}...`
}

export function isThinkingStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === 'queued' || normalized === 'running'
}

export function isApprovalMessage(msg: UiMessage): boolean {
  const src = String(msg.source || '').trim().toLowerCase()
  if (src === 'approval.requested') return true
  const content = String(msg.content || '').toLowerCase()
  return content.includes('approval') && content.includes('requested')
}

export function resolveReferencedArtifacts(
  text: string,
  fallbackRunID: string | undefined,
  artifactsByRunID: Map<string, Artifact[]>,
): ArtifactReference[] {
  if (!text) return []
  const out: ArtifactReference[] = []
  const seen = new Set<string>()
  const add = (runID: string, artifact: Artifact) => {
    const key = `${runID}:${artifact.id}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ runID, artifact })
  }
  if (fallbackRunID) {
    const artifacts = artifactsByRunID.get(fallbackRunID) ?? []
    if (artifacts.length > 0) {
      const ids = new Set(
        (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map((id) =>
          id.toLowerCase(),
        ),
      )
      for (const artifact of artifacts) {
        if (ids.has(artifact.id.toLowerCase())) add(fallbackRunID, artifact)
      }
    }
  }
  for (const ref of extractArtifactLinkRefs(text)) {
    const artifacts = artifactsByRunID.get(ref.runID) ?? []
    const match = artifacts.find((artifact) => artifact.id.toLowerCase() === ref.artifactID.toLowerCase())
    if (match) add(ref.runID, match)
  }
  return out
}

export function extractArtifactLinkRefs(text: string): Array<{ runID: string; artifactID: string }> {
  if (!text) return []
  const out: Array<{ runID: string; artifactID: string }> = []
  const seen = new Set<string>()
  const pattern = /(?:https?:\/\/[^\s)]+)?\/api\/runs\/([^/\s)]+)\/artifacts\/([^/\s)]+)\/content/gi
  for (const match of text.matchAll(pattern)) {
    const runID = (match[1] ?? '').trim()
    const artifactID = (match[2] ?? '').trim()
    if (!runID || !artifactID) continue
    const key = `${runID}:${artifactID}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ runID, artifactID })
  }
  return out
}
