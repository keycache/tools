import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Markdown from '@/components/edge-ai/Markdown'

function render(text: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<Markdown text={text} />)
  return host
}

describe('Markdown', () => {
  it('shows raw HTML as text, never as elements', () => {
    const el = render('Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold</b>\n\n<div onclick="x()">block</div>')
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('[onclick]')).toBeNull()
    expect(el.textContent).toContain('<script>alert(1)</script>')
    expect(el.textContent).toContain('<div onclick="x()">block</div>')
  })

  it('neutralises javascript: links and opens links in a new tab', () => {
    const el = render('[bad](javascript:alert(1)) [good](https://example.com)')
    const links = [...el.querySelectorAll('a')]
    expect(links.some((a) => a.getAttribute('href')?.startsWith('javascript:'))).toBe(false)
    const good = links.find((a) => a.textContent === 'good')!
    expect(good.getAttribute('href')).toBe('https://example.com')
    expect(good.getAttribute('target')).toBe('_blank')
    expect(good.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('does not load remote Markdown images', () => {
    const el = render('![tracker](https://example.com/p.gif)')
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('[image: tracker]')
  })

  it('renders fenced code with a language label and Copy button, and inline code', () => {
    const el = render('Use `npm i` then:\n\n```ts\nconst a = 1\n```')
    const pre = el.querySelector('pre')!
    expect(pre.textContent).toBe('const a = 1\n')
    expect(el.textContent).toContain('ts')
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Copy'))).toBe(true)
    const inline = [...el.querySelectorAll('code')].find((c) => c.textContent === 'npm i')!
    expect(inline.closest('pre')).toBeNull()
  })

  it('renders lists, headings and GFM tables', () => {
    const el = render('# Title\n\n- a\n- b\n\n1. one\n2. two\n\n| x | y |\n|---|--:|\n| 1 | 2 |\n\n~~old~~')
    expect(el.querySelectorAll('ul > li')).toHaveLength(2)
    expect(el.querySelectorAll('ol > li')).toHaveLength(2)
    expect(el.querySelector('h3')?.textContent).toBe('Title')
    expect(el.querySelectorAll('table th')).toHaveLength(2)
    expect(el.querySelectorAll('table td')).toHaveLength(2)
    expect(el.querySelector('del')?.textContent).toBe('old')
  })

  it('tolerates partial Markdown while streaming', () => {
    const el = render('Here:\n\n```py\nprint(1)')
    expect(el.querySelector('pre')?.textContent).toContain('print(1)')
    expect(() => render('**bold without end | a |\n|---')).not.toThrow()
  })
})
