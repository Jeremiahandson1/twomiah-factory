// Settings › Your data (server modules/exportEverything.ts, GET /api/export-everything): one button, one ZIP with every
// list the business has — contacts, jobs, quotes, invoices, time, people and the rest, each as a CSV — plus its website
// pages and its media list. The owner's and the admins'.
import { useState } from 'react'
import { Download, Loader2, FileArchive } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'

export default function ExportEverythingPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayExport = !known || can('settings:update')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    setBusy(true); setError('')
    try {
      const res = await api.raw('/api/export-everything')
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'The export could not be made.')
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'everything.zip'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast.success('Your export is downloading.')
    } catch (e) {
      setError((e as Error).message || 'The export could not be made.')
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your data</h1>
        <p className="text-gray-600 dark:text-slate-300">Everything you have in Twomiah, in one download. It is yours.</p>
      </div>
      <div className={box}>
        <div className="flex items-start gap-3">
          <FileArchive className="mt-0.5 h-6 w-6 shrink-0 text-gray-600 dark:text-slate-300" aria-hidden />
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Export everything</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-slate-200">
              <li>Every list your business has — contacts, jobs, quotes, invoices, payments, time, expenses, your team and the rest — each as a spreadsheet (CSV) file.</li>
              <li>Your website: every page and its content, and the list of your photos and files.</li>
              <li>One ZIP file. Only your business. Passwords, sign-in tokens and the keys of connected services are never in it.</li>
              <li>Each download is recorded in your audit log.</li>
            </ul>
            {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {mayExport ? (
              <button type="button" onClick={download} disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                {busy ? 'Gathering your data…' : 'Export everything'}
              </button>
            ) : (
              <p className="mt-3 text-sm text-gray-700 dark:text-slate-200">Only the owner and admins can export the business’s data.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
