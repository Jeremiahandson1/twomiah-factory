// Security review S4 (content and files), 2026-11-13 — docs/review/security/S4-content-files.md.
import { describe, test, expect } from 'bun:test'
import { markdownToHtml, safeLinks } from '../server/site/render.ts'

describe('S4-1: markdown text cannot leave the attribute it is put in', () => {
  test('a link or a picture with a quote in it stays one attribute', () => {
    const link = markdownToHtml(`[menu](/a" onmouseover="window.onerror=eval;throw'=alert\x281\x29')`)
    expect(link).not.toContain('" onmouseover="')
    expect(link).toContain('href="/a&quot; onmouseover=')
    const pic = markdownToHtml('![a" onerror="x](/p.jpg" onerror="y)')
    expect(pic).not.toContain('" onerror="')
    // The ordinary ones are as they were.
    expect(markdownToHtml('[Call us](tel:+15551234567) or [read more](/about)')).toBe('<p><a href="tel:+15551234567">Call us</a> or <a href="/about">read more</a></p>')
    expect(markdownToHtml('![The bar](/media/bar.jpg)')).toBe('<p><img src="/media/bar.jpg" alt="The bar" loading="lazy"></p>')
  })
})

describe('S4-4: every link on a finished page goes somewhere a link may go', () => {
  test('script and data links become #; web, phone, mail and relative links stay', () => {
    const page = [
      '<a href="javascript:alert(1)">a</a>', '<a href="JaVa\tScRiPt:alert(1)">b</a>', '<a href="java&#x09;script:alert(1)">c</a>',
      '<a href="data:text/html,x">d</a>', '<form action="javascript:void(0)">', "<a href='vbscript:x'>e</a>",
      '<a href="https://example.com/x?y=1">f</a>', '<a href="/menu">g</a>', '<a href="contact">h</a>', '<a href="#top">i</a>',
      '<a href="tel:+15551234567">j</a>', '<a href="mailto:a@b.co">k</a>', '<img src="data:image/png;base64,AAAA">', '<img src="/media/a.jpg">',
      '<img src="javascript:alert(1)">',
    ].join('\n')
    const out = safeLinks(page).split('\n')
    expect(out.slice(0, 6)).toEqual(['<a href="#">a</a>', '<a href="#">b</a>', '<a href="#">c</a>', '<a href="#">d</a>', '<form action="#">', '<a href="#">e</a>'])
    expect(out.slice(6, 14)).toEqual(page.split('\n').slice(6, 14))
    expect(out[14]).toBe('<img src="#">')
  })
})
