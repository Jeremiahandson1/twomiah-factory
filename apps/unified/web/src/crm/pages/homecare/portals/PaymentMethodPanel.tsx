// The card or bank account on file that pays the client's invoices (row 22, care_autopay), as a relative sees it in the family
// portal and the client in theirs: what is on file (brand or bank, last four — never a number), and buttons that open Stripe's
// own page to save or replace it, or remove it. The authorisation wording the family agrees to is shown beside each button
// and again on Stripe's page.
//   GET    <base>/payment-method          → { status, label, methodLabel, expMonth, expYear, pausedReason, methods, wording }
//   POST   <base>/payment-method/setup { method }  → { url }
//   DELETE <base>/payment-method
// (server/crm/homecare/portals/familyPortal.ts for /api/family-portal/portal, clientPortal.ts for /api/portal). A 404 means the
// agency does not take a saved card or bank: the panel shows nothing.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { usePortal } from './portalHttp'

export interface PaymentMethodStatus {
  status: 'none' | 'pending' | 'active' | 'paused'
  label?: string
  methodLabel?: string
  pausedReason?: string | null
  expMonth?: number | null
  expYear?: number | null
  savedBy?: string | null
  methods: { card: boolean; usBank: boolean; cad: boolean }
  wording: { card: string; usBank: string; cad: string }
}

const CARD: CSSProperties = { background: 'var(--hc-surface)', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px' }
const SOFT: CSSProperties = { color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }
const BTN: CSSProperties = { background: 'var(--hcp-navy-fill)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }
const LINK_BTN: CSSProperties = { background: 'transparent', color: 'var(--hcp-navy)', border: '1px solid var(--hcp-navy)', padding: '8px 16px', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }

export default function PaymentMethodPanel({ base, readOnly = false }: { base: string; readOnly?: boolean }) {
  const portal = usePortal()
  const [s, setS] = useState<PaymentMethodStatus | null>(null)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = useCallback(async () => {
    try { const r = await portal.get<PaymentMethodStatus>(`${base}/payment-method`); if (r) setS(r) }
    catch (e) { setGone(true); void e }
  }, [portal, base])
  useEffect(() => { load() }, [load])

  const open = async (method: 'card' | 'us_bank_account' | 'acss_debit') => {
    setBusy(true); setProblem('')
    try {
      const r = await portal.send<{ url: string }>('POST', `${base}/payment-method/setup`, { method })
      if (r?.url) window.location.assign(r.url)
    } catch (e) { setProblem((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setProblem('')
    try {
      await portal.del(`${base}/payment-method`)
      setConfirmRemove(false); await load()
    } catch (e) { setProblem((e as Error).message) } finally { setBusy(false) }
  }

  if (gone || !s) return null
  const onFile = s.status === 'active' || s.status === 'paused'
  const replaceWord = onFile ? 'Replace with' : 'Save'
  type Choice = { key: 'card' | 'us_bank_account' | 'acss_debit'; on: boolean; label: string; wording: string }
  const all: Choice[] = [
    { key: 'card', on: s.methods.card, label: 'a card', wording: s.wording.card },
    { key: 'us_bank_account', on: s.methods.usBank, label: 'a US bank account (ACH debit)', wording: s.wording.usBank },
    { key: 'acss_debit', on: s.methods.cad, label: 'a Canadian bank account (pre-authorized debit)', wording: s.wording.cad },
  ]
  const choices = all.filter((c) => c.on)

  return (
    <div style={CARD}>
      <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>Automatic payment</h3>
      {s.status === 'none' && <p style={SOFT}>Nothing is on file yet. Save a card or bank account and each invoice is paid from it as it is sent — nothing is charged when you save it.</p>}
      {s.status === 'pending' && <p style={SOFT}>Stripe&apos;s page was opened but nothing was saved yet. Open it again to finish.</p>}
      {onFile && (
        <p style={{ margin: '0 0 6px' }}>
          <strong>{s.label}</strong> ({s.methodLabel}){s.expMonth && s.expYear ? `, expires ${String(s.expMonth).padStart(2, '0')}/${s.expYear}` : ''}
          {s.status === 'paused' && <span style={{ color: 'var(--hc-danger-ink)' }}> — paused: {s.pausedReason || 'it can no longer be charged'}. Save a new one.</span>}
        </p>
      )}
      {problem && <p style={{ color: 'var(--hc-danger-ink)', fontSize: '0.85rem' }}>{problem}</p>}
      {!readOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          {choices.map((c) => (
            <div key={c.key}>
              <button type="button" style={BTN} disabled={busy} onClick={() => open(c.key)}>{replaceWord} {c.label}</button>
              <p style={{ ...SOFT, margin: '6px 0 0', fontSize: '0.78rem' }}>By saving, you agree: {c.wording}</p>
            </div>
          ))}
          {choices.length === 0 && <p style={SOFT}>Your agency has not switched on any way of saving a payment method online yet.</p>}
          {onFile && !confirmRemove && <div><button type="button" style={LINK_BTN} disabled={busy} onClick={() => setConfirmRemove(true)}>Remove it</button></div>}
          {onFile && confirmRemove && (
            <div style={{ ...SOFT, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Remove it? Invoices will then need to be paid another way.</span>
              <button type="button" style={BTN} disabled={busy} onClick={remove}>Yes, remove</button>
              <button type="button" style={LINK_BTN} disabled={busy} onClick={() => setConfirmRemove(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
      <p style={{ ...SOFT, marginTop: '10px', fontSize: '0.78rem' }}>Card and account details are entered only on Stripe&apos;s secure page; we keep the last four digits and nothing more.</p>
    </div>
  )
}
