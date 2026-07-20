import { supabase } from '../middleware/auth'
import { TWILIO_COSTS } from '../config/messagingCosts'

// Prepaid messaging wallet — tenants pre-fund it, and Twilio costs (A2P
// registration, monthly campaign, per-message segments) draw it down AT COST.
// The $10/mo enable fee is billed separately on the subscription and must NEVER
// be debited here (it carries the margin; the wallet is pass-through only).
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

// Debit at cost. Throws 'insufficient balance' if it would overdraw (unless
// allowNegative — used for post-paid costs Twilio already charged us, where we
// let the wallet go negative and the tenant tops up to clear it).
export function debit(tenantId: string, cents: number, reason: string, refs?: { twilioRef?: string; allowNegative?: boolean }): Promise<number> {
  return apply(tenantId, 'debit', cents, reason, refs)
}

export async function canCover(tenantId: string, cents: number): Promise<boolean> {
  return (await getBalance(tenantId)) >= Math.round(cents)
}

// Recurring at-cost Twilio campaign fee. Charged once per ~month per approved,
// messaging-enabled tenant. "Due" is derived from the ledger (last
// 'monthly_campaign' debit ≥ 27 days ago) — no extra column needed. Uses
// allowNegative: Twilio already billed us, so we let the wallet go negative and
// the tenant tops up to clear it (a negative balance blocks new A2P actions).
export async function chargeMonthlyCampaignFees(): Promise<{ checked: number; charged: number }> {
  const { data: tenants, error } = await supabase.from('tenants').select('id, a2p_phone_number')
    .eq('messaging_enabled', true).eq('a2p_status', 'approved')
  if (error) throw new Error(error.message)
  let charged = 0
  for (const t of tenants || []) {
    const { data: last } = await supabase.from('messaging_ledger')
      .select('created_at').eq('tenant_id', t.id).eq('reason', 'monthly_campaign')
      .order('created_at', { ascending: false }).limit(1)
    const lastAt = last?.[0]?.created_at ? new Date(last[0].created_at).getTime() : 0
    const daysSince = (Date.now() - lastAt) / 86_400_000
    if (daysSince >= 27) {
      // Monthly at-cost recurring = A2P campaign fee + the number's rental (if one is held).
      const amount = TWILIO_COSTS.monthlyCampaignCents + (t.a2p_phone_number ? TWILIO_COSTS.numberMonthlyCents : 0)
      try {
        await debit(t.id, amount, 'monthly_campaign', { allowNegative: true })
        charged++
      } catch (e: any) {
        console.error('[Messaging] monthly campaign debit failed for', t.id, e?.message || e)
      }
    }
  }
  return { checked: (tenants || []).length, charged }
}
