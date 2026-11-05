// "Sold by": who sold a gift card, prepaid package or membership, so the commission plans for those sales can pay them (salon row 15). Shown only
// where the salon has commissions on; the list is the team the book already offers (logins, and stylists with no login).
import { useEffect, useState } from 'react'
import { api, useAuth } from '../../../shared'
import { Field, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

export function SoldBy({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { hasFeature } = useAuth()
  const on = hasFeature('salon_commissions')
  const [team, setTeam] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!on) return
    api.get('/api/team/assignable')
      .then((r: any) => setTeam(((r?.data ?? r) as any[]).filter((m) => m && m.id).map((m) => ({ id: m.id, name: m.name || [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Team member' }))))
      .catch(() => setTeam([]))
  }, [on])
  if (!on || !team.length) return null
  return (
    <Field label="Sold by (optional)" hint="Whoever sold it earns commission on it if a plan covers gift cards, packages or memberships.">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} aria-label="Sold by">
        <option value="">Nobody</option>
        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </Field>
  )
}
