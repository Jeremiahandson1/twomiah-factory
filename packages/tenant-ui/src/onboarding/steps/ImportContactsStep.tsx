import React, { useState } from 'react'

// CSV upload is available but always skippable. Points at the existing
// /api/import endpoint each template already has. We don't do the mapping
// UI here — just a pass-through upload; Settings → Import has the full
// mapping experience if they need it.

function getToken(): string { try { return localStorage.getItem('token') || '' } catch { return '' } }

export function ImportContactsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }): React.ReactElement {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState('')

  async function upload() {
    if (!file) return
    setUploading(true); setError(''); setResult('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/import/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken() },
        body: form,
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed') }
      const data = await res.json()
      setResult((data.imported || 0) + ' contacts imported')
    } catch (err: any) { setError(err.message) }
    setUploading(false)
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Import your contacts</h2>
      <p className="text-sm text-gray-500 mb-6">Got a CSV of contacts from another system? Drop it here and we'll get everyone imported. Otherwise skip and add them as you go.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}
      {result && <div className="bg-green-50 border border-green-200 rounded-md p-3 mb-4 text-sm text-green-700">{result}</div>}

      <div className="border-2 border-dashed border-gray-300 rounded-md p-6 text-center mb-6">
        <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} className="mb-3" />
        {file && (
          <div className="text-sm text-gray-600 mb-3">{file.name} ({Math.round(file.size / 1024)} KB)</div>
        )}
        <button onClick={upload} disabled={!file || uploading} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
          {uploading ? 'Uploading…' : 'Upload CSV'}
        </button>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm">Back</button>
        <button onClick={onNext} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md text-sm font-semibold">
          {result ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}
