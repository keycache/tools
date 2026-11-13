import { memo, type ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton } from '@/components/edge-ai/shared'

interface HastLike {
  type: string
  value?: string
  children?: HastLike[]
}

function hastText(node: HastLike | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

function CodeBlock({ node, children }: ComponentProps<'pre'> & { node?: HastLike }) {
  const code = hastText(node).replace(/\n$/, '')
  const codeEl = node?.children?.[0] as (HastLike & { properties?: { className?: string[] } }) | undefined
  const lang = codeEl?.properties?.className?.find((c) => c.startsWith('language-'))?.slice(9)
  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{lang || 'code'}</span>
        <CopyButton text={code} className="h-6 px-2 text-xs" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{children}</pre>
    </div>
  )
}

const components: Components = {
  pre: CodeBlock,
  code: ({ className, children }) =>
    className?.startsWith('language-') || String(children).includes('\n') ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 text-[0.95rem] font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2 mb-1 font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-2 mb-1 font-semibold first:mt-0">{children}</h6>,
  h5: ({ children }) => <h6 className="mt-2 mb-1 font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children, className }) => (
    <ul className={className?.includes('contains-task-list') ? 'my-2 space-y-1' : 'my-2 list-disc space-y-1 pl-5'}>{children}</ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border bg-background/60 px-2 py-1 font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border px-2 py-1 align-top">
      {children}
    </td>
  ),
  img: ({ alt }) => <span className="text-muted-foreground">[image{alt ? `: ${alt}` : ''}]</span>,
}

/**
 * Safe Markdown for model output: GFM (tables, task lists, strikethrough), no raw HTML (no `rehype-raw`, so HTML is
 * shown as text), remote images are not loaded, links open in a new tab.
 */
export default memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
