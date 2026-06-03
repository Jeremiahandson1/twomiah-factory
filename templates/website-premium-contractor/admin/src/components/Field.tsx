import { type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Plus, X, Image as ImageIcon } from 'lucide-react'

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">
      {children}
    </label>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted mt-1">{children}</div>
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}
export function TextField({ label, hint, id, ...rest }: TextFieldProps) {
  const inputId = id || `f-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <input id={inputId} className="input" {...rest} />
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}
export function TextAreaField({ label, hint, id, rows = 3, ...rest }: TextAreaFieldProps) {
  const inputId = id || `f-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <textarea id={inputId} rows={rows} className="input" {...rest} />
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

interface ImageUrlFieldProps {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}
export function ImageUrlField({ label, hint, value, onChange }: ImageUrlFieldProps) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2 items-stretch">
        <div className="w-20 h-20 rounded-lg border border-line bg-paper overflow-hidden grid place-items-center shrink-0">
          {value
            ? <img src={value} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            : <ImageIcon className="w-6 h-6 text-muted" />
          }
        </div>
        <input
          type="text"
          placeholder="https://… (paste a URL; photo library picker lands in #22c)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input"
        />
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

interface CtaFieldProps {
  label: string
  value: { label: string; href: string }
  onChange: (v: { label: string; href: string }) => void
  optional?: boolean
}
export function CtaField({ label, value, onChange, optional }: CtaFieldProps) {
  return (
    <div>
      <Label>{label}{optional && <span className="text-muted font-normal normal-case tracking-normal ml-1">(optional)</span>}</Label>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Button label"
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="Link (e.g. contact, services, https://…)"
          value={value.href}
          onChange={(e) => onChange({ ...value, href: e.target.value })}
          className="input"
        />
      </div>
    </div>
  )
}

interface StringListFieldProps {
  label: string
  hint?: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  multiline?: boolean
  addLabel?: string
}
export function StringListField({ label, hint, values, onChange, placeholder, multiline, addLabel = 'Add item' }: StringListFieldProps) {
  const update = (i: number, v: string) => {
    const next = [...values]
    next[i] = v
    onChange(next)
  }
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i))
  const add = () => onChange([...values, ''])
  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2 items-start">
            {multiline ? (
              <textarea
                rows={3}
                value={v}
                placeholder={placeholder}
                onChange={(e) => update(i, e.target.value)}
                className="input flex-1"
              />
            ) : (
              <input
                type="text"
                value={v}
                placeholder={placeholder}
                onChange={(e) => update(i, e.target.value)}
                className="input flex-1"
              />
            )}
            <button type="button" onClick={() => remove(i)} className="btn-secondary btn-sm shrink-0 mt-1" aria-label="Remove">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={add} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </button>
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

interface Stat { value: string; label: string }
interface StatsFieldProps {
  label: string
  hint?: string
  values: Stat[]
  onChange: (v: Stat[]) => void
}
export function StatsField({ label, hint, values, onChange }: StatsFieldProps) {
  const update = (i: number, patch: Partial<Stat>) => {
    const next = [...values]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i))
  const add = () => onChange([...values, { value: '', label: '' }])
  return (
    <div>
      <Label>{label}{<span className="text-muted font-normal normal-case tracking-normal ml-1">(optional)</span>}</Label>
      <div className="space-y-2">
        {values.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-start">
            <input
              type="text"
              placeholder="Value (e.g. 16 yrs)"
              value={s.value}
              onChange={(e) => update(i, { value: e.target.value })}
              className="input"
            />
            <input
              type="text"
              placeholder="Label (e.g. In business)"
              value={s.label}
              onChange={(e) => update(i, { label: e.target.value })}
              className="input"
            />
            <button type="button" onClick={() => remove(i)} className="btn-secondary btn-sm" aria-label="Remove">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={add} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add stat
        </button>
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}
