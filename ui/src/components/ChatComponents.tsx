import { api } from '../lib/api'
import type { Artifact } from '../lib/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function ArtifactPreview({
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

export function MarkdownBubble({ text }: { text: string }) {
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
