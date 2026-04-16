import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconExternalLink } from '@tabler/icons-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import type { Artifact, ChatMessage } from '../lib/types'

type UiMessage = ChatMessage & { role: 'user' | 'assistant' | 'system' | 'thinking' }
type ArtifactReference = { runID: string; artifact: Artifact }
type ImageGalleryItem = { key: string; runID: string; artifact: Artifact; url: string }

export function ChatPage() {
  const qc = useQueryClient()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const dragDepthRef = useRef(0)
  const autoScrollRef = useRef(true)

  const [sessionID, setSessionID] = useState('')
  const [agentID, setAgentID] = useState('')
  const [message, setMessage] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [errorText, setErrorText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [expandedThinkingByID, setExpandedThinkingByID] = useState<Record<string, boolean>>({})
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [composerElevated, setComposerElevated] = useState(false)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const agentsQ = useQuery({ queryKey: queryKeys.agents, queryFn: api.listAgents })
  const sessionsQ = useQuery({ queryKey: queryKeys.chatSessions, queryFn: api.listChatSessions, refetchInterval: 2200 })
  const selectedSessionQ = useQuery({
    queryKey: queryKeys.chatSession(sessionID),
    queryFn: () => api.getChatSession(sessionID),
    enabled: Boolean(sessionID),
    refetchInterval: 2000,
  })
  const messagesQ = useQuery({
    queryKey: queryKeys.chatMessages(sessionID),
    queryFn: () => api.listChatMessages(sessionID),
    enabled: Boolean(sessionID),
    refetchInterval: 1200,
  })

  useEffect(() => {
    if (!agentID && (agentsQ.data ?? []).length > 0) setAgentID((agentsQ.data ?? [])[0].id)
  }, [agentsQ.data, agentID])
  useEffect(() => {
    composerRef.current?.focus()
  }, [sessionID])
  useEffect(() => {
    setIsRenaming(false)
    setRenameValue('')
  }, [sessionID])

  const selectedSession = selectedSessionQ.data ?? null
  const selectedSessionSummary = useMemo(
    () => (sessionsQ.data ?? []).find((session) => session.id === sessionID) ?? null,
    [sessionsQ.data, sessionID],
  )
  const filteredSessions = useMemo(() => {
    const sessions = sessionsQ.data ?? []
    const needle = sessionSearch.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => session.title.toLowerCase().includes(needle))
  }, [sessionsQ.data, sessionSearch])
  const activeSession = Boolean(sessionID && selectedSession)

  const sendMessage = useMutation({
    onMutate: () => {
      setIsAwaitingResponse(true)
    },
    mutationFn: async () => {
      const body = message.trim()
      if (!body) throw new Error('Enter a message')
      let targetSessionID = sessionID
      if (!targetSessionID) {
        if (!agentID.trim()) throw new Error('Select an agent')
        const created = await api.createChatSession({ agent_id: agentID.trim(), title: body.slice(0, 120) })
        targetSessionID = created.id
      }
      const result = await api.sendChatMessage(targetSessionID, { content: body, source: 'chat' })
      if (pendingFiles.length > 0) {
        await api.uploadChatAttachments(targetSessionID, pendingFiles)
      }
      return { ...result, session_id: targetSessionID }
    },
    onSuccess: async (result) => {
      setErrorText('')
      setMessage('')
      setPendingFiles([])
      setSessionID(result.session_id)
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.chatSessions }),
        qc.invalidateQueries({ queryKey: queryKeys.chatSession(result.session_id) }),
        qc.invalidateQueries({ queryKey: queryKeys.chatMessages(result.session_id) }),
        qc.invalidateQueries({ queryKey: queryKeys.runs }),
      ])
    },
    onError: (error) => {
      setIsAwaitingResponse(false)
      setErrorText(error instanceof Error ? error.message : 'Failed to send message')
    },
  })

  const patchSession = useMutation({
    mutationFn: async (payload: { title?: string; archived?: boolean; pinned?: boolean }) => {
      if (!sessionID) throw new Error('No session selected')
      return api.patchChatSession(sessionID, payload)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.chatSessions }),
        qc.invalidateQueries({ queryKey: queryKeys.chatSession(sessionID) }),
      ])
    },
  })

  const runAction = useMutation({
    mutationFn: async (payload: { runID: string; action: 'interrupt' | 'resume' | 'approve' }) => {
      if (payload.action === 'interrupt') return api.interruptRun(payload.runID)
      if (payload.action === 'resume') return api.resumeRun(payload.runID)
      return api.approveRun(payload.runID)
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.chatSessions }),
        qc.invalidateQueries({ queryKey: queryKeys.chatMessages(sessionID) }),
        qc.invalidateQueries({ queryKey: queryKeys.runs }),
      ])
    },
  })

  const uiMessages = useMemo(() => collapseAssistantThinking((messagesQ.data ?? []) as UiMessage[]), [messagesQ.data])
  const runIDsWithArtifacts = useMemo(
    () =>
      Array.from(
        new Set(
          (messagesQ.data ?? []).flatMap((msg) => {
            const refs = extractArtifactLinkRefs(msg.content).map((ref) => ref.runID)
            return [msg.run_id, ...refs]
          }).filter((runID): runID is string => Boolean(runID && runID.trim())),
        ),
      ),
    [messagesQ.data],
  )
  const runArtifactsQueries = useQueries({
    queries: runIDsWithArtifacts.map((runID) => ({
      queryKey: queryKeys.artifacts(runID),
      queryFn: () => api.getRunArtifacts(runID),
      refetchInterval: 2400,
      enabled: activeSession,
    })),
  })
  const artifactsByRunID = useMemo(() => {
    const out = new Map<string, Artifact[]>()
    runIDsWithArtifacts.forEach((runID, idx) => {
      out.set(runID, runArtifactsQueries[idx]?.data ?? [])
    })
    return out
  }, [runArtifactsQueries, runIDsWithArtifacts])
  const imageGallery = useMemo<ImageGalleryItem[]>(() => {
    const out: ImageGalleryItem[] = []
    const seen = new Set<string>()
    for (const msg of uiMessages) {
      const refs = resolveReferencedArtifacts(msg.content, msg.run_id, artifactsByRunID)
      for (const ref of refs) {
        if (!ref.artifact.mime_type.startsWith('image/')) continue
        const key = `${ref.runID}:${ref.artifact.id}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          key,
          runID: ref.runID,
          artifact: ref.artifact,
          url: api.getRunArtifactContentURL(ref.runID, ref.artifact.id),
        })
      }
    }
    return out
  }, [artifactsByRunID, uiMessages])
  const latestRunStatus = (
    selectedSession?.latest_run_status ||
    selectedSessionSummary?.latest_run_status ||
    ''
  ).toLowerCase()
  const showThinking = isAwaitingResponse || isThinkingStatus(latestRunStatus) || sendMessage.isPending
  const selectedAgentName = useMemo(() => {
    const byID = new Map((agentsQ.data ?? []).map((agent) => [agent.id, agent.name]))
    return byID.get(selectedSession?.agent_id || '') || 'Agent'
  }, [agentsQ.data, selectedSession?.agent_id])

  useEffect(() => {
    if (!activeSession) return
    if (!autoScrollRef.current) return
    const el = transcriptRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeSession, uiMessages, showThinking])
  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    setComposerElevated(el.scrollTop > 4)
  }, [activeSession, uiMessages.length])
  useEffect(() => {
    if (!activeSession) return
    if (sendMessage.isPending) return
    if (!latestRunStatus) return
    if (!isThinkingStatus(latestRunStatus)) {
      setIsAwaitingResponse(false)
    }
  }, [activeSession, latestRunStatus, sendMessage.isPending])

  const startNewChat = () => {
    setSessionID('')
    setErrorText('')
    setMessage('')
    setPendingFiles([])
    setExpandedThinkingByID({})
    setIsRenaming(false)
    setRenameValue('')
    setIsAwaitingResponse(false)
    setLightboxOpen(false)
    setLightboxIndex(0)
  }

  const onAttachFiles = (files: FileList | null) => {
    if (!files) return
    setPendingFiles((prev) => [...prev, ...Array.from(files)])
  }

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsFileDragActive(true)
  }

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsFileDragActive(false)
  }

  const handleComposerDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsFileDragActive(false)
    onAttachFiles(event.dataTransfer.files)
  }
  const openLightboxForImage = (runID: string, artifactID: string) => {
    const idx = imageGallery.findIndex((item) => item.runID === runID && item.artifact.id === artifactID)
    if (idx < 0) return
    setLightboxIndex(idx)
    setLightboxOpen(true)
  }
  const showPreviousImage = () => {
    if (imageGallery.length === 0) return
    setLightboxIndex((prev) => (prev - 1 + imageGallery.length) % imageGallery.length)
  }
  const showNextImage = () => {
    if (imageGallery.length === 0) return
    setLightboxIndex((prev) => (prev + 1) % imageGallery.length)
  }
  useEffect(() => {
    if (!lightboxOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false)
      if (event.key === 'ArrowLeft') {
        if (imageGallery.length === 0) return
        setLightboxIndex((prev) => (prev - 1 + imageGallery.length) % imageGallery.length)
      }
      if (event.key === 'ArrowRight') {
        if (imageGallery.length === 0) return
        setLightboxIndex((prev) => (prev + 1) % imageGallery.length)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen, imageGallery.length])

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col">
      <SectionTitle title="Chat" subtitle="Session-native chat with run-level traceability and controls." />
      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center justify-between border-b border-gray-200 pb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{selectedSession?.title || 'New Chat Session'}</p>
                <p className="text-xs text-gray-500">
                  {selectedSession ? `Session ${selectedSession.id}` : 'Pick an agent and send the first message to start.'}
                </p>
              </div>
              {activeSession ? (
                <button
                  type="button"
                  onClick={startNewChat}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  New chat session
                </button>
              ) : null}
              {selectedSession ? (
                <div className="flex items-center gap-2">
                  {selectedSession.latest_run_id ? (
                    <Link to={`/runs/${selectedSession.latest_run_id}`} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                      Open run
                    </Link>
                  ) : null}
                  {isRenaming ? (
                    <>
                      <input
                        className="h-7 w-40 rounded border border-gray-300 px-2 text-xs"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            const next = renameValue.trim()
                            if (!next) return
                            patchSession.mutate({ title: next }, { onSuccess: () => setIsRenaming(false) })
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setIsRenaming(false)
                            setRenameValue('')
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        onClick={() => {
                          const next = renameValue.trim()
                          if (!next) return
                          patchSession.mutate({ title: next }, { onSuccess: () => setIsRenaming(false) })
                        }}
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        setRenameValue(selectedSession.title)
                        setIsRenaming(true)
                      }}
                    >
                      Rename
                    </button>
                  )}
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50" onClick={() => patchSession.mutate({ pinned: !selectedSession.pinned_at })}>
                    {selectedSession.pinned_at ? 'Unpin' : 'Pin'}
                  </button>
                  <button type="button" className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50" onClick={() => patchSession.mutate({ archived: !selectedSession.archived_at })}>
                    {selectedSession.archived_at ? 'Unarchive' : 'Archive'}
                  </button>
                </div>
              ) : null}
            </div>

            {messagesQ.isLoading && activeSession ? <LoadingState label="Loading transcript..." /> : null}
            <QueryErrorState title="Failed to load messages" query={messagesQ} />

            <div
              ref={transcriptRef}
              className="min-h-0 flex-1 space-y-3 overflow-auto pr-1"
              onScroll={() => {
                const el = transcriptRef.current
                if (!el) return
                const distance = el.scrollHeight - el.scrollTop - el.clientHeight
                autoScrollRef.current = distance < 80
                setComposerElevated(el.scrollTop > 4)
              }}
            >
              {!activeSession ? (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6">
                  <div className="w-full max-w-2xl space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Resume a chat session</p>
                      <input
                        className="h-8 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                        placeholder="Search chat sessions..."
                        value={sessionSearch}
                        onChange={(event) => setSessionSearch(event.target.value)}
                      />
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
                        {filteredSessions.slice(0, 10).map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => setSessionID(session.id)}
                            className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-left text-[11px] leading-tight text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                            title={session.title}
                          >
                            <p className="max-w-[220px] truncate font-medium">{session.title}</p>
                            <p className="text-[10px] leading-tight text-gray-500">
                              {session.run_count || 0} run{(session.run_count || 0) === 1 ? '' : 's'}
                            </p>
                          </button>
                        ))}
                        {filteredSessions.length === 0 ? (
                          <div className="rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-500">No matching sessions</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="border-t border-gray-200 pt-4 text-center">
                      <p className="text-sm font-medium text-gray-700">No messages yet</p>
                      <p className="mt-1 text-xs text-gray-500">Start a new chat below, or resume one from the list above.</p>
                    </div>
                  </div>
                </div>
              ) : (
                uiMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[82%] rounded-lg border px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'border-blue-200 bg-blue-50 text-blue-900'
                          : msg.role === 'thinking'
                            ? 'border-violet-200 bg-violet-50 text-violet-900'
                            : msg.role === 'assistant'
                              ? 'border-gray-200 bg-white text-gray-800'
                              : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          {msg.role === 'user' ? 'You' : msg.role === 'thinking' ? `${selectedAgentName} thinking` : msg.role === 'assistant' ? selectedAgentName : 'System'}
                        </p>
                        {msg.run_id ? (
                          <Link
                            to={`/runs/${msg.run_id}`}
                            className="inline-flex items-center rounded border border-gray-200 bg-white p-1 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            title="Open run details"
                            aria-label="Open run details"
                          >
                            <IconExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        {msg.role === 'thinking' ? (
                          <button
                            type="button"
                            className="rounded border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-800 hover:bg-violet-100"
                            onClick={() => setExpandedThinkingByID((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          >
                            {expandedThinkingByID[msg.id] ? 'Hide details' : 'Show details'}
                          </button>
                        ) : null}
                      </div>
                      {msg.role === 'thinking' && !expandedThinkingByID[msg.id] ? (
                        <p>Thinking summary available.</p>
                      ) : (
                        <MarkdownBubble text={msg.content} />
                      )}
                      {(() => {
                        const referencedArtifacts = resolveReferencedArtifacts(
                          msg.content,
                          msg.run_id,
                          artifactsByRunID,
                        )
                        if (referencedArtifacts.length === 0) return null
                        return (
                          <div className="mt-2 space-y-2 border-t border-gray-200/70 pt-2">
                            {referencedArtifacts.map((item) => (
                              <ArtifactPreview
                                key={`${item.runID}:${item.artifact.id}`}
                                runID={item.runID}
                                artifact={item.artifact}
                                onImageOpen={openLightboxForImage}
                              />
                            ))}
                          </div>
                        )
                      })()}
                      {msg.role === 'system' && msg.run_id ? (
                        <div className="mt-2 flex items-center gap-1">
                          <button type="button" className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100" onClick={() => runAction.mutate({ runID: msg.run_id!, action: 'approve' })}>Approve</button>
                          <button type="button" className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100" onClick={() => runAction.mutate({ runID: msg.run_id!, action: 'resume' })}>Resume</button>
                          <button type="button" className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100" onClick={() => runAction.mutate({ runID: msg.run_id!, action: 'interrupt' })}>Interrupt</button>
                          <Link to={`/runs/${msg.run_id}`} className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100">Open run</Link>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {showThinking ? (
                <div className="flex justify-start">
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{selectedAgentName}</p>
                    <div className="flex items-center gap-2">
                      <span>Thinking</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:-0.2s]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:-0.1s]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className={`sticky bottom-0 mt-3 shrink-0 border-t border-gray-200 bg-white pt-3 transition-shadow ${
                composerElevated ? 'shadow-[0_-6px_16px_-14px_rgba(17,24,39,0.45)]' : ''
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                {!activeSession ? (
                  <select
                    className="h-8 w-72 max-w-[35%] rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    value={agentID}
                    onChange={(event) => setAgentID(event.target.value)}
                  >
                    <option value="">Select agent</option>
                    {(agentsQ.data ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                ) : null}
                <p className="text-xs text-gray-500">Drop files into the composer to attach. Slash commands: `/approve`, `/resume`, `/interrupt`, `/open-run`</p>
              </div>
              {pendingFiles.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1">
                  {pendingFiles.map((file, idx) => (
                    <span key={`${file.name}-${idx}`} className="rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
                      {file.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                className="flex items-end gap-2"
                onDragEnter={handleComposerDragEnter}
                onDragOver={handleComposerDragOver}
                onDragLeave={handleComposerDragLeave}
                onDrop={handleComposerDrop}
              >
                <div className="relative flex-1">
                  {isFileDragActive ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-blue-400 bg-blue-50/70 text-sm font-medium text-blue-800">
                      Drop files to attach
                    </div>
                  ) : null}
                <textarea
                  ref={composerRef}
                  className={`min-h-[72px] w-full rounded-md border bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 ${
                    isFileDragActive ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300'
                  }`}
                  placeholder={activeSession ? 'Message the agent...' : 'Start this chat session'}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage.mutateAsync()
                    }
                  }}
                />
                </div>
                <button
                  type="button"
                  className="h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  disabled={sendMessage.isPending || !message.trim()}
                  onClick={() => void sendMessage.mutateAsync()}
                >
                  {sendMessage.isPending ? 'Sending...' : activeSession ? 'Send' : 'Start Chat Session'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">Press Enter to send, Shift+Enter for newline.</p>
              {errorText ? <p className="mt-2 text-xs text-red-600">{errorText}</p> : null}
            </div>
        </div>
      </div>
      {lightboxOpen && imageGallery.length > 0 ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="flex h-[88vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-xl bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
              <p className="truncate text-sm font-medium text-gray-800">
                {imageGallery[lightboxIndex]?.artifact.path || imageGallery[lightboxIndex]?.artifact.id}
              </p>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() => setLightboxOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-gray-950/95">
              <img
                src={imageGallery[lightboxIndex]?.url}
                alt={imageGallery[lightboxIndex]?.artifact.path || 'artifact image'}
                className="h-full w-full object-contain"
              />
              {imageGallery.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-black/50 px-3 py-2 text-xs text-white hover:bg-black/70"
                    onClick={showPreviousImage}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-black/50 px-3 py-2 text-xs text-white hover:bg-black/70"
                    onClick={showNextImage}
                  >
                    Next
                  </button>
                </>
              ) : null}
            </div>
            {imageGallery.length > 1 ? (
              <div className="border-t border-gray-200 bg-white px-3 py-2">
                <div className="flex gap-2 overflow-x-auto">
                  {imageGallery.map((item, idx) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`shrink-0 overflow-hidden rounded border ${
                        idx === lightboxIndex ? 'border-gray-900' : 'border-gray-300'
                      }`}
                      onClick={() => setLightboxIndex(idx)}
                    >
                      <img src={item.url} alt={item.artifact.path || item.artifact.id} className="h-16 w-24 object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function collapseAssistantThinking(messages: UiMessage[]): UiMessage[] {
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

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}...`
}

function isThinkingStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === 'queued' || normalized === 'running'
}

function resolveReferencedArtifacts(
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

function extractArtifactLinkRefs(text: string): Array<{ runID: string; artifactID: string }> {
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

function ArtifactPreview({
  runID,
  artifact,
  onImageOpen,
}: {
  runID: string
  artifact: Artifact
  onImageOpen?: (runID: string, artifactID: string) => void
}) {
  const url = api.getRunArtifactContentURL(runID, artifact.id)
  if (artifact.mime_type.startsWith('image/')) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-gray-500">Image artifact</p>
        <button type="button" className="block" onClick={() => onImageOpen?.(runID, artifact.id)}>
          <img src={url} alt={artifact.path || artifact.id} className="max-h-72 rounded-md border border-gray-200 object-contain" />
        </button>
      </div>
    )
  }
  if (artifact.mime_type.startsWith('video/')) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-gray-500">Video artifact</p>
        <video controls src={url} className="max-h-72 w-full rounded-md border border-gray-200" />
      </div>
    )
  }
  if (artifact.mime_type.startsWith('audio/')) {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-gray-500">Audio artifact</p>
        <audio controls src={url} className="w-full" />
      </div>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
    >
      Open artifact: {artifact.path || artifact.id}
    </a>
  )
}

function MarkdownBubble({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none whitespace-normal text-inherit">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1 whitespace-pre-wrap break-words">{children}</p>,
          code: ({ children }) => <code className="rounded bg-black/5 px-1 py-0.5 text-[12px]">{children}</code>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>,
          img: ({ src, alt }) => <img src={src || ''} alt={alt || 'image'} className="my-2 max-h-80 rounded-md border border-gray-200 object-contain" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
