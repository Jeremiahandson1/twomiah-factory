// "You don't have access" — one sentence per rung or permission, read by the shell's gate (AppShell.tsx) and by the
// pages that open outside the shell (the order kiosk): a viewer who opened /crm/kiosk got a blank page with a pink
// "Permission denied" chip and no way back (bar live test, 2026-10-25).
import React from 'react'

// Who can open a page that needs a given rung. One sentence per rung, because a single sentence for all
// of them told a MANAGER that the page was "limited to your salon's managers and owner" — wrong, and
// confusing to the person reading it. (Salon T29 L2)
export const WHO_CAN_OPEN: Record<string, string> = {
  owner: 'This page is limited to the account owner',
  admin: 'This page is limited to admins and the owner',
  manager: 'This page is limited to managers and above',
  // …and by permission, for the pages the server gates that way. Keyed by the permission string itself,
  // so the sentence a person reads is looked up with the same key the guard checks. (T30 M-R1)
  // "This page", not the permission's own noun: more than one page sits behind each of these, and RV's Accounting
  // page — behind invoices:read — told staff "Invoices are limited…". (T63) The heading above already names the page.
  'invoices:read': 'This page is limited to the people who handle the money',
  'quotes:read': 'This page is limited to the people who handle the money',
  'reports:read': 'This page is limited to managers and above',
  'audit:read': 'This page is limited to admins and the owner',
  'marketing:read': 'This page is limited to managers and above',
  'team:read': 'This page is limited to managers and above',
  'company:update': 'This page is limited to admins and the owner',
  'bar:register': 'This page is limited to the people who run the register',
}

/** A full page for a seat that may not open this one, outside the shell: what it is, who can, and the way back. */
export function NoAccessPage({ label, needs, backTo = '/crm' }: { label: string; needs: string; backTo?: string }) {
  return (
    <div className="min-h-screen flex items-start justify-center bg-gray-50 dark:bg-slate-950 p-4">
      <div role="alert" className="max-w-xl w-full mt-16 text-center bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">You don't have access to {label}</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">{WHO_CAN_OPEN[needs] || 'This page is limited to a higher access level'}. Ask them if you need something from it.</p>
        <a href={backTo} className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold dark:bg-slate-100 dark:text-slate-900">Back</a>
      </div>
    </div>
  )
}
