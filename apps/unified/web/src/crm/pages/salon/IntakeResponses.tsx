// A client's answers to the salon's intake and consent forms, on their chart (server crm/salon/intakeForms.ts GET /api/intake-forms/responses;
// hidden feature `intake_forms`). Shown to whoever reads clients (contacts:read), as the server asks. Answers are kept as the client gave them.
import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { api } from '../../../api'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { useAuth, usePermissions } from '../../../shared'

interface Response { id: string; formName: string; formKind: string; answers: Array<{ label: string; answer: string }>; signedName: string | null; createdAt: string }

export function ClientIntakeResponses({ contactId }: { contactId: string }) {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  const show = !!contactId && hasFeature('intake_forms') && known && can('contacts:read')
  const [rows, setRows] = useState<Response[] | null>(null)
  useEffect(() => {
    if (!show) return
    api.get(`/api/intake-forms/responses?contactId=${encodeURIComponent(contactId)}`).then((r: any) => setRows((r?.data ?? r) || [])).catch(() => setRows(null))
  }, [show, contactId])
  if (!show || !rows || rows.length === 0) return null
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-800">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><ClipboardList className="h-4 w-4" aria-hidden="true" /> Forms</h3>
      <ul className="mt-2 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="text-sm">
            <p className="font-medium text-gray-900 dark:text-slate-100">{r.formName} <span className="font-normal text-gray-600 dark:text-slate-300">— {momentDate(r.createdAt)}{r.signedName ? `, signed ${r.signedName}` : ''}</span></p>
            <dl className="mt-1 text-gray-700 dark:text-slate-300">
              {r.answers.map((a, i) => <div key={i} className="flex flex-wrap gap-x-2"><dt className="text-gray-600 dark:text-slate-400">{a.label}</dt><dd>{a.answer}</dd></div>)}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  )
}
