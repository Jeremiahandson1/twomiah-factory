// The store's gift cards at /crm/gift-cards (2026-10-24, the store upgrade): every card with what is left on it and what
// the shop still owes in total, a card's movements (issued, spent on an order, refunded back, corrected, voided), a card
// issued by hand (store credit, a prize) and emailed, a balance corrected, a card voided. Cards sold on the storefront
// are a product whose kind is "Gift card" (Products); they are issued and emailed when the order is paid.
//
// Everything here is orders:refund (server/crm/store/catalog/giftCardRoutes.ts) — a card's number is money — and so is
// the menu item; the page asks it again for each control.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, usePrompt, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { formatMoney, listOf, refusalOf, toHundredths, useStoreCurrency } from './lib'

interface Card {
  id: string; code: string; initialCents: number; balanceCents: number; status: string
  purchaserName: string | null; purchaserEmail: string | null; recipientName: string | null; recipientEmail: string | null
  orderId: string | null; createdAt: string
}
interface Move { id: string; amountCents: number; kind: string; byName: string | null; note: string | null; orderId: string | null; at: string }

const ACTIVE = 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
const VOID = 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'

export default function GiftCardsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const currency = useStoreCurrency()
  const mayManage = useMayWrite('orders:refund')
  const [cards, setCards] = useState<Card[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [moves, setMoves] = useState<Move[]>([])
  const [form, setForm] = useState({ amount: '', name: '', email: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (search = '') => {
    try {
      setCards(listOf<Card>(await api.get('/api/admin/gift-cards', search ? { q: search } : undefined)))
      setLoadError(null)
    } catch (e) { setLoadError(errorText(e, 'Could not load the gift cards')) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const showHistory = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id); setMoves([])
    try { setMoves(listOf<Move>(await api.get(`/api/admin/gift-cards/${encodeURIComponent(id)}/history`))) } catch (e) { toast.error(errorText(e, 'Could not load its history')) }
  }

  const issue = async () => {
    setFormError(null)
    const cents = toHundredths(form.amount)
    if (cents === null || cents < 500 || cents > 50000) { setFormError('A gift card is 5.00 to 500.00.'); return }
    setBusy(true)
    try {
      const card = await api.post('/api/admin/gift-cards', { cents, recipientName: form.name.trim() || null, recipientEmail: form.email.trim() || null }) as Card
      toast.success(form.email.trim() ? `Card ${card.code} issued and emailed` : `Card ${card.code} issued`)
      setForm({ amount: '', name: '', email: '' })
      await load(q)
    } catch (e) {
      const named = Object.values(refusalOf(e).fields).join('; ')
      setFormError(named || errorText(e, 'Could not issue the card'))
    } finally { setBusy(false) }
  }

  const adjust = async (c: Card) => {
    const amount = await prompt(`Add to or take off ${c.code}'s balance (now ${formatMoney(c.balanceCents, currency)}). Use a minus sign to take off, like -5.00.`, { title: 'Correct the balance', confirmText: 'Next', placeholder: '10.00' })
    if (amount === null) return
    const neg = amount.trim().startsWith('-')
    const cents = toHundredths(amount.trim().replace(/^-/, ''))
    if (cents === null || cents === 0) { toast.error('Enter an amount, like 10.00 or -5.00.'); return }
    const reason = await prompt('Why? (kept on the card\'s history)', { title: 'Correct the balance', confirmText: 'Save' })
    if (!reason?.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/admin/gift-cards/${encodeURIComponent(c.id)}/adjust`, { deltaCents: neg ? -cents : cents, reason: reason.trim() })
      toast.success('Balance corrected')
      await load(q); if (open === c.id) { setOpen(null); void showHistory(c.id) }
    } catch (e) { toast.error(errorText(e, 'Could not correct the balance')) } finally { setBusy(false) }
  }

  const voidCard = async (c: Card) => {
    const yes = await confirm(`Void ${c.code}? Its ${formatMoney(c.balanceCents, currency)} can no longer be spent.`, { title: 'Void gift card', confirmText: 'Void' })
    if (!yes) return
    const reason = await prompt('Why is it being voided?', { title: 'Void gift card', confirmText: 'Void' })
    if (!reason?.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/admin/gift-cards/${encodeURIComponent(c.id)}/void`, { reason: reason.trim() })
      toast.success('Card voided')
      await load(q)
    } catch (e) { toast.error(errorText(e, 'Could not void the card')) } finally { setBusy(false) }
  }

  const owed = cards.filter((c) => c.status === 'active').reduce((s, c) => s + c.balanceCents, 0)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Gift cards</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400">Sell them as a product (kind “Gift card” on Products): each is emailed as a number when the order is paid, and spent at checkout.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-600 dark:text-slate-400">Still to be spent</div>
          <div className="text-xl font-bold text-gray-900 dark:text-slate-100">{formatMoney(owed, currency)}</div>
        </div>
      </div>

      <PageError message={loadError} />

      {mayManage && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Issue a card by hand</h2>
          <p className="text-xs text-gray-600 dark:text-slate-400">Store credit, a prize, a replacement. With an email, the number is sent to them.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="label" htmlFor="gc-amt">Amount</label><input id="gc-amt" className="input" inputMode="decimal" placeholder="25.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><label className="label" htmlFor="gc-name">For (name)</label><input id="gc-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label" htmlFor="gc-email">Their email</label><input id="gc-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <PageError message={formError} />
          <button type="button" onClick={issue} disabled={busy} className="btn btn-primary">{busy ? 'Issuing…' : 'Issue card'}</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Find a card number or name" aria-label="Find a card" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(q) }} />
        <button type="button" className="btn btn-secondary" onClick={() => load(q)}>Find</button>
      </div>

      {loading ? <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p> : cards.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">No gift cards yet.</p>
      ) : (
        <div className="card divide-y divide-gray-200 dark:divide-slate-800">
          {cards.map((c) => (
            <div key={c.id} className="p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-gray-900 dark:text-slate-100 break-all">{c.code}</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">{formatDate(c.createdAt)}{c.purchaserEmail ? ` · bought by ${c.purchaserName || c.purchaserEmail}` : c.recipientName ? ` · for ${c.recipientName}` : ''}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.status === 'active' ? ACTIVE : VOID}`}>{codeLabel(c.status)}</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{formatMoney(c.balanceCents, currency)} <span className="font-normal text-gray-600 dark:text-slate-400">of {formatMoney(c.initialCents, currency)}</span></span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => showHistory(c.id)} aria-expanded={open === c.id}>{open === c.id ? 'Hide history' : 'History'}</button>
                {mayManage && c.status === 'active' && <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => adjust(c)}>Correct balance</button>}
                {mayManage && c.status === 'active' && <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs text-red-700 dark:text-red-300" disabled={busy} onClick={() => voidCard(c)}>Void</button>}
              </div>
              {open === c.id && (
                <ul className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                  {moves.length === 0 && <li className="text-gray-600 dark:text-slate-400">Loading…</li>}
                  {moves.map((m) => (
                    <li key={m.id} className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-1 dark:border-slate-800">
                      <span>{codeLabel(m.kind)}{m.note ? ` — ${m.note}` : ''}{m.byName ? ` (${m.byName})` : ''}</span>
                      <span className="whitespace-nowrap">{m.amountCents < 0 ? '−' : '+'}{formatMoney(Math.abs(m.amountCents), currency)} · {formatDate(m.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
