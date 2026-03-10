import React, { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../../services/api'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ParseResult {
  fileId: string
  columns: string[]
  totalRows: number
  sampleRows: Record<string, string>[]
  autoMapping: Record<string, string>
  filename: string
  fileSize: number
}

interface ColumnMapping {
  [fileColumn: string]: string
}

interface ValidationError {
  row: number
  field: string
  value: string
  error: string
}

interface ValidationResult {
  valid: boolean
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  errors: ValidationError[]
  warnings: ValidationError[]
  preview: Record<string, any>[]
  newCategories: string[]
}

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: number
  errorDetails: ValidationError[]
  createdCategories: string[]
}

interface ImportHistoryEntry {
  id: string
  filename: string
  importType: string
  totalRows: number
  importedRows: number
  errorRows: number
  status: string
  created_at: string
}

type ImportType = 'pricebook' | 'estimator'
type ConflictMode = 'skip' | 'update' | 'replace'
type Step = 1 | 2 | 3 | 4

// ─── Field definitions ─────────────────────────────────────────────────────────

const PRICEBOOK_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'categoryName', label: 'Category Name', required: true },
  { key: 'productName', label: 'Product Name', required: true },
  { key: 'tier', label: 'Tier (good/better/best)', required: false },
  { key: 'measurementType', label: 'Measurement Type', required: false },
  { key: 'minValue', label: 'Min Value', required: false },
  { key: 'maxValue', label: 'Max Value', required: false },
  { key: 'parPrice', label: 'Par Price', required: true },
  { key: 'retailPrice', label: 'Retail Price', required: true },
  { key: 'yr1MarkupPct', label: '1-Year Markup %', required: false },
  { key: 'day30MarkupPct', label: '30-Day Markup %', required: false },
  { key: 'todayDiscountPct', label: 'Today Discount %', required: false },
]

const ESTIMATOR_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'categoryName', label: 'Category Name', required: true },
  { key: 'productName', label: 'Product Name', required: true },
  { key: 'tier', label: 'Tier (good/better/best)', required: false },
  { key: 'materialName', label: 'Material Name', required: true },
  { key: 'materialCostPerUnit', label: 'Material Cost/Unit', required: true },
  { key: 'laborRate', label: 'Labor Rate', required: true },
  { key: 'laborUnit', label: 'Labor Unit', required: false },
  { key: 'manufacturer', label: 'Manufacturer', required: false },
  { key: 'warrantyYears', label: 'Warranty Years', required: false },
  { key: 'wasteFactor', label: 'Waste Factor', required: false },
  { key: 'measurementUnit', label: 'Measurement Unit', required: false },
  { key: 'setupFee', label: 'Setup Fee', required: false },
  { key: 'minimumCharge', label: 'Minimum Charge', required: false },
]

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [step, setStep] = useState<Step>(1)
  const [importType, setImportType] = useState<ImportType>('pricebook')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [conflictMode, setConflictMode] = useState<ConflictMode>('skip')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [history, setHistory] = useState<ImportHistoryEntry[]>([])
  const [dragOver, setDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch history on mount
  useEffect(() => {
    fetchHistory()
  }, [])

  const fetchHistory = async () => {
    try {
      const res = await api.get('/api/import/history')
      setHistory(res.data?.history || [])
    } catch {
      // Ignore
    }
  }

  const fields = importType === 'pricebook' ? PRICEBOOK_FIELDS : ESTIMATOR_FIELDS
  const requiredFields = fields.filter(f => f.required).map(f => f.key)
  const mappedTargets = Object.values(mapping)
  const allRequiredMapped = requiredFields.every(rf => mappedTargets.includes(rf))

  // ─── Step 1: File Upload ───────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    if (file.size > 10 * 1024 * 1024) {
      setError('File exceeds 10MB limit.')
      return
    }
    const ext = file.name.toLowerCase().split('.').pop()
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      setError('Unsupported file type. Please upload CSV or XLSX.')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('importType', importType)
      const res = await api.post('/api/import/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data = res.data
      setParseResult(data)
      setMapping(data.autoMapping || {})
      setStep(2)
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to parse file')
    } finally {
      setLoading(false)
    }
  }, [importType])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  // ─── Step 2: Column Mapping ────────────────────────────────────────────────

  const updateMapping = (fileColumn: string, targetField: string) => {
    setMapping(prev => {
      const next = { ...prev }
      // Remove any existing mapping to this target
      if (targetField) {
        for (const [k, v] of Object.entries(next)) {
          if (v === targetField && k !== fileColumn) {
            delete next[k]
          }
        }
        next[fileColumn] = targetField
      } else {
        delete next[fileColumn]
      }
      return next
    })
  }

  const handleAutoDetect = () => {
    if (parseResult) {
      const auto = parseResult.autoMapping
      setMapping(auto)
    }
  }

  // ─── Step 3: Validate ─────────────────────────────────────────────────────

  const handleValidate = async () => {
    if (!parseResult) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.post('/api/import/validate', {
        fileId: parseResult.fileId,
        mapping,
        importType,
      })
      setValidationResult(res.data)
      setStep(3)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  // ─── Step 4: Execute Import ────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parseResult || !validationResult) return
    setImporting(true)
    setError(null)
    setStep(4)

    // Simulate progress
    let progressInterval: ReturnType<typeof setInterval> | null = null
    let currentProgress = 0
    progressInterval = setInterval(() => {
      currentProgress += Math.random() * 15
      if (currentProgress > 90) currentProgress = 90
      setImportProgress(Math.round(currentProgress))
    }, 300)

    try {
      const res = await api.post('/api/import/execute', {
        fileId: parseResult.fileId,
        mapping,
        importType,
        onConflict: conflictMode,
      })
      if (progressInterval) clearInterval(progressInterval)
      setImportProgress(100)
      setImportResult(res.data)
      fetchHistory()
    } catch (err: any) {
      if (progressInterval) clearInterval(progressInterval)
      setError(err.response?.data?.error || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep(1)
    setParseResult(null)
    setMapping({})
    setValidationResult(null)
    setImportResult(null)
    setConflictMode('skip')
    setError(null)
    setImporting(false)
    setImportProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import Data</h1>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <React.Fragment key={s}>
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step >= s
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s}
            </div>
            {s < 4 && (
              <div
                className={`flex-1 h-1 rounded ${
                  step > s ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="flex gap-2 mb-2 text-sm text-gray-500">
        <span className="flex-1 text-center">Upload</span>
        <span className="flex-1 text-center">Map Columns</span>
        <span className="flex-1 text-center">Validate</span>
        <span className="flex-1 text-center">Import</span>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-start gap-3">
          <span className="text-red-500 mt-0.5 text-lg">!</span>
          <div className="flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xl leading-none">&times;</button>
        </div>
      )}

      {/* ─── STEP 1: Upload ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Import Type Toggle */}
          <div className="flex gap-3">
            <button
              onClick={() => setImportType('pricebook')}
              className={`flex-1 py-3 px-4 rounded-lg text-base font-semibold border-2 transition-colors ${
                importType === 'pricebook'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              Pricebook Import
            </button>
            <button
              onClick={() => setImportType('estimator')}
              className={`flex-1 py-3 px-4 rounded-lg text-base font-semibold border-2 transition-colors ${
                importType === 'estimator'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              Estimator Import
            </button>
          </div>

          {/* Template Downloads */}
          <div className="flex gap-3">
            <a
              href="/api/import/template/pricebook"
              download
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Download Pricebook Template
            </a>
            <a
              href="/api/import/template/estimator"
              download
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Download Estimator Template
            </a>
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
            }`}
            style={{ minHeight: 200 }}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-600">Parsing file...</p>
              </div>
            ) : (
              <>
                <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-base font-medium text-gray-700 mb-1">
                  Drop CSV or XLSX here, or click to browse
                </p>
                <p className="text-sm text-gray-500">Maximum file size: 10MB</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* ─── STEP 2: Map Columns ────────────────────────────────────────────── */}
      {step === 2 && parseResult && (
        <div className="space-y-6">
          {/* File Info */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900">{parseResult.filename}</p>
              <p className="text-sm text-gray-500">
                {parseResult.totalRows} rows &middot; {parseResult.columns.length} columns &middot;{' '}
                {(parseResult.fileSize / 1024).toFixed(1)} KB
              </p>
            </div>
            <button
              onClick={handleAutoDetect}
              className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              Auto-Detect
            </button>
          </div>

          {/* Mapping Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 gap-0 border-b border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Twomiah Field</p>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Your File Column</p>
            </div>
            <div className="divide-y divide-gray-100">
              {fields.map((field) => {
                const mappedCol = Object.entries(mapping).find(([, v]) => v === field.key)?.[0] || ''
                const isAutoMapped = parseResult.autoMapping[mappedCol] === field.key && mappedCol !== ''
                return (
                  <div
                    key={field.key}
                    className={`grid grid-cols-2 gap-4 px-4 py-3 items-center ${
                      isAutoMapped ? 'bg-green-50' : ''
                    }`}
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </span>
                      {field.required && !mappedTargets.includes(field.key) && (
                        <span className="ml-2 text-xs text-red-500 font-medium">Not mapped</span>
                      )}
                    </div>
                    <div>
                      <select
                        value={mappedCol}
                        onChange={(e) => {
                          const val = e.target.value
                          // Remove old mapping for this field
                          const oldCol = Object.entries(mapping).find(([, v]) => v === field.key)?.[0]
                          if (oldCol) {
                            setMapping(prev => {
                              const next = { ...prev }
                              delete next[oldCol]
                              return next
                            })
                          }
                          if (val) {
                            updateMapping(val, field.key)
                          }
                        }}
                        className={`w-full border rounded-lg px-3 py-2.5 text-sm ${
                          isAutoMapped
                            ? 'border-green-300 bg-green-50'
                            : field.required && !mappedCol
                            ? 'border-red-300 bg-red-50'
                            : 'border-gray-200'
                        }`}
                      >
                        <option value="">-- Select column --</option>
                        {parseResult.columns.map(col => (
                          <option key={col} value={col}>
                            {col}
                            {parseResult.sampleRows[0]?.[col]
                              ? ` (e.g. "${parseResult.sampleRows[0][col]}")`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Preview of first 5 rows */}
          {parseResult.sampleRows.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-600">File Preview (first 5 rows)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {parseResult.columns.map(col => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.sampleRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {parseResult.columns.map(col => (
                          <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {row[col] || <span className="text-gray-300">--</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleReset}
              className="px-5 py-2.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleValidate}
              disabled={!allRequiredMapped || loading}
              className={`px-6 py-2.5 text-sm rounded-lg font-semibold transition-colors ${
                allRequiredMapped && !loading
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {loading ? 'Validating...' : 'Next: Validate'}
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Validate & Preview ─────────────────────────────────────── */}
      {step === 3 && validationResult && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Total Rows" value={validationResult.totalRows} color="gray" />
            <SummaryCard label="Valid Rows" value={validationResult.validRows} color="green" />
            <SummaryCard label="Warnings" value={validationResult.warningRows} color="yellow" />
            <SummaryCard label="Errors" value={validationResult.errorRows} color="red" />
          </div>

          {/* New Categories */}
          {validationResult.newCategories.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-800 mb-1">
                Will create {validationResult.newCategories.length} new categories:
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {validationResult.newCategories.map(cat => (
                  <span key={cat} className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Errors Table */}
          {validationResult.errors.length > 0 && (
            <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                <p className="text-sm font-semibold text-red-700">
                  Errors ({validationResult.errors.length})
                </p>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-red-50 sticky top-0">
                      <th className="px-3 py-2 text-left font-medium text-red-700">Row</th>
                      <th className="px-3 py-2 text-left font-medium text-red-700">Field</th>
                      <th className="px-3 py-2 text-left font-medium text-red-700">Value</th>
                      <th className="px-3 py-2 text-left font-medium text-red-700">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.errors.map((err, i) => (
                      <tr key={i} className="border-t border-red-100 bg-red-50/30">
                        <td className="px-3 py-2 text-red-600 font-mono">{err.row || '--'}</td>
                        <td className="px-3 py-2 text-red-700 font-medium">{err.field}</td>
                        <td className="px-3 py-2 text-red-600 font-mono text-xs">{err.value || '--'}</td>
                        <td className="px-3 py-2 text-red-700">{err.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings Table */}
          {validationResult.warnings.length > 0 && (
            <div className="bg-white border border-yellow-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-200">
                <p className="text-sm font-semibold text-yellow-700">
                  Warnings ({validationResult.warnings.length})
                </p>
              </div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-yellow-50 sticky top-0">
                      <th className="px-3 py-2 text-left font-medium text-yellow-700">Row</th>
                      <th className="px-3 py-2 text-left font-medium text-yellow-700">Field</th>
                      <th className="px-3 py-2 text-left font-medium text-yellow-700">Value</th>
                      <th className="px-3 py-2 text-left font-medium text-yellow-700">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.warnings.map((warn, i) => (
                      <tr key={i} className="border-t border-yellow-100 bg-yellow-50/30">
                        <td className="px-3 py-2 text-yellow-600 font-mono">{warn.row}</td>
                        <td className="px-3 py-2 text-yellow-700 font-medium">{warn.field}</td>
                        <td className="px-3 py-2 text-yellow-600 font-mono text-xs">{warn.value || '--'}</td>
                        <td className="px-3 py-2 text-yellow-700">{warn.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview Table */}
          {validationResult.preview.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-600">
                  Import Preview (first {Math.min(20, validationResult.preview.length)} rows)
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {Object.keys(validationResult.preview[0])
                        .filter(k => k !== '_row')
                        .map(col => (
                          <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validationResult.preview.map((row, i) => {
                      const rowNum = row._row
                      const hasError = validationResult.errors.some(e => e.row === rowNum)
                      const hasWarning = validationResult.warnings.some(w => w.row === rowNum)
                      return (
                        <tr
                          key={i}
                          className={`border-t border-gray-100 ${
                            hasError ? 'bg-red-50' : hasWarning ? 'bg-yellow-50' : ''
                          }`}
                        >
                          {Object.entries(row)
                            .filter(([k]) => k !== '_row')
                            .map(([k, v]) => {
                              const cellError = validationResult.errors.some(
                                e => e.row === rowNum && e.field === k
                              )
                              const cellWarning = validationResult.warnings.some(
                                w => w.row === rowNum && w.field === k
                              )
                              return (
                                <td
                                  key={k}
                                  className={`px-3 py-2 whitespace-nowrap ${
                                    cellError
                                      ? 'text-red-700 bg-red-100 font-medium'
                                      : cellWarning
                                      ? 'text-yellow-700 bg-yellow-100'
                                      : 'text-gray-700'
                                  }`}
                                >
                                  {String(v) || <span className="text-gray-300">--</span>}
                                </td>
                              )
                            })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Conflict Handling */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Conflict Handling</p>
            <div className="flex flex-wrap gap-3">
              {([
                { value: 'skip', label: 'Skip duplicates', desc: 'Keep existing data unchanged' },
                { value: 'update', label: 'Update existing', desc: 'Overwrite with new values' },
                { value: 'replace', label: 'Replace all', desc: 'Delete and re-create' },
              ] as const).map(opt => (
                <label
                  key={opt.value}
                  className={`flex-1 min-w-[140px] border-2 rounded-lg p-3 cursor-pointer transition-colors ${
                    conflictMode === opt.value
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="conflict"
                    value={opt.value}
                    checked={conflictMode === opt.value}
                    onChange={() => setConflictMode(opt.value)}
                    className="sr-only"
                  />
                  <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(2)}
              className="px-5 py-2.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={!validationResult.valid || importing}
              className={`px-8 py-3 text-base rounded-lg font-bold transition-colors ${
                validationResult.valid && !importing
                  ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Import {validationResult.validRows} Rows
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Import Progress & Results ──────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-6">
          {/* Progress Bar */}
          {importing && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">
                  Importing... {importProgress}%
                </p>
                <p className="text-sm text-gray-500">
                  {Math.round(((validationResult?.validRows || 0) * importProgress) / 100)} of{' '}
                  {validationResult?.validRows || 0} rows
                </p>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Results */}
          {importResult && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard label="Imported" value={importResult.imported} color="green" />
                <SummaryCard label="Updated" value={importResult.updated} color="blue" />
                <SummaryCard label="Skipped" value={importResult.skipped} color="gray" />
                <SummaryCard label="Errors" value={importResult.errors} color="red" />
              </div>

              {/* Created Categories */}
              {importResult.createdCategories.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-800">
                    Created {importResult.createdCategories.length} new categories:
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {importResult.createdCategories.map(cat => (
                      <span key={cat} className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Details */}
              {importResult.errorDetails.length > 0 && (
                <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-red-50 border-b border-red-200">
                    <p className="text-sm font-semibold text-red-700">
                      Import Errors ({importResult.errorDetails.length})
                    </p>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-red-50 sticky top-0">
                          <th className="px-3 py-2 text-left font-medium text-red-700">Row</th>
                          <th className="px-3 py-2 text-left font-medium text-red-700">Field</th>
                          <th className="px-3 py-2 text-left font-medium text-red-700">Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.errorDetails.map((err, i) => (
                          <tr key={i} className="border-t border-red-100">
                            <td className="px-3 py-2 text-red-600 font-mono">{err.row}</td>
                            <td className="px-3 py-2 text-red-700 font-medium">{err.field}</td>
                            <td className="px-3 py-2 text-red-700">{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                {importType === 'pricebook' ? (
                  <a
                    href="/admin/pricebook"
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors"
                  >
                    View Pricebook
                  </a>
                ) : (
                  <a
                    href="/admin/estimator"
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors"
                  >
                    View Estimator
                  </a>
                )}
                <button
                  onClick={handleReset}
                  className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm transition-colors"
                >
                  Import Another File
                </button>
              </div>
            </>
          )}

          {/* Error state (no result) */}
          {!importing && !importResult && error && (
            <div className="text-center py-8">
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm transition-colors"
              >
                Start Over
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Import History ─────────────────────────────────────────────────── */}
      <div className="mt-12 border-t border-gray-200 pt-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Import History</h2>
        {history.length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-8 text-center">
            <p className="text-gray-500 text-sm">No import history yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">File</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Rows</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Imported</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Errors</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{entry.filename}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium capitalize">
                          {entry.importType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.totalRows}</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{entry.importedRows}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-medium">{entry.errorRows}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            entry.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : entry.status === 'partial'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Summary Card Component ────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: 'green' | 'red' | 'yellow' | 'blue' | 'gray' }) {
  const styles: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  }
  const numStyles: Record<string, string> = {
    green: 'text-green-800',
    red: 'text-red-800',
    yellow: 'text-yellow-800',
    blue: 'text-blue-800',
    gray: 'text-gray-800',
  }
  return (
    <div className={`border rounded-lg p-4 ${styles[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${numStyles[color]}`}>{value}</p>
    </div>
  )
}
