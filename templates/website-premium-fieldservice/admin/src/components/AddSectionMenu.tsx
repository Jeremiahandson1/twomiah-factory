import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { SECTION_DEFS, type SectionDef } from '../sectionSchema'

interface Props {
  onAdd: (def: SectionDef) => void
}

export function AddSectionMenu({ onAdd }: Props) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-md inline-flex items-center gap-2 w-full justify-center">
        <Plus className="w-4 h-4" />
        Add a section
      </button>
    )
  }

  // Group by type
  const grouped: Record<string, SectionDef[]> = {}
  for (const def of SECTION_DEFS) {
    if (!grouped[def.type]) grouped[def.type] = []
    grouped[def.type].push(def)
  }

  return (
    <div className="card p-4 relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute top-2 right-2 btn-secondary btn-sm"
        aria-label="Close"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="font-semibold text-ink mb-3 pr-8">Add a section</div>
      <div className="space-y-4">
        {Object.entries(grouped).map(([type, defs]) => (
          <div key={type}>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-2">{type}</div>
            <div className="grid grid-cols-1 gap-2">
              {defs.map((def) => (
                <button
                  key={def.type + '/' + def.variant}
                  type="button"
                  onClick={() => { onAdd(def); setOpen(false) }}
                  className="text-left rounded-lg border border-line p-3 hover:border-brand hover:bg-paper transition"
                >
                  <div className="font-semibold text-sm text-ink">{def.label}</div>
                  <div className="text-xs text-muted mt-1">{def.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
