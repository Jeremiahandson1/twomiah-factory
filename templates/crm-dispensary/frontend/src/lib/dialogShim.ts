// Replaces native browser dialogs (alert / confirm / prompt / beforeunload) with
// in-app DOM equivalents. Native dialogs live outside the page DOM, so automated
// browser agents (and our QA tooling) can't see or click them — everything here
// renders inside the app instead. Imported once at the app entry; self-installs.
//
// - alert()   → interactive in-app modal with an OK button (sync-safe: alert returns void).
// - confirm() → in-app modal is shown and the action proceeds (returns true). confirm() must
//               return synchronously, so it can't wait for a click; for flows where a real
//               Cancel matters, call the promise-based confirm() from components/ConfirmModal.
// - prompt()  → in-app modal shown; returns the default value.
// - beforeunload "leave site?" dialogs are suppressed (they block navigation for agents).

const RAW_PRIMARY = '{{PRIMARY_COLOR}}'
const PRIMARY = /^#|^rgb|^hsl/.test(RAW_PRIMARY) ? RAW_PRIMARY : '#2563eb' // fall back if the token wasn't substituted

function ensureRoot(): HTMLElement {
  let root = document.getElementById('app-dialog-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'app-dialog-root'
    document.body.appendChild(root)
  }
  return root
}

function renderModal(opts: { message: string; kind: 'alert' | 'confirm' | 'prompt'; onOk: () => void; onCancel?: () => void }) {
  const root = ensureRoot()
  const overlay = document.createElement('div')
  overlay.setAttribute('data-app-dialog', opts.kind)
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;font-family:inherit'
  const box = document.createElement('div')
  box.style.cssText = 'background:#fff;border-radius:12px;padding:1.5rem;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.2)'
  const msg = document.createElement('p')
  msg.textContent = opts.message
  msg.style.cssText = 'margin:0 0 1.25rem 0;color:#111827;line-height:1.5;font-size:0.95rem;white-space:pre-wrap'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:0.75rem;justify-content:flex-end'
  const ok = document.createElement('button')
  ok.textContent = 'OK'
  ok.setAttribute('data-app-dialog-ok', '')
  ok.style.cssText = `padding:0.6rem 1.25rem;border-radius:8px;border:none;background:${PRIMARY};color:#fff;cursor:pointer;font-weight:600;font-size:0.9rem`
  const close = () => { try { root.removeChild(overlay) } catch {} }
  ok.onclick = () => { close(); opts.onOk() }
  if (opts.onCancel) {
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.setAttribute('data-app-dialog-cancel', '')
    cancel.style.cssText = 'padding:0.6rem 1.25rem;border-radius:8px;border:1px solid #D1D5DB;background:#fff;color:#374151;cursor:pointer;font-weight:500;font-size:0.9rem'
    cancel.onclick = () => { close(); opts.onCancel!() }
    row.appendChild(cancel)
  }
  row.appendChild(ok)
  box.appendChild(msg); box.appendChild(row); overlay.appendChild(box); root.appendChild(overlay)
  ;(ok as HTMLButtonElement).focus()
}

export function installDialogShim() {
  if (typeof window === 'undefined' || (window as any).__dialogShimInstalled) return
  ;(window as any).__dialogShimInstalled = true

  // alert → interactive in-app modal (OK). Sync-safe since alert returns void.
  window.alert = (message?: any) => { renderModal({ message: String(message ?? ''), kind: 'alert', onOk: () => {} }) }

  // confirm → show the message in-app and proceed. Cannot block for a click (sync return).
  window.confirm = (message?: string) => { renderModal({ message: String(message ?? ''), kind: 'confirm', onOk: () => {} }); return true }

  // prompt → show in-app, return the provided default.
  window.prompt = (message?: string, _default?: string) => { renderModal({ message: String(message ?? ''), kind: 'prompt', onOk: () => {} }); return _default ?? '' }

  // Suppress "Leave site?" beforeunload dialogs (native, block navigation for agents).
  const origAdd = window.addEventListener.bind(window)
  window.addEventListener = ((type: string, listener: any, options?: any) => {
    if (type === 'beforeunload') return
    return origAdd(type, listener, options)
  }) as typeof window.addEventListener
  window.onbeforeunload = null
}

installDialogShim()
