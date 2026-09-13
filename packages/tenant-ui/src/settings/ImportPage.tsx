// Settings → Import — ONE page for every CRM (vendored into each template as ../shared).
// CSV import with preview, per-vertical entity types (gated on the tenant's features) and contact types.
// Before: six versions — every non-contractor one called /import/... without the /api prefix (404), the
// fieldservice/landscaping one read a `preview` key the backend never sends (crash), and the "View" link
// after an import pointed outside /crm.
import React, { useState } from 'react'
import { Upload, Download, FileText, X, AlertCircle, Loader2, Users, FolderKanban, Briefcase, Package, Receipt, CalendarCheck, DoorOpen, UtensilsCrossed } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import type { SettingsApi, ImportConfig, ImportTypeDef } from './integrationsTypes'

export const DEFAULT_IMPORT_TYPES: ImportTypeDef[] = [
  { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
  { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
  { id: 'jobs', label: 'Jobs', description: 'Import work orders and jobs', feature: 'jobs' },
  { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
  { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from Jobber, HousecallPro or QuickBooks' },
]
export const DEFAULT_IMPORT_CONTACT_TYPES = [
  { value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }, { value: 'subcontractor', label: 'Subcontractor' },
]
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { contacts: Users, projects: FolderKanban, jobs: Briefcase, products: Package, invoices: Receipt, events: CalendarCheck, spaces: DoorOpen, menus: UtensilsCrossed }

interface PreviewData { valid?: boolean; error?: string; rowCount: number; columns: string[]; sample: Record<string, string>[] }
interface ImportResults { total: number; imported: number; skipped: number; errors?: { row: number; error: string }[] }

export function ImportPage({ api, config }: { api: SettingsApi; config?: ImportConfig }) {
  const { hasFeature } = useAuth()
  const types = (config?.types || DEFAULT_IMPORT_TYPES).filter((t) => !t.feature || hasFeature(t.feature))
  const contactTypes = config?.contactTypes || DEFAULT_IMPORT_CONTACT_TYPES
  const [selectedType, setSelectedType] = useState<string>(types[0]?.id || 'contacts')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState({ skipDuplicates: true, updateExisting: false, defaultType: config?.defaultContactType || contactTypes[0]?.value || 'client', createMissingContacts: true })
  const current = types.find((t) => t.id === selectedType) || types[0]

  const reset = () => { setFile(null); setPreview(null); setResults(null); setError(null) }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected); setResults(null); setError(null)
    try {
      const fd = new FormData(); fd.append('file', selected)
      const data = (await api.upload(`/api/import/preview/${selectedType}`, fd)) as PreviewData
      if (!data || data.valid === false) { setError(data?.error || 'This file could not be read. Check that it is a valid CSV.'); setPreview(null); return }
      setPreview(data)
    } catch (err) { setError((err as Error).message || 'Failed to preview file'); setPreview(null) }
  }
  const handleImport = async () => {
    if (!file) return
    setImporting(true); setError(null); setResults(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      for (const [k, v] of Object.entries(options)) fd.append(k, String(v))
      setResults((await api.upload(`/api/import/${selectedType}`, fd)) as ImportResults)
    } catch (err) { setError((err as Error).message || 'Import failed') } finally { setImporting(false) }
  }
  const downloadTemplate = () => window.open(`${api.baseUrl || ''}/api/import/template/${selectedType}`, '_blank')

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Import Data</h1>
        <p className="text-gray-500 dark:text-slate-400">{config?.intro || 'Import contacts, projects, jobs, and more from CSV files'}</p>
      </div>

      <div className="bg-white rounded-xl border p-6 dark:bg-slate-900 dark:border-slate-800">
        <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">What do you want to import?</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {types.map((type) => { const Icon = ICONS[type.id] || FileText; const active = selectedType === type.id; return (
            <button key={type.id} onClick={() => { setSelectedType(type.id); reset() }} aria-pressed={active} className={`p-4 rounded-lg border-2 text-left transition-all ${active ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10' : 'border-gray-200 dark:border-slate-700 hover:border-gray-300'}`}>
              <Icon className={`w-6 h-6 mb-2 ${active ? 'text-orange-600' : 'text-gray-400'}`} />
              <p className="font-medium text-gray-900 dark:text-slate-100">{type.label}</p>
              <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{type.description}</p>
            </button>) })}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 flex items-center justify-between gap-4">
        <div><p className="font-medium text-blue-900 dark:text-blue-300">Need a template?</p><p className="text-sm text-blue-700 dark:text-blue-400">Download a sample CSV with the correct format</p></div>
        <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"><Download className="w-4 h-4" />Download Template</button>
      </div>

      <div className="bg-white rounded-xl border p-6 dark:bg-slate-900 dark:border-slate-800">
        <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Upload CSV File</h2>
        {!file ? (
          <label className="block border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors">
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-1 dark:text-slate-400">Drop your CSV file here or click to browse</p>
            <p className="text-sm text-gray-400">Maximum file size: 10MB</p>
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" data-testid="import-file-input" />
          </label>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg dark:bg-slate-800">
              <div className="flex items-center gap-3"><FileText className="w-8 h-8 text-orange-500" /><div><p className="font-medium text-gray-900 dark:text-slate-100">{file.name}</p><p className="text-sm text-gray-500 dark:text-slate-400">{(file.size / 1024).toFixed(1)} KB{preview ? ` • ${preview.rowCount} rows` : ''}</p></div></div>
              <button onClick={reset} aria-label="Remove file" className="p-2 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {preview && !results && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2 dark:text-slate-100">Preview (first {Math.min(5, (preview.sample || []).length)} rows)</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border rounded-lg overflow-hidden dark:border-slate-700" data-testid="import-preview">
                    <thead className="bg-gray-50 dark:bg-slate-800"><tr>{(preview.columns || []).map((col, i) => <th key={i} className="px-3 py-2 text-left font-medium text-gray-700 border-b dark:text-slate-200 dark:border-slate-700">{col}</th>)}</tr></thead>
                    <tbody>{(preview.sample || []).slice(0, 5).map((row, i) => <tr key={i} className="border-b last:border-0 dark:border-slate-700">{(preview.columns || []).map((col, j) => <td key={j} className="px-3 py-2 text-gray-600 truncate max-w-48 dark:text-slate-400">{row[col]}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {file && !results && (
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Import Options</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3"><input type="checkbox" checked={options.skipDuplicates} onChange={(e) => setOptions({ ...options, skipDuplicates: e.target.checked })} className="w-4 h-4 rounded border-gray-300" /><span className="text-gray-700 dark:text-slate-200">Skip duplicate records</span></label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={options.updateExisting} onChange={(e) => setOptions({ ...options, updateExisting: e.target.checked })} className="w-4 h-4 rounded border-gray-300" /><span className="text-gray-700 dark:text-slate-200">Update existing records if found</span></label>
            {selectedType === 'invoices' && <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={options.createMissingContacts !== false} onChange={(e) => setOptions({ ...options, createMissingContacts: e.target.checked })} className="w-4 h-4 rounded border-gray-300" /><span className="text-gray-700 dark:text-slate-200">Create customers that do not exist yet (recommended — an invoice with no customer is hard to use)</span></label>}
            {selectedType === 'contacts' && (
              <div className="flex items-center gap-3"><span className="text-gray-700 dark:text-slate-200">Default contact type:</span>
                <select value={options.defaultType} onChange={(e) => setOptions({ ...options, defaultType: e.target.value })} className="px-3 py-1.5 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white">{contactTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div role="alert" className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-xl flex items-center gap-3"><AlertCircle className="w-5 h-5 flex-shrink-0" /><span>{error}</span></div>}

      {results && (
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Import Results</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded-lg dark:bg-slate-800"><p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{results.total}</p><p className="text-sm text-gray-500 dark:text-slate-400">Total Rows</p></div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg"><p className="text-3xl font-bold text-green-600">{results.imported}</p><p className="text-sm text-gray-500 dark:text-slate-400">Imported</p></div>
            <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg"><p className="text-3xl font-bold text-yellow-600">{results.skipped}</p><p className="text-sm text-gray-500 dark:text-slate-400">Skipped</p></div>
          </div>
          {results.errors && results.errors.length > 0 && (
            <div><h3 className="font-medium text-gray-900 mb-2 dark:text-slate-100">Errors ({results.errors.length})</h3>
              <div className="max-h-40 overflow-y-auto space-y-1">{results.errors.map((err, i) => <div key={i} className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded">Row {err.row}: {err.error}</div>)}</div></div>
          )}
          <div className="mt-6 flex gap-3">
            <button onClick={reset} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">Import More</button>
            <a href={`/crm/${selectedType}`} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-center">View {current?.label}</a>
          </div>
        </div>
      )}

      {file && preview && !results && (
        <div className="flex justify-end">
          <button onClick={handleImport} disabled={importing} className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
            {importing ? <><Loader2 className="w-5 h-5 animate-spin" />Importing...</> : <><Upload className="w-5 h-5" />Import {preview.rowCount} Records</>}
          </button>
        </div>
      )}
    </div>
  )
}
