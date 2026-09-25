// The floor — the booths, tables and bar seats the floor phone draws. Names
// here are what shows on the phone and on grill tickets ("Booth 2 · Seat 3").
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api } from '../api/client'
import { Hint } from './Field'

interface Table { id?: string; name: string; kind: 'booth' | 'table' | 'bar'; seats: number }

export function FloorCard() {
  const [tables, setTables] = useState<Table[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { api.get<{ floor: { tables: Table[] } }>('/api/admin/floor').then((r) => setTables(r.floor.tables)).catch((e) => setMsg({ ok: false, text: e.message })) }, [])
  if (!tables) return null
  const set = (i: number, patch: Partial<Table>) => setTables(tables.map((t, n) => (n === i ? { ...t, ...patch } : t)))
  const save = async () => {
    setMsg(null)
    try { const r = await api.put<{ floor: { tables: Table[] } }>('/api/admin/floor', { tables }); setTables(r.floor.tables); setMsg({ ok: true, text: 'Saved. The floor phone shows it on its next refresh.' }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink mb-1">Floor layout</h2>
      <p className="text-muted text-sm mb-4">The booths, tables and bar seats on the floor phone (<code>/register/floor</code>). Seats set how many seat buttons a table gets for ordering by seat.</p>
      {msg && <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{msg.text}</div>}
      <ul className="divide-y divide-line border border-line rounded-lg mb-3">
        {tables.map((t, i) => (
          <li key={i} className="grid grid-cols-[1fr_120px_90px_auto] gap-2 items-center px-3 py-2">
            <input className="input" aria-label={`Name of table ${i + 1}`} value={t.name} onChange={(e) => set(i, { name: e.target.value })} />
            <select className="input" aria-label={`Kind of ${t.name}`} value={t.kind} onChange={(e) => set(i, { kind: e.target.value as Table['kind'] })}>
              <option value="booth">Booth</option><option value="table">Table</option><option value="bar">Bar seat</option>
            </select>
            <input className="input" aria-label={`Seats at ${t.name}`} inputMode="numeric" value={t.seats} onChange={(e) => set(i, { seats: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
            <button type="button" className="btn-secondary btn-sm inline-flex items-center" aria-label={`Remove ${t.name}`} onClick={() => setTables(tables.filter((_, n) => n !== i))}><X className="w-3 h-3" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => setTables([...tables, { name: `Table ${tables.filter((t) => t.kind === 'table').length + 1}`, kind: 'table', seats: 4 }])}><Plus className="w-4 h-4" />Add</button>
        <button type="button" className="btn-primary inline-flex items-center" onClick={save}>Save floor</button>
      </div>
      <Hint>Renaming a table doesn't move checks already open on it; close those first.</Hint>
    </section>
  )
}
