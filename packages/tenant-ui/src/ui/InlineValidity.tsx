// Every form's own "this field is required" message, in the app's words, under the field — never the browser's bubble.
//
// Live test 2026-10-22 (contractor): Add Contact's "Name is required" showed only as the browser's tooltip. Dozens of
// forms across the CRM screens rely on a bare `required` (or type="email", min, max…) on their main field, and on a
// submit the browser answers with its own grey bubble: unstyled, unthemed, gone in a few seconds, in the browser's
// words. One rule for all of them, mounted once at the app's root: when a field fails the browser's check, the bubble is
// cancelled and the app's own message is shown directly under that field, the field is marked aria-invalid and points at
// the message (aria-describedby), and the first one is focused. The message goes when the field is put right.
//
// Forms that check their own fields in code (ContactsPage, EquipmentPage's service record…) show their messages themselves.
import { useEffect } from 'react'

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

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

/**
 * Where the message goes: straight after the field, in the page's flow, so it pushes what is below down rather than
 * covering the next label. A field inside a positioned wrapper (an input with an icon or an eye button laid over it) gets
 * the message after the wrapper, so the overlaid button keeps its place. The node is the page's, not React's: React
 * never renders it, and this removes it the moment the field is put right or leaves the page.
 */
function anchorOf(el: Control): Element {
  const parent = el.parentElement
  if (parent && parent.children.length > 1 && getComputedStyle(parent).position === 'relative' && !parent.matches('label')) return parent
  return el
}

export function InlineValidity() {
  useEffect(() => {
    const shown = new Map<Control, { node: HTMLElement; describedBy: string | null }>()
    let focusedThisSubmit = false
    const forget = (el: Control) => {
      const s = shown.get(el)
      if (!s) return
      s.node.remove()
      el.removeAttribute('aria-invalid')
      if (s.describedBy) el.setAttribute('aria-describedby', s.describedBy); else el.removeAttribute('aria-describedby')
      shown.delete(el)
    }
    const onInvalid = (e: Event) => {
      if (!isControl(e.target)) return
      const el = e.target
      e.preventDefault() // the browser's bubble
      let s = shown.get(el)
      if (!s) {
        const node = document.createElement('p')
        node.id = `field-error-${++seq}`
        node.setAttribute('role', 'alert')
        node.setAttribute('data-field-error', '')
        node.className = 'mt-1 text-sm text-red-700 dark:text-red-300'
        anchorOf(el).insertAdjacentElement('afterend', node)
        s = { node, describedBy: el.getAttribute('aria-describedby') }
        shown.set(el, s)
        el.setAttribute('aria-describedby', [s.describedBy, node.id].filter(Boolean).join(' '))
      }
      s.node.textContent = validityMessage(el)
      el.setAttribute('aria-invalid', 'true')
      // The browser moved the cursor to the first bad field itself; with its bubble cancelled it does not, so this does.
      if (!focusedThisSubmit) { focusedThisSubmit = true; el.focus(); setTimeout(() => { focusedThisSubmit = false }, 0) }
    }
    const onEdit = (e: Event) => {
      if (!isControl(e.target)) return
      const el = e.target
      const s = shown.get(el)
      if (!s) return
      if (el.validity.valid) forget(el); else s.node.textContent = validityMessage(el)
    }
    // A form that closed takes its messages with it; one whose field went while the message stayed is cleared here.
    const observer = new MutationObserver(() => { for (const [el, s] of shown) if (!el.isConnected || !s.node.isConnected) { s.node.remove(); shown.delete(el) } })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('invalid', onInvalid, true)
    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('invalid', onInvalid, true)
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
      for (const el of [...shown.keys()]) forget(el)
    }
  }, [])
  return null
}
