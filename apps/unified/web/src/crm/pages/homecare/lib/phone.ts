// A phone number as people read it: (715) 555-0401 for a ten-digit US number (or 1 + ten), anything else as it was typed.
// Home care live test 11/08: the portal and the referral source showed "7155550401".
export function phoneText(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const d = s.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 && /^[\d\s().+-]+$/.test(s) ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : s
}
