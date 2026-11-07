// Salon parity row 9, the public booking page's script (site/public/scripts/book-flow.ts) in a DOM: "+ Add another service" adds a row
// (service, stylist), the days and times are asked for with every service, and the booking is sent with them. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'
import fs from 'node:fs'
import path from 'node:path'

const win: any = new Window({ url: 'https://salon.example.com/book/colour' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
const SCRIPT = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(import.meta.dir, '..', 'site', 'public', 'scripts', 'book-flow.ts'), 'utf8'))
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const options = JSON.stringify([{ slug: 'colour', name: 'Colour', minutes: 60 }, { slug: 'cut', name: 'Cut', minutes: 30 }]).replace(/"/g, '&quot;')

const PAGE = `<div id="book-flow" data-service="colour" data-also-max="2" data-also-options="${options}">
  <ol class="book-progress"><li class="book-progress__step" data-step="date"></li><li class="book-progress__step" data-step="slot"></li><li class="book-progress__step" data-step="form"></li></ol>
  <div class="book-step book-step--date">
    <div class="book-who"><label>Your stylist<select id="book-who" name="who"><option value="">Anyone — first available</option><option value="ana">Ana</option><option value="bea">Bea</option></select></label></div>
    <div class="book-also" id="book-also"><div class="book-also__rows" id="book-also-rows"></div><button type="button" class="book-also__add" id="book-also-add">+ Add another service</button></div>
    <div class="book-dates" id="book-dates"></div>
  </div>
  <div class="book-step book-step--slot" hidden><div class="book-slots" id="book-slots"></div></div>
  <div class="book-step book-step--form" hidden><p id="book-chosen"></p>
    <form id="book-form"><input name="name" value="Vi"><input name="email" value="vi@example.com"><input type="hidden" name="t"><button type="submit">Confirm booking</button><div id="book-error" hidden></div></form>
  </div>
</div>`

describe('the booking page: several services', () => {
  test('a row per service; days, times and the booking carry them', async () => {
    const calls: Array<{ url: string; body?: any }> = []
    ;(globalThis as any).fetch = win.fetch = async (url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
      const data = url.includes('/dates') ? { data: ['2026-11-17'] } : url.includes('/times') ? { data: [{ time: '09:30', label: '9:30 AM' }] } : { token: 'tok', status: 'confirmed' }
      return new win.Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    document.body.innerHTML = PAGE
    new Function(SCRIPT)()
    await settle()
    expect(calls[0].url).toBe('/api/book/services/colour/dates')
    const add = document.getElementById('book-also-add') as any
    add.click(); await settle()
    const svc = document.querySelector('select[aria-label="Service 2"]') as any
    const who = document.querySelector('select[aria-label="Stylist for service 2"]') as any
    expect(who).toBeTruthy()
    svc.value = 'cut'; svc.dispatchEvent(new win.Event('change', { bubbles: true }))
    who.value = 'bea'; who.dispatchEvent(new win.Event('change', { bubbles: true }))
    await settle()
    expect(calls.at(-1)!.url).toBe('/api/book/services/colour/dates?also=cut~bea')
    // one more row: the limit (two more) hides the button
    add.click(); await settle()
    expect(add.hidden).toBe(true)
    ;(document.querySelector('button[aria-label="Remove service 3"]') as any).click(); await settle()
    expect(add.hidden).toBe(false)
    ;(document.querySelector('.book-date') as any).click(); await settle()
    expect(calls.at(-1)!.url).toBe('/api/book/services/colour/times?date=2026-11-17&also=cut~bea')
    ;(document.querySelector('.book-slot') as any).click(); await settle()
    ;(document.getElementById('book-form') as any).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    const sent = calls.at(-1)!
    expect(sent.url).toBe('/api/book/services/colour')
    expect([sent.body.date, sent.body.time, sent.body.also]).toEqual(['2026-11-17', '09:30', [{ service: 'cut', who: 'bea' }]])
  })
})
