import { describe, expect, it } from 'vitest'
import { officeSections } from '@/lib/base64/office'

describe('safe Office content previews', () => {
  it('extracts paragraphs without rendering document markup or external references', () => {
    const sections = officeSections([{ name: 'word/document.xml', xml: '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>&lt;script&gt;bad()&lt;/script&gt;</w:t></w:r></w:p></w:document>' }])
    expect(sections[0].text).toBe('<script>bad()</script>')
  })

  it('preserves empty spreadsheet columns and reads shared strings and cached values without evaluating formulas', () => {
    const sections = officeSections([
      { name: 'xl/sharedStrings.xml', xml: '<sst><si><t>Hello</t></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', xml: '<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+2</f><v>3</v></c><c r="D1"><f>WEBSERVICE("https://example.com")</f></c></row></worksheet>' },
    ])
    expect(sections[0].rows).toEqual([['Hello', '', '3', '=WEBSERVICE("https://example.com")']])
  })

  it('rejects malformed XML, entity declarations and missing shared strings', () => {
    for (const xml of ['<broken>', '<!DOCTYPE x [<!ENTITY a "bad">]><x/>', '<worksheet><row><c r="A1" t="s"><v>99</v></c></row></worksheet>']) {
      expect(() => officeSections([{ name: 'xl/worksheets/sheet1.xml', xml }])).toThrow()
    }
  })

  it('caps the total rendered cells across sheets instead of multiplying the per-sheet limits', () => {
    const row = Array.from({ length: 26 }, (_, index) => `<c r="${String.fromCharCode(65 + index)}1"><v>1</v></c>`).join('')
    const xml = `<worksheet>${`<row>${row}</row>`.repeat(200)}</worksheet>`
    const sections = officeSections([{ name: 'xl/worksheets/sheet1.xml', xml }, { name: 'xl/worksheets/sheet2.xml', xml }])
    expect(sections.reduce((count, section) => count + (section.rows?.reduce((cells, values) => cells + values.length, 0) ?? 0), 0)).toBe(2000)
  })
})
