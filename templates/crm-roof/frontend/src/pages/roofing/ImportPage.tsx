import { useState, useCallback } from 'react'
import { Upload, FileText, X, AlertCircle, CheckCircle2, ArrowRight, Users, Briefcase, FileCheck, Receipt, Link2, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

interface FileEntry {
  file: File
  name: string
  detectedType: 'clients' | 'jobs' | 'unknown'
  preview: any | null
  loading: boolean
}

interface ImportRecord {
  line: number
  id?: string
  type: string
  name: string
  action: string
  linkedTo?: string
}

interface ImportResults {
  dryRun: boolean
  files: Array<{ name: string; type: string }>
  summary: {
    contacts: { imported: number; skipped: number; updated: number; errors: any[]; records: ImportRecord[] }
    jobs: { imported: number; skipped: number; updated: number; errors: any[]; records: ImportRecord[] }
  }
  crossRefStats: { contactsMatched: number; contactsCreated: number; orphanedJobs: number }
}

export default function ImportPage() {
  const { token } = useAuth()
  const toast = useToast()
  const headers = { Authorization: `Bearer ${token}` }

  const [files, setFiles] = useState<FileEntry[]>([])
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResults | null>(null)
  const [createMissing, setCreateMissing] = useState(true)

  const handleFiles = useCallback(async (fileList: FileList) => {
    const newFiles: FileEntry[] = []

    for (const file of Array.from(fileList)) {
      if (!file.name.endsWith('.csv')) {
        toast.error(`${file.name} is not a CSV file`)
        continue
      }

      const entry: FileEntry = {
        file,
        name: file.name,
        detectedType: 'unknown',
        preview: null,
        loading: true,
      }
      newFiles.push(entry)
    }

    setFiles(prev => [...prev, ...newFiles])

    // Preview each file
    for (const entry of newFiles) {
      try {
        const formData = new FormData()
        formData.append('file', entry.file)

        const res = await fetch('/api/import/preview', {
          method: 'POST',
          headers,
          body: formData,
        })
        const data = await res.json()

        setFiles(prev => prev.map(f =>
          f.name === entry.name
            ? { ...f, detectedType: data.type || 'unknown', preview: data, loading: false }
            : f
        ))
      } catch {
        setFiles(prev => prev.map(f =>
          f.name === entry.name ? { ...f, loading: false } : f
        ))
      }
    }
  }, [token])

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
  }

  const runImport = async (dryRun: boolean) => {
    if (files.length === 0) return

    setImporting(true)
    setResults(null)

    try {
      const formData = new FormData()
      for (const entry of files) {
        formData.append('files', entry.file)
      }
      formData.append('dryRun', String(dryRun))
      formData.append('createMissingContacts', String(createMissing))

      const res = await fetch('/api/import/run', {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Import failed')
        return
      }

      const data = await res.json()
      setResults(data)

      if (!dryRun) {
        const total = data.summary.contacts.imported + data.summary.jobs.imported
        toast.success(`Imported ${total} records successfully`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const clientFiles = files.filter(f => f.detectedType === 'clients')
  const jobFiles = files.filter(f => f.detectedType === 'jobs')
  const unknownFiles = files.filter(f => f.detectedType === 'unknown' && !f.loading)
  const hasFiles = files.length > 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Import Data</h1>
        <p className="text-gray-500 mt-1">
          Upload CSV files from Jobber or other platforms. Contacts and jobs will be automatically cross-referenced
          by name, email, and address.
        </p>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2">How cross-referencing works</h3>
        <div className="flex items-center gap-2 text-sm text-blue-800 flex-wrap">
          <span className="flex items-center gap-1"><Users size={14} /> Clients CSV</span>
          <ArrowRight size={14} />
          <span className="flex items-center gap-1"><Briefcase size={14} /> Jobs CSV</span>
          <ArrowRight size={14} />
          <span className="flex items-center gap-1"><FileCheck size={14} /> Quotes</span>
          <span>+</span>
          <span className="flex items-center gap-1"><Receipt size={14} /> Invoices</span>
          <ArrowRight size={14} />
          <span className="flex items-center gap-1 font-semibold"><Link2 size={14} /> All linked</span>
        </div>
        <ul className="text-sm text-blue-700 mt-2 space-y-1">
          <li>- Same person with multiple properties is deduplicated into one contact</li>
          <li>- Jobs match to contacts by name, email, or service address</li>
          <li>- Quote and invoice numbers from jobs CSV create linked records</li>
        </ul>
      </div>

      {/* Drop zone */}
      {!results && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/50 transition cursor-pointer mb-6"
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.multiple = true
            input.accept = '.csv'
            input.onchange = (e) => {
              const target = e.target as HTMLInputElement
              if (target.files) handleFiles(target.files)
            }
            input.click()
          }}
        >
          <Upload className="mx-auto text-gray-400 mb-3" size={40} />
          <p className="text-gray-600 font-medium">Drop CSV files here or click to browse</p>
          <p className="text-gray-400 text-sm mt-1">Upload clients and jobs CSVs — we'll detect the type automatically</p>
        </div>
      )}

      {/* File list */}
      {hasFiles && !results && (
        <div className="space-y-3 mb-6">
          {files.map(entry => (
            <div
              key={entry.name}
              className={`flex items-center justify-between p-4 rounded-lg border ${
                entry.loading ? 'bg-gray-50 border-gray-200' :
                entry.detectedType === 'clients' ? 'bg-green-50 border-green-200' :
                entry.detectedType === 'jobs' ? 'bg-blue-50 border-blue-200' :
                'bg-yellow-50 border-yellow-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {entry.loading ? (
                  <Loader2 size={18} className="text-gray-400 animate-spin" />
                ) : entry.detectedType === 'clients' ? (
                  <Users size={18} className="text-green-600" />
                ) : entry.detectedType === 'jobs' ? (
                  <Briefcase size={18} className="text-blue-600" />
                ) : (
                  <AlertCircle size={18} className="text-yellow-600" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{entry.name}</p>
                  <p className="text-sm text-gray-500">
                    {entry.loading ? 'Analyzing...' :
                     entry.detectedType === 'clients' ? `Clients — ${entry.preview?.rowCount || 0} rows` :
                     entry.detectedType === 'jobs' ? `Jobs — ${entry.preview?.rowCount || 0} rows` :
                     'Could not detect type'}
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(entry.name) }}
                className="text-gray-400 hover:text-red-500 p-1"
              >
                <X size={16} />
              </button>
            </div>
          ))}

          {unknownFiles.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
              <AlertCircle size={14} className="inline mr-1" />
              {unknownFiles.length} file(s) could not be auto-detected. They will be skipped unless you re-upload with recognizable column headers.
            </div>
          )}

          {/* Options */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={e => setCreateMissing(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-gray-700">
                Auto-create contacts for jobs that don't match any existing client
              </span>
            </label>
          </div>

          {/* Import order explanation */}
          {clientFiles.length > 0 && jobFiles.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
              <CheckCircle2 size={14} className="text-green-500" />
              Import order: {clientFiles.length} client file(s) first, then {jobFiles.length} job file(s) with cross-referencing
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => runImport(true)}
              disabled={importing || files.every(f => f.loading)}
              className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              {importing ? <><Loader2 size={16} className="inline animate-spin mr-2" />Previewing...</> : 'Preview (Dry Run)'}
            </button>
            <button
              onClick={() => runImport(false)}
              disabled={importing || files.every(f => f.loading)}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {importing ? <><Loader2 size={16} className="inline animate-spin mr-2" />Importing...</> : 'Import Now'}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Contacts Created"
              value={results.summary.contacts.imported}
              icon={<Users size={20} />}
              color="green"
            />
            <SummaryCard
              label="Jobs Created"
              value={results.summary.jobs.imported}
              icon={<Briefcase size={20} />}
              color="blue"
            />
            <SummaryCard
              label="Cross-Referenced"
              value={results.crossRefStats.contactsMatched}
              icon={<Link2 size={20} />}
              color="purple"
            />
            <SummaryCard
              label="Quotes + Invoices"
              value={
                results.summary.jobs.records.filter(r => r.type === 'quote' || r.type === 'invoice').length
              }
              icon={<FileText size={20} />}
              color="amber"
            />
          </div>

          {results.dryRun && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
              <AlertCircle size={16} className="inline mr-2" />
              This was a dry run — nothing was saved. Click "Import Now" to commit these changes.
            </div>
          )}

          {/* Contacts updated / skipped */}
          {(results.summary.contacts.updated > 0 || results.summary.contacts.skipped > 0) && (
            <div className="text-sm text-gray-500">
              Contacts: {results.summary.contacts.updated} updated, {results.summary.contacts.skipped} skipped (duplicates/archived)
            </div>
          )}

          {/* Errors */}
          {(results.summary.contacts.errors.length > 0 || results.summary.jobs.errors.length > 0) && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-800 mb-2">
                <AlertCircle size={16} className="inline mr-1" />
                Errors ({results.summary.contacts.errors.length + results.summary.jobs.errors.length})
              </h3>
              <ul className="text-sm text-red-700 space-y-1 max-h-40 overflow-y-auto">
                {[...results.summary.contacts.errors, ...results.summary.jobs.errors].map((err, i) => (
                  <li key={i}>Line {err.line}: {err.error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Detailed records */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Import Details</h3>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {[...results.summary.contacts.records, ...results.summary.jobs.records].map((record, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    record.action === 'created' || record.action === 'auto_created' || record.action === 'would_create' ? 'bg-green-500' :
                    record.action === 'updated' ? 'bg-blue-500' :
                    record.action === 'deduplicated' ? 'bg-purple-500' :
                    'bg-gray-400'
                  }`} />
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    record.type === 'contact' ? 'bg-green-100 text-green-700' :
                    record.type === 'job' ? 'bg-blue-100 text-blue-700' :
                    record.type === 'quote' ? 'bg-amber-100 text-amber-700' :
                    record.type === 'invoice' ? 'bg-purple-100 text-purple-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {record.type}
                  </span>
                  <span className="text-gray-900 font-medium truncate">{record.name}</span>
                  <span className="text-gray-400 text-xs">{record.action}</span>
                  {record.linkedTo && (
                    <span className="text-gray-400 text-xs flex items-center gap-1 ml-auto flex-shrink-0">
                      <Link2 size={10} /> {record.linkedTo}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions after results */}
          <div className="flex gap-3">
            {results.dryRun ? (
              <>
                <button
                  onClick={() => runImport(false)}
                  disabled={importing}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {importing ? <><Loader2 size={16} className="inline animate-spin mr-2" />Importing...</> : 'Import Now'}
                </button>
                <button
                  onClick={() => { setResults(null); setFiles([]) }}
                  className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition"
                >
                  Start Over
                </button>
              </>
            ) : (
              <button
                onClick={() => { setResults(null); setFiles([]) }}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition"
              >
                Import More
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  }

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1 opacity-70">{icon}<span className="text-xs font-medium">{label}</span></div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}
