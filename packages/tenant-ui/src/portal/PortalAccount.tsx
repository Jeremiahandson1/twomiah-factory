// Portal account (salon): this client's memberships (credits left), gift-card balances (last four digits only) and loyalty (points, tier, punch
// card) — read-only (portal.ts GET /p/:token/account, answered by the salon's hook for this client alone).
import React, { useState, useEffect } from 'react'
import { Gift, Star, Ticket } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, Section, card, money } from './common'

interface Membership { id: string; plan: string; status: string; creditsLeft: number | null; creditsTotal: number | null; renewsOn: string | null; priceCents: number | null; cycle: string; pausedForPayment: boolean }
interface GiftCard { id: string; endsWith: string; balanceCents: number; bonusCents: number; bonusExpiresOn: string | null }
interface Loyalty {
  points: number; tier: { name: string; perk: string | null } | null; next: { name: string; pointsToGo: number | null } | null
  punchCard: { required: number; progress: number; remaining: number; rewardsReady: number; reward: string } | null
}
interface Account { memberships: Membership[]; giftCards: GiftCard[]; loyalty: Loyalty | null }

const CYCLE: Record<string, string> = { monthly: 'a month', annual: 'a year', one_time: 'once' }
const day = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) } catch { return iso } }

export function PortalAccount() {
  const { config, fetch: portalFetch } = usePortal()
  const [data, setData] = useState<Account | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/account').then((d) => setData(d)).catch((e) => { setError((e as Error).message); setData({ memberships: [], giftCards: [], loyalty: null }) }) }, [portalFetch])
  if (!data) return <Spinner />
  const nothing = data.memberships.length === 0 && data.giftCards.length === 0 && !data.loyalty
  return (
    <div className="space-y-8">
      <PageTitle title={config.labels.account} subtitle="Your memberships, gift cards and rewards." />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {nothing && <Empty icon={Gift} text="Nothing here yet." />}
      {data.memberships.length > 0 && (
        <Section title={<><Ticket className="w-5 h-5" aria-hidden="true" /> Memberships</>}>
          {data.memberships.map((m) => (
            <div key={m.id} className={`${card} p-5`}>
              <p className="font-semibold text-gray-900 dark:text-slate-100">{m.plan}{m.status === 'paused' ? ' (paused)' : ''}</p>
              {m.creditsLeft != null && <p className="text-sm text-gray-700 dark:text-slate-200">{m.creditsLeft} credit{m.creditsLeft === 1 ? '' : 's'} left{m.creditsTotal != null ? ` of ${m.creditsTotal}` : ''}</p>}
              <p className="text-sm text-gray-600 dark:text-slate-300">
                {m.priceCents != null ? `${money(m.priceCents / 100)} ${CYCLE[m.cycle] || ''}`.trim() : ''}{m.priceCents != null && m.renewsOn ? ' · ' : ''}{m.renewsOn ? `renews ${day(m.renewsOn)}` : ''}
              </p>
              {m.pausedForPayment && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">Paused because the last payment did not go through. Please call us to update your card.</p>}
            </div>
          ))}
        </Section>
      )}
      {data.giftCards.length > 0 && (
        <Section title={<><Gift className="w-5 h-5" aria-hidden="true" /> Gift cards</>}>
          {data.giftCards.map((g) => (
            <div key={g.id} className={`${card} p-5`}>
              <p className="font-semibold text-gray-900 dark:text-slate-100">Card ending {g.endsWith}</p>
              <p className="text-sm text-gray-700 dark:text-slate-200">{money(g.balanceCents / 100)} to spend</p>
              {g.bonusCents > 0 && g.bonusExpiresOn && <p className="text-sm text-gray-600 dark:text-slate-300">{money(g.bonusCents / 100)} of it is a bonus that ends {day(g.bonusExpiresOn)}.</p>}
            </div>
          ))}
        </Section>
      )}
      {data.loyalty && (
        <Section title={<><Star className="w-5 h-5" aria-hidden="true" /> Rewards</>}>
          <div className={`${card} p-5`}>
            <p className="font-semibold text-gray-900 dark:text-slate-100">{data.loyalty.points} point{data.loyalty.points === 1 ? '' : 's'}</p>
            {data.loyalty.tier && <p className="text-sm text-gray-700 dark:text-slate-200">{data.loyalty.tier.name} member{data.loyalty.tier.perk ? ` — ${data.loyalty.tier.perk}` : ''}</p>}
            {data.loyalty.next && data.loyalty.next.pointsToGo != null && <p className="text-sm text-gray-600 dark:text-slate-300">{data.loyalty.next.pointsToGo} more point{data.loyalty.next.pointsToGo === 1 ? '' : 's'} to reach {data.loyalty.next.name}.</p>}
            {data.loyalty.punchCard && (
              <p className="mt-2 text-sm text-gray-700 dark:text-slate-200">
                {data.loyalty.punchCard.rewardsReady > 0 ? `Your ${data.loyalty.punchCard.reward} is ready to use.` : `${data.loyalty.punchCard.progress} of ${data.loyalty.punchCard.required} visits — ${data.loyalty.punchCard.remaining} more for your ${data.loyalty.punchCard.reward}.`}
              </p>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
