import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = { config: FactoryConfig; updateNested: <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) => void; onNext: () => void; onBack: () => void }

const PRESETS = [
  { name: 'Orange', primary: '#f97316', secondary: '#1e3a5f' }, { name: 'Blue', primary: '#3b82f6', secondary: '#1e293b' },
  { name: 'Green', primary: '#22c55e', secondary: '#14532d' }, { name: 'Red', primary: '#ef4444', secondary: '#1c1917' },
  { name: 'Purple', primary: '#8b5cf6', secondary: '#1e1b4b' }, { name: 'Teal', primary: '#14b8a6', secondary: '#134e4a' },
  { name: 'Slate', primary: '#64748b', secondary: '#0f172a' }, { name: 'Amber', primary: '#f59e0b', secondary: '#292524' },
]

function FileUpload({ label, hint, value, filename, onUpload, onRemove, maxMB = 2, accept = 'image/*' }: {
  label: string; hint: string; value: string | null; filename: string | null
  onUpload: (d: string, n: string) => void; onRemove: () => void; maxMB?: number; accept?: string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-2">{label}</label>
      <div className="relative border-2 border-dashed border-gray-700 rounded-xl p-5 text-center hover:border-gray-600 cursor-pointer min-h-24 flex items-center justify-center">
        {value ? (
          <div>
            <img src={value} alt="preview" className="max-h-16 max-w-full object-contain mx-auto" />
            <div className="text-gray-500 text-xs mt-2">{filename}</div>
            <button onClick={e => { e.preventDefault(); onRemove() }} className="text-red-400 text-xs mt-1">Remove</button>
          </div>
        ) : (
          <div><div className="text-gray-400 text-sm">Click or drag to upload</div><div className="text-gray-600 text-xs mt-1">{hint}</div></div>
        )}
        <input type="file" accept={accept} onChange={e => {
          const f = e.target.files?.[0]; if (!f) return
          if (f.size > maxMB * 1024 * 1024) { alert('Max ' + maxMB + 'MB'); return }
          const r = new FileReader(); r.onload = () => onUpload(r.result as string, f.name); r.readAsDataURL(f)
        }} className="absolute inset-0 opacity-0 cursor-pointer" />
      </div>
    </div>
  )
}

export default function StepBranding({ config, updateNested, onNext, onBack }: Props) {
  const b = config.branding
  const set = (patch: Partial<typeof b>) => updateNested('branding', patch)

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Branding</h2>
      <p className="text-gray-400 text-sm mb-6">Set the visual identity. Colors appear throughout the site and CRM.</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <FileUpload label="Company Logo" hint="PNG, SVG, JPG — max 2MB" value={b.logo} filename={b.logoFilename}
          onUpload={(d, n) => set({ logo: d, logoFilename: n })} onRemove={() => set({ logo: null, logoFilename: null })} />
        <FileUpload label="Favicon" hint="ICO, PNG — max 500KB" value={b.favicon} filename={b.faviconFilename}
          onUpload={(d, n) => set({ favicon: d, faviconFilename: n })} onRemove={() => set({ favicon: null, faviconFilename: null })} maxMB={0.5} accept="image/*,.ico" />
      </div>

      <div className="mb-6">
        <label className="block text-xs text-gray-400 mb-2">Hero Photo <span className="text-gray-600">(optional)</span></label>
        <div className="relative border-2 border-dashed border-gray-700 rounded-xl p-4 hover:border-gray-600 cursor-pointer">
          {b.heroPhoto ? (
            <div className="flex items-center gap-4">
              <img src={b.heroPhoto} alt="hero" className="h-16 w-24 object-cover rounded-lg" />
              <div>
                <div className="text-white text-sm">{b.heroPhotoFilename}</div>
                <button onClick={e => { e.preventDefault(); set({ heroPhoto: null, heroPhotoFilename: null }) }} className="text-red-400 text-xs mt-1">Remove</button>
              </div>
            </div>
          ) : (
            <div className="text-center py-2">
              <div className="text-gray-400 text-sm">Click or drag to upload hero photo</div>
              <div className="text-gray-600 text-xs mt-1">JPG, PNG, WebP — max 5MB</div>
            </div>
          )}
          <input type="file" accept="image/*" onChange={e => {
            const f = e.target.files?.[0]; if (!f || f.size > 5 * 1024 * 1024) return
            const r = new FileReader(); r.onload = () => set({ heroPhoto: r.result as string, heroPhotoFilename: f.name }); r.readAsDataURL(f)
          }} className="absolute inset-0 opacity-0 cursor-pointer" />
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-xs text-gray-400 mb-3">Quick Presets</label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button key={p.name} onClick={() => set({ primaryColor: p.primary, secondaryColor: p.secondary })}
              className={'flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition-all ' + (b.primaryColor === p.primary ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600')}>
              <div className="flex gap-1">
                <div className="w-4 h-4 rounded" style={{ background: p.primary }} />
                <div className="w-4 h-4 rounded" style={{ background: p.secondary }} />
              </div>
              <span className="text-gray-300 text-xs">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {(['primaryColor', 'secondaryColor'] as const).map(key => (
          <div key={key}>
            <label className="block text-xs text-gray-400 mb-2">{key === 'primaryColor' ? 'Primary' : 'Secondary'} Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={b[key]} onChange={e => set({ [key]: e.target.value })}
                className="w-12 h-10 border border-gray-700 rounded-lg cursor-pointer bg-gray-800 p-1" />
              <input value={b[key]} onChange={e => set({ [key]: e.target.value })}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-orange-500" />
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 p-4 bg-gray-800 rounded-xl">
        <div className="text-xs text-gray-500 mb-3">Preview</div>
        <div className="flex gap-3 flex-wrap">
          <div className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: b.primaryColor }}>Primary</div>
          <div className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: b.secondaryColor }}>Secondary</div>
          <div className="px-4 py-2 rounded-lg text-sm font-semibold border-2" style={{ borderColor: b.primaryColor, color: b.primaryColor }}>Outline</div>
        </div>
        <div className="mt-3 h-1 rounded" style={{ background: 'linear-gradient(90deg, ' + b.primaryColor + ', ' + b.secondaryColor + ')' }} />
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  )
}
