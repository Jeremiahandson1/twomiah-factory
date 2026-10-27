import { supabase } from '../middleware/auth'
import { MESSAGING_RELOAD_CENTS } from '../config/messagingCosts'
import { withStripeFee } from '../config/domainPricing'

// Prepaid messaging wallet — tenants pre-fund it, and Twilio costs (the one-time
// A2P registration, per-message segments) draw it down AT COST. The $10/mo enable
// fee is billed separately on the subscription and covers the monthly line costs
// (the number + the campaign fee), so those are NEVER debited here — that would
// charge for the line twice (owner, 2026-10-26).
//
// All mutations go through the atomic messaging_wallet_apply() SQL function
// (migrations/2026-07-20_messaging_wallet.sql) so concurrent per-message debits
// can't lose updates. Balance + ledger stay consistent in one transaction.

export type LedgerEntry = {
  id: string
  kind: 'credit' | 'debit'
  amount_cents: number
  reason: string
  twilio_ref: string | null
  stripe_ref: string | null
  balance_after_cents: number
  created_at: string
}

async function apply(
  tenantId: string,
  kind: 'credit' | 'debit',
  cents: number,
  reason: string,
  refs: { twilioRef?: string; stripeRef?: string; allowNegative?: boolean } = {},
): Promise<number> {
  const amount = Math.round(cents)
  const { data, error } = await supabase.rpc('messaging_wallet_apply', {
    p_tenant: tenantId,
    p_kind: kind,
    p_amount: amount,
    p_reason: reason,
    p_twilio_ref: refs.twilioRef ?? null,
    p_stripe_ref: refs.stripeRef ?? null,
    p_allow_negative: refs.allowNegative ?? false,
  })
  if (error) {
    // Surface the SQL RAISE messages ('insufficient balance', 'tenant not found')
    throw new Error(error.message || 'wallet operation failed')
  }
  return data as number // new balance in cents
}

export async function getBalance(tenantId: string): Promise<number> {
  const { data, error } = await supabase.from('tenants').select('messaging_wallet_cents').eq('id', tenantId).single()
  if (error) throw new Error(error.message)
  return data?.messaging_wallet_cents ?? 0
}

export async function getLedger(tenantId: string, limit = 50): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.from('messaging_ledger')
    .select('id, kind, amount_cents, reason, twilio_ref, stripe_ref, balance_after_cents, created_at')
    .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data as LedgerEntry[]) || []
}

export function credit(tenantId: string, cents: number, reason: string, refs?: { twilioRef?: string; stripeRef?: string }): Promise<number> {
  return apply(tenantId, 'credit', cents, reason, refs)
}

/**
 * A credit for one Stripe payment, once: Stripe may deliver the same "paid" event more than once, and every delivery
 * used to credit the wallet again. Skipped (null) when that payment is already on the ledger.
 */
export async function creditOnce(tenantId: string, cents: number, reason: string, stripeRef: string): Promise<number | null> {
  const { data: prior } = await supabase.from('messaging_ledger').select('id').eq('tenant_id', tenantId).eq('kind', 'credit').eq('stripe_ref', stripeRef).limit(1)
  if (prior && prior.length) return null
  return apply(tenantId, 'credit', cents, reason, { stripeRef })
}

// Debit at cost. Throws 'insufficient balance' if it would overdraw (unless
// allowNegative — used for post-paid costs Twilio already charged us, where we
// let the wallet go negative and the tenant tops up to clear it).
export function debit(tenantId: string, cents: number, reason: string, refs?: { twilioRef?: string; allowNegative?: boolean }): Promise<number> {
  return apply(tenantId, 'debit', cents, reason, refs)
}

/**
 * Reload a wallet from the business's card on file — at least MESSAGING_RELOAD_CENTS, and enough to cover `needCents`,
 * plus the card fee. At most one reload per business per day (the Stripe idempotency key). The wallet is credited when
 * Stripe says the invoice was paid (billing.ts); here the answer is only whether the charge went through.
 */
export async function reloadWallet(
  t: { id: string; stripe_customer_id?: string | null },
  needCents = 0,
  deps: { createWalletReloadInvoice?: (o: any) => Promise<{ paid: boolean; hostedUrl?: string | null; error?: string }> } = {},
): Promise<{ paid: boolean; creditCents: number; hostedUrl?: string | null; error?: string }> {
  if (!t.stripe_customer_id) return { paid: false, creditCents: 0, error: 'no card on file' }
  const creditCents = Math.max(MESSAGING_RELOAD_CENTS, Math.ceil(needCents / 100) * 100)
  const create = deps.createWalletReloadInvoice ?? (await import('./factoryStripe')).createWalletReloadInvoice
  const r = await create({ customerId: t.stripe_customer_id, chargeCents: withStripeFee(creditCents), creditCents, tenantId: t.id, key: `wallet-reload-${t.id}-${new Date().toISOString().slice(0, 10)}` })
  return { paid: r.paid, creditCents, hostedUrl: r.hostedUrl, error: r.error }
}

export async function canCover(tenantId: string, cents: number): Promise<boolean> {
  return (await getBalance(tenantId)) >= Math.round(cents)
}
