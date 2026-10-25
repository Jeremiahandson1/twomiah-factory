// Kiosk mode on THIS tablet: on, the app shows only /crm/kiosk (KioskLock in crm/verticals/bar.tsx sends every other
// address back to it) until a manager's till PIN stops it. Kept in the browser, so a reload stays locked; storage
// that is blocked or cleared simply leaves the kiosk unlocked, never the app broken.
export const KIOSK_LOCK = 'twomiah.kiosk'

export function kioskLocked(): boolean {
  try { return window.localStorage.getItem(KIOSK_LOCK) === 'on' } catch { return false }
}

export function setKioskLock(on: boolean): void {
  try { if (on) window.localStorage.setItem(KIOSK_LOCK, 'on'); else window.localStorage.removeItem(KIOSK_LOCK) } catch { /* storage blocked */ }
}
