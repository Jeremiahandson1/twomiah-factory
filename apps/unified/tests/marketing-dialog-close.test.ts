// Closing a dialog (salon live test, 2026-10-25, the email editor): Escape in the editor's link panel closed the whole
// campaign dialog, and an email's worth of work went with one Escape. The shared Modal (packages/tenant-ui
// invoicing/ui.tsx), in a real DOM:
//   · Escape closes the TOP dialog only — a confirm over a form, not the form too;
//   · an Escape a control already handled (preventDefault) closes nothing — the editor's panel closes itself;
//   · `dirty` asks with the app's own confirm before Escape, the backdrop or × throws work away;
//   · a caller that does not opt in closes on Escape exactly as before.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/marketing' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
// .tsx screens by a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const UI = '../../../packages/tenant-ui/src/invoicing/ui.tsx'
const CONFIRM = '../../../packages/tenant-ui/src/ui/ConfirmProvider.tsx'
const EDITOR = '../../../packages/tenant-ui/src/marketing/EmailEditor.tsx'
const { Modal } = await import(UI) as any
const { ConfirmProvider } = await import(CONFIRM) as any
const { EmailEditor } = await import(EDITOR) as any
const h = React.createElement as any

const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const escape = async (target: any = document) => { await act(async () => { target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }); await settle() }
const dialogs = () => [...document.querySelectorAll('[role=dialog]')].map((d: any) => d.getAttribute('aria-label'))

async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(h(ConfirmProvider, null, node)) })
  await settle()
  return root
}

/** A dialog that stays open until its onClose runs, counting the closes. */
function Harness({ dirty, inner, children }: { dirty?: boolean; inner?: boolean; children?: any }) {
  const [open, setOpen] = React.useState(true)
  const [innerOpen, setInnerOpen] = React.useState(!!inner)
  ;(globalThis as any).__closed = (globalThis as any).__closed ?? 0
  return h(React.Fragment, null,
    h(Modal, { isOpen: open, onClose: () => { (globalThis as any).__closed++; setOpen(false) }, title: 'Outer', dirty }, children || h('p', null, 'form')),
    h(Modal, { isOpen: innerOpen, onClose: () => setInnerOpen(false), title: 'Inner', size: 'sm' }, h('p', null, 'on top')))
}

describe('the shared Modal', () => {
  test('a caller that does not opt in closes on Escape, as before', async () => {
    ;(globalThis as any).__closed = 0
    const root = await mount(h(Harness, {}))
    expect(dialogs()).toEqual(['Outer'])
    await escape()
    expect(dialogs()).toEqual([])
    expect((globalThis as any).__closed).toBe(1)
    root.unmount()
  })

  test('Escape closes the top dialog only', async () => {
    ;(globalThis as any).__closed = 0
    const root = await mount(h(Harness, { inner: true }))
    expect(dialogs()).toEqual(['Outer', 'Inner'])
    await escape()
    expect(dialogs()).toEqual(['Outer'])
    expect((globalThis as any).__closed).toBe(0)
    root.unmount()
  })

  test('an Escape a control already handled closes nothing', async () => {
    ;(globalThis as any).__closed = 0
    const root = await mount(h(Harness, {}, h('input', { id: 'box', onKeyDown: (e: any) => { if (e.key === 'Escape') e.preventDefault() } })))
    await escape(document.getElementById('box'))
    expect(dialogs()).toEqual(['Outer'])
    root.unmount()
  })

  test('unsaved work: Escape asks with the app\'s own confirm; Escape on the confirm keeps the work; Discard closes', async () => {
    ;(globalThis as any).__closed = 0
    const root = await mount(h(Harness, { dirty: true }))
    await escape()
    expect(dialogs()).toEqual(['Outer', 'Discard changes?'])
    expect((globalThis as any).__closed).toBe(0)
    await escape() // closes the confirm (answer: no), not the form under it
    expect(dialogs()).toEqual(['Outer'])
    expect((globalThis as any).__closed).toBe(0)
    // the backdrop asks too
    await act(async () => { (document.querySelector('[aria-label="Outer"] .bg-black\\/60') as any).click() }); await settle()
    expect(dialogs()).toEqual(['Outer', 'Discard changes?'])
    const discard = [...document.querySelectorAll('button')].find((b: any) => b.textContent === 'Discard') as any
    await act(async () => { discard.click() }); await settle()
    expect(dialogs()).toEqual([])
    expect((globalThis as any).__closed).toBe(1)
    root.unmount()
  })
})

describe('the email editor inside a dialog', () => {
  test('Escape in the link panel closes the panel, not the dialog', async () => {
    ;(globalThis as any).__closed = 0
    const editor = h(EmailEditor, { value: '<p>Hi</p>', onChange: () => {}, fields: [] })
    const root = await mount(h(Harness, {}, editor))
    const link = [...document.querySelectorAll('button')].find((b: any) => (b.textContent || '').trim() === 'Link') as any
    await act(async () => { link.click() }); await settle()
    const input = document.querySelector('[data-testid=email-editor] input') as any
    expect(input).not.toBeNull()
    await escape(input)
    expect(document.querySelector('[data-testid=email-editor] input')).toBeNull()
    expect(dialogs()).toEqual(['Outer'])
    expect((globalThis as any).__closed).toBe(0)
    root.unmount()
  })
})
