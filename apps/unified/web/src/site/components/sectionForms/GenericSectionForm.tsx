// Renders any section described in sectionFields.ts. Lists of items, string lists, groups, buttons —
// all from the description, so each trade section doesn't need a form of its own.
import { Plus, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Label, Hint, TextField, TextAreaField, ImageUrlField, CtaField, StringListField } from '../Field'
import type { FieldSpec } from '../../sectionFields'

type Data = Record<string, any>

function FieldInput({ spec, value, onChange }: { spec: FieldSpec; value: any; onChange: (v: any) => void }) {
  switch (spec.kind) {
    case 'text':
      return <TextField label={spec.label} hint={spec.hint} placeholder={spec.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'textarea':
      return <TextAreaField label={spec.label} hint={spec.hint} placeholder={spec.placeholder} rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return (
        <TextField label={spec.label} hint={spec.hint} type="number" inputMode="decimal" value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      )
    case 'image':
      return <ImageUrlField label={spec.label} hint={spec.hint} value={value ?? ''} onChange={(v) => onChange(v)} />
    case 'bool':
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          {/* As the page reads it: a defaultOn switch is on until it is set to false, any other only when set to true. */}
          <input type="checkbox" checked={spec.defaultOn ? value !== false : value === true} onChange={(e) => onChange(e.target.checked)} />
          {spec.label}
          {spec.hint && <span className="text-muted text-xs">— {spec.hint}</span>}
        </label>
      )
    case 'choices': {
      const chosen = new Set(Array.isArray(value) ? value.map(String) : [])
      return (
        <fieldset>
          <legend className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">{spec.label}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {spec.options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={chosen.has(o.value)} onChange={(e) => {
                  const next = new Set(chosen)
                  if (e.target.checked) next.add(o.value); else next.delete(o.value)
                  const list = spec.options.map((x) => x.value).filter((v) => next.has(v))
                  onChange(list.length ? list : undefined)
                }} />
                {o.label}
              </label>
            ))}
          </div>
          {spec.hint && <Hint>{spec.hint}</Hint>}
        </fieldset>
      )
    }
    case 'select':
      return (
        <div>
          <Label>{spec.label}</Label>
          <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
            {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {spec.hint && <Hint>{spec.hint}</Hint>}
        </div>
      )
    case 'cta':
      return <CtaField label={spec.label} optional value={{ label: value?.label ?? '', href: value?.href ?? '' }} onChange={(v) => onChange(v.label || v.href ? v : undefined)} />
    case 'strings': {
      const values: string[] = Array.isArray(value) ? value.map((v: any) => String(v ?? '')) : []
      return (
        <StringListField label={spec.label} hint={spec.hint} placeholder={spec.placeholder} addLabel={spec.addLabel} values={values}
          onChange={(next) => onChange(spec.numbers ? next.map((v) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)) : next)} />
      )
    }
    case 'group': {
      const obj: Data = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      return (
        <div>
          <Label>{spec.label}</Label>
          {spec.hint && <Hint>{spec.hint}</Hint>}
          <div className="card card-padding bg-paper mt-2 space-y-3">
            {spec.fields.map((f) => (
              <FieldInput key={f.key} spec={f} value={obj[f.key]}
                onChange={(v) => { const next = { ...obj, [f.key]: v }; onChange(Object.values(next).some((x) => x !== undefined && x !== '') ? next : undefined) }} />
            ))}
          </div>
        </div>
      )
    }
    case 'list': {
      const items: Data[] = Array.isArray(value) ? value : []
      const set = (next: Data[]) => onChange(next)
      const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= items.length) return; const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; set(next) }
      return (
        <div>
          <Label>{spec.label}</Label>
          {spec.hint && <Hint>{spec.hint}</Hint>}
          <div className="mt-2 space-y-3">
            {items.map((item, i) => (
              <div key={i} className="card card-padding bg-paper relative">
                <div className="absolute top-2 right-2 flex gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${spec.itemLabel} ${i + 1} up`}><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="btn-secondary btn-sm disabled:opacity-30" aria-label={`Move ${spec.itemLabel} ${i + 1} down`}><ChevronDown className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => set(items.filter((_, j) => j !== i))} className="btn-secondary btn-sm" aria-label={`Remove ${spec.itemLabel} ${i + 1}`}><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="space-y-3 pr-28">
                  {spec.item.map((f) => (
                    <FieldInput key={f.key} spec={f} value={item?.[f.key]} onChange={(v) => { const next = [...items]; next[i] = { ...item, [f.key]: v }; set(next) }} />
                  ))}
                </div>
              </div>
            ))}
            {(!spec.max || items.length < spec.max) && (
              <button type="button" onClick={() => set([...items, {}])} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Add {spec.itemLabel}
              </button>
            )}
          </div>
        </div>
      )
    }
  }
}

export function GenericSectionForm({ fields, data, onChange }: { fields: FieldSpec[]; data: Data; onChange: (d: Data) => void }) {
  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <FieldInput key={f.key} spec={f} value={data[f.key]} onChange={(v) => {
          const next = { ...data }
          if (v === undefined) delete next[f.key]; else next[f.key] = v
          onChange(next)
        }} />
      ))}
    </div>
  )
}
