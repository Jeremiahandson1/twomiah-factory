import { Plus, X } from 'lucide-react'
import { Label, TextField, TextAreaField, ImageUrlField, Hint } from '../Field'

interface Member { name?: string; role?: string; bio?: string; portrait?: string }
interface Data { heading?: string; intro?: string; members?: Member[] }

export function TeamGridForm({ data, onChange }: { data: Data; onChange: (d: Data) => void }) {
  const members = data.members || []
  const update = (patch: Partial<Data>) => onChange({ ...data, ...patch })
  const updateMember = (i: number, patch: Partial<Member>) => {
    const next = [...members]
    next[i] = { ...next[i], ...patch }
    update({ members: next })
  }
  const removeMember = (i: number) => update({ members: members.filter((_, j) => j !== i) })
  const addMember = () => update({ members: [...members, { name: '', role: '', bio: '', portrait: '' }] })

  return (
    <div className="space-y-4">
      <TextField label="Heading" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />
      <div>
        <Label>Team members</Label>
        <Hint>Reflect the actual scale of the business — don't pad with fabricated names.</Hint>
        <div className="mt-2 space-y-3">
          {members.map((m, i) => (
            <div key={i} className="card card-padding bg-paper relative">
              <button type="button" onClick={() => removeMember(i)} className="absolute top-2 right-2 btn-secondary btn-sm" aria-label="Remove member">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="space-y-3 pr-8">
                <TextField label="Name" value={m.name || ''} onChange={(e) => updateMember(i, { name: e.target.value })} />
                <TextField label="Role" value={m.role || ''} onChange={(e) => updateMember(i, { role: e.target.value })} />
                <TextAreaField label="One-line bio (optional)" rows={2} value={m.bio || ''} onChange={(e) => updateMember(i, { bio: e.target.value })} />
                <ImageUrlField label="Portrait" value={m.portrait || ''} onChange={(v) => updateMember(i, { portrait: v })} uploadTag="team" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addMember} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add member
          </button>
        </div>
      </div>
    </div>
  )
}
