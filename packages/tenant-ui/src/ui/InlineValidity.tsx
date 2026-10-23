// Every form's own "this field is required" message, in the app's words, under the field — never the browser's bubble.
//
// Live test 2026-10-22 (contractor): Add Contact's "Name is required" showed only as the browser's tooltip. Dozens of
// forms across the CRM screens rely on a bare `required` (or type="email", min, max…) on their main field, and on a
// submit the browser answers with its own grey bubble: unstyled, unthemed, gone in a few seconds, in the browser's
// words. One rule for all of them, mounted once at the app's root: when a field fails the browser's check, the bubble is
// cancelled and the app's own message is shown directly under that field, the field is marked aria-invalid and points at
// the message (aria-describedby), and the first one is focused. The message goes when the field is put right.
//
// The message sits in a layer of its own, placed under the field (position: fixed, following it on scroll), rather than
// inserted into the form: the forms are React's, and a node added inside them would be React's problem. Forms that
// check their own fields in code (ContactsPage, EquipmentPage's service record…) show their messages themselves.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
interface Shown { el: Control; id: string; text: string; top: number; left: number; width: number; describedBy: string | null }

const isControl = (t: EventTarget | null): t is Control =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement

/** What the field is called on screen: its label, else its aria-label, else its placeholder. */
function nameOf(el: Control): string {
  const fromLabel = el.labels && el.labels[0] ? el.labels[0].textContent || '' : ''
  const own = fromLabel || el.getAttribute('aria-label') || ('placeholder' in el ? (el as HTMLInputElement).placeholder : '') || ''
  return own.replace(/\*/g, '').replace(/[:.…]+\s*$/, '').replace(/\s+/g, ' ').trim()
}

export function validityMessage(el: Control): string {
  const v = el.validity
  const name = nameOf(el)
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return name ? `Choose ${name}` : 'Choose one'
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return 'Tick this to go on'
    if (el instanceof HTMLInputElement && el.type === 'file') return name ? `Choose a file for ${name}` : 'Choose a file'
    return name ? `${name} is required` : 'This is required'
  }
  if (v.typeMismatch && el instanceof HTMLInputElement) {
    if (el.type === 'email') return 'Enter an email address, like name@example.com'
    if (el.type === 'url') return 'Enter a full web address, starting with https://'
  }
  if (v.badInput) return 'Enter a number'
  if (v.rangeUnderflow && el instanceof HTMLInputElement) return `${name || 'This'} must be ${el.min} or more`
  if (v.rangeOverflow && el instanceof HTMLInputElement) return `${name || 'This'} must be ${el.max} or less`
  if (v.tooShort && 'minLength' in el) return `${name || 'This'} must be at least ${(el as HTMLInputElement).minLength} characters`
  if (v.patternMismatch) return el.title || `${name || 'This'} is not in the right form`
  if (v.stepMismatch) return `${name || 'This'} is not a value it can take`
  return el.validationMessage
}

let seq = 0

export function InlineValidity() {
  const [shown, setShown] = useState<Shown[]>([])

  useEffect(() => {
    const place = (el: Control) => { const r = el.getBoundingClientRect(); return { top: r.bottom + 4, left: r.left, width: r.width } }
    let focusedThisSubmit = false
    const forget = (s: Shown) => {
      s.el.removeAttribute('aria-invalid')
      if (s.describedBy) s.el.setAttribute('aria-describedby', s.describedBy); else s.el.removeAttribute('aria-describedby')
    }
    const onInvalid = (e: Event) => {
      if (!isControl(e.target)) return
      const el = e.target
      e.preventDefault() // the browser's bubble
      setShown((list) => {
        const old = list.find((s) => s.el === el)
        const id = old?.id || `field-error-${++seq}`
        const describedBy = old ? old.describedBy : el.getAttribute('aria-describedby')
        el.setAttribute('aria-invalid', 'true')
        el.setAttribute('aria-describedby', [describedBy, id].filter(Boolean).join(' '))
        return [...list.filter((s) => s.el !== el), { el, id, text: validityMessage(el), describedBy, ...place(el) }]
      })
      // The browser moved the cursor to the first bad field itself; with its bubble cancelled it does not, so this does.
      if (!focusedThisSubmit) { focusedThisSubmit = true; el.focus(); setTimeout(() => { focusedThisSubmit = false }, 0) }
    }
    const onEdit = (e: Event) => {
      if (!isControl(e.target)) return
      const el = e.target
      setShown((list) => {
        const s = list.find((x) => x.el === el)
        if (!s) return list
        if (el.validity.valid) { forget(s); return list.filter((x) => x !== s) }
        return list.map((x) => (x === s ? { ...x, text: validityMessage(el) } : x))
      })
    }
    // Follow the fields as the page or a dialog scrolls; drop the ones whose form has closed.
    // Unchanged answers the same list, so the layer's own redraw (which the observer also sees) ends there.
    const reflow = () => setShown((list) => {
      if (!list.length) return list
      let changed = false
      const next: Shown[] = []
      for (const s of list) {
        if (!s.el.isConnected || s.el.getClientRects().length === 0) { forget(s); changed = true; continue }
        const p = place(s.el)
        if (p.top !== s.top || p.left !== s.left || p.width !== s.width) { changed = true; next.push({ ...s, ...p }) } else next.push(s)
      }
      return changed ? next : list
    })
    const observer = new MutationObserver(reflow)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('invalid', onInvalid, true)
    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)
    window.addEventListener('scroll', reflow, true)
    window.addEventListener('resize', reflow)
    return () => {
      observer.disconnect()
      document.removeEventListener('invalid', onInvalid, true)
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
      window.removeEventListener('scroll', reflow, true)
      window.removeEventListener('resize', reflow)
    }
  }, [])

  if (typeof document === 'undefined' || !shown.length) return null
  return createPortal(
    <>
      {shown.map((s) => (
        <p key={s.id} id={s.id} role="alert" data-field-error=""
          style={{ position: 'fixed', top: s.top, left: s.left, maxWidth: Math.max(s.width, 220), zIndex: 9999 }}
          className="pointer-events-none rounded-md border border-red-300 bg-white px-2 py-1 text-sm text-red-700 shadow-sm dark:border-red-800 dark:bg-slate-900 dark:text-red-300">
          {s.text}
        </p>
      ))}
    </>,
    document.body,
  )
}
