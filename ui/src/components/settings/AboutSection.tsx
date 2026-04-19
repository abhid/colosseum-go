export function AboutSection() {
  return (
    <section data-section="about" id="section-about" className="scroll-mt-24 space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">About</h3>
        <p className="mt-0.5 text-xs text-gray-500">Environment variables and server-level configuration.</p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p>
          The server reads provider credentials from environment variables by default:{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">OPENAI_API_KEY</code> and{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">ANTHROPIC_API_KEY</code>. Named provider
          configurations above can override these at the per-configuration level via{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">api_key</code> and{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">base_url</code>.
        </p>
      </div>
    </section>
  )
}
