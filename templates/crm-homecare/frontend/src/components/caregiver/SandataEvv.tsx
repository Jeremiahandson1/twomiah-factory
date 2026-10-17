// Caregiver-side Sandata EVV pieces, ported from the CVHC CRM's CaregiverDashboard:
//   · the "Now check IN/OUT on Sandata" prompt after a punch
//   · the client's Medicaid ID with Copy (and "Copy ID & open Sandata")
//   · first-login help for Sandata Mobile Connect
//   · a one-time notice that Sandata EVV is required, for caregivers with a client in Sandata
// Data comes from GET /api/sandata/caregiver-context, which is scoped to the caregiver's own clients
// and returns a Medicaid ID only for clients who are in Sandata.
import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';
import { copyText, medicaidIdOf, needsSandata, openSandata, type SandataClient } from '../../utils/sandata';

export interface SandataContext {
  sandataAgencyId: string | null;
  isWisconsin: boolean;
  clients: SandataClient[];
  activeVisit: { time_entry_id: string; client_id: string; sandata_required: boolean | null } | null;
}

export function useSandataContext(token: string | null) {
  const [ctx, setCtx] = useState<SandataContext | null>(null);
  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/sandata/caregiver-context`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setCtx(await r.json());
    } catch { /* offline: no Sandata context, the prompts fall back to nothing */ }
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  return { ctx, reload };
}

// The client's Medicaid ID with a Copy button, so the caregiver can paste it into Sandata when
// starting the visit. `withOpen` adds one tap that copies AND opens Sandata.
export function SandataIdBox({ client, withOpen = false }: { client: SandataClient | null | undefined; withOpen?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!needsSandata(client)) return null;
  const ma = medicaidIdOf(client);
  if (!ma) return null;
  const copy = async (andOpen: boolean) => {
    const ok = await copyText(ma);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 4000);
    else toast(`Couldn't copy — the client ID is ${ma}`, 'warning');
    if (andOpen) openSandata();
  };
  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-white p-3 text-left dark:border-blue-800 dark:bg-slate-800">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Client ID for Sandata (Medicaid ID)</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="flex-1 select-all font-mono text-xl font-extrabold tracking-wider text-gray-900 dark:text-slate-100">{ma}</span>
        <button type="button" onClick={() => copy(false)}
          className={copied
            ? 'rounded-md border border-green-700 bg-green-100 px-3 py-1.5 font-bold text-green-800 dark:border-green-500 dark:bg-green-900 dark:text-green-100'
            : 'rounded-md border border-orange-700 bg-white px-3 py-1.5 font-bold text-orange-700 dark:border-orange-400 dark:bg-slate-900 dark:text-orange-200'}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {withOpen && (
        <button type="button" onClick={() => copy(true)}
          className="mt-2 w-full rounded-lg bg-orange-700 py-2.5 text-base font-extrabold text-white hover:bg-orange-800 dark:bg-orange-600 dark:text-white dark:hover:bg-orange-500">
          📋 Copy ID &amp; open Sandata
        </button>
      )}
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">In Sandata, paste this when it asks for the client.</div>
    </div>
  );
}

// First-time Sandata Mobile Connect login. Sandata emails each registered worker a welcome email
// with a temporary password; the username is that email address; the agency is picked from a list.
export function SandataHelp({ agencyId, isWisconsin, email }: { agencyId: string | null; isWisconsin: boolean; email?: string | null }) {
  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-white px-4 py-3 text-left text-sm text-gray-800 dark:border-blue-800 dark:bg-slate-800 dark:text-slate-200">
      <div className="mb-1 font-extrabold text-gray-900 dark:text-slate-100">Logging in to Sandata the first time</div>
      <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
        <li><strong>Download the free Sandata Mobile Connect app</strong> (dark blue logo) from the Play Store / App Store. You need the app — there's no website login for caregivers.</li>
        <li>Find the <strong>welcome email from Sandata</strong> — it has your temporary password. Not in your inbox? Check spam, or search your email for "Sandata".</li>
        <li><strong>Username:</strong> the email address that welcome email was sent to{email ? <> — the email we have for you is <strong className="break-all">{email}</strong></> : ''}.</li>
        <li><strong>Password:</strong> the temporary password from that email. It works once — the app then asks you to make your own.</li>
        <li><strong>Company ID:</strong> {agencyId ? <>pick <strong>{agencyId}</strong> from the list.</> : <>pick our agency from the list (ask the office for our Sandata agency ID).</>}</li>
        <li>Do this first login <strong>on Wi-Fi</strong>, and tap <strong>Allow While Using App</strong> for location.</li>
      </ol>
      <div className="mt-2 text-slate-600 dark:text-slate-400">
        No welcome email from Sandata at all? You haven't been added yet — tell the office.
        {isWisconsin
          ? <> Login trouble: Wisconsin EVV Customer Care, <a className="font-semibold text-orange-700 underline dark:text-orange-200" href="tel:18339312035">833-931-2035</a> (weekdays 7–6).</>
          : <> Login trouble: call your state's EVV customer care line (the office has the number).</>}
      </div>
    </div>
  );
}

export function SandataPrompt({ prompt, client, ctx, email, onClose }: {
  prompt: { kind: 'in' | 'out'; clientName: string };
  client: SandataClient | null | undefined;
  ctx: SandataContext | null;
  email?: string | null;
  onClose: () => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const hasId = !!medicaidIdOf(client);
  return (
    <div className="card rounded-xl border-2 border-blue-700 bg-blue-50 px-5 py-4 dark:border-blue-500 dark:bg-slate-800">
      <div className="mb-1 text-lg font-extrabold text-blue-900 dark:text-blue-200">
        📲 Now check {prompt.kind === 'in' ? 'IN' : 'OUT'} on Sandata
      </div>
      <div className="mb-3 text-sm text-blue-800 dark:text-blue-200">
        {prompt.clientName ? `${prompt.clientName}'s` : "This client's"} visits are verified in Sandata. The state requires the visit to be {prompt.kind === 'in' ? 'checked in' : 'checked out'} on the Sandata Mobile Connect app too — do it now, while you're at the home.
      </div>
      <SandataIdBox client={client} withOpen />
      {!hasId && (
        <button type="button" onClick={() => { openSandata(); onClose(); }}
          className="w-full rounded-lg bg-orange-700 py-3 text-base font-extrabold text-white hover:bg-orange-800 dark:bg-orange-600 dark:text-white dark:hover:bg-orange-500">
          Open the Sandata app
        </button>
      )}
      <div className="mt-1 text-center text-xs text-slate-600 dark:text-slate-400">
        You need the free <strong>Sandata Mobile Connect</strong> app on your phone. Don't have it yet? This button takes you to the store to download it (one time).
      </div>
      <button type="button" onClick={onClose}
        className="mt-2 w-full bg-transparent py-2 font-semibold text-orange-900 dark:text-orange-200">
        I already did it
      </button>
      <button type="button" onClick={() => setShowHelp((v) => !v)}
        className="w-full bg-transparent py-1 text-sm text-slate-600 underline dark:text-slate-300">
        {showHelp ? 'Hide login help' : 'How do I log in to Sandata?'}
      </button>
      {showHelp && <SandataHelp agencyId={ctx?.sandataAgencyId || null} isWisconsin={!!ctx?.isWisconsin} email={email} />}
    </div>
  );
}

// One-time notice that Sandata EVV is required. Shown once per caregiver per device until they tap
// "I understand", and only while they have a client in Sandata (so someone given one later still
// sees it then).
export function SandataNotice({ userId, ctx, companyPhone, onSetup }: {
  userId: string | null | undefined;
  ctx: SandataContext | null;
  companyPhone?: string | null;
  onSetup: () => void;
}) {
  const key = `sandata_notice_v1_${userId || ''}`;
  const [open, setOpen] = useState(() => {
    try { return !!userId && !localStorage.getItem(key); } catch { return false; }
  });
  if (!open || !ctx || !ctx.clients.some(needsSandata)) return null;
  const dismiss = () => {
    try { localStorage.setItem(key, new Date().toISOString()); } catch { /* private mode — shows again next time, harmless */ }
    setOpen(false);
  };
  const tel = String(companyPhone || '').replace(/\D/g, '');
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="sandata-notice-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white px-5 pb-4 pt-5 shadow-2xl dark:bg-slate-800">
        <h2 id="sandata-notice-title" className="mb-2 text-xl font-bold text-blue-900 dark:text-blue-200">📲 Important: Sandata EVV is required</h2>
        <p className="mb-2 text-[0.95rem] leading-relaxed text-gray-900 dark:text-slate-100">
          The state, through <strong>Sandata</strong>, requires every visit for a client who is in Sandata to be
          <strong> checked in and checked out on the Sandata Mobile Connect app</strong>, at the client's home, at the time of the visit.
        </p>
        <p className="mb-2 text-[0.95rem] leading-relaxed text-gray-900 dark:text-slate-100">
          Visits entered by hand afterward count as manual entries, and too many of them get an agency flagged. <strong>Please follow this for every visit</strong> — keep clocking in and out in our app as usual, and also check in and out on Sandata.
        </p>
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-gray-800 dark:text-slate-200">
          <li><strong>Download the free Sandata Mobile Connect app</strong> (dark blue logo) from the Play Store or App Store — yes, you need the app; there is no website login for caregivers.</li>
          <li>Log in with the <strong>welcome email from Sandata</strong> (username = your email, temporary password from that email{ctx.sandataAgencyId ? <>, Company ID <strong>{ctx.sandataAgencyId}</strong></> : ''}).</li>
          <li>At each of these visits: <strong>check in when you arrive, check out when you leave.</strong> This app will remind you.</li>
        </ol>
        {tel && (
          <p className="mb-4 text-[0.95rem] text-gray-900 dark:text-slate-100">
            Questions? Call the office at <a className="font-bold text-orange-700 underline dark:text-orange-200" href={`tel:${tel}`}>{companyPhone}</a>.
          </p>
        )}
        <button type="button" onClick={() => { dismiss(); onSetup(); }}
          className="w-full rounded-lg bg-orange-700 py-3 text-base font-extrabold text-white hover:bg-orange-800 dark:bg-orange-600 dark:text-white dark:hover:bg-orange-500">
          I understand — show me how to set it up
        </button>
        <button type="button" onClick={dismiss}
          className="mt-2 w-full rounded-lg border border-gray-300 bg-white py-2.5 font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          I understand
        </button>
      </div>
    </div>
  );
}

export default SandataPrompt;
