// Sandata Mobile Connect (SMC) — the state-provided EVV app in Sandata states.
// Ported from the CVHC CRM's frontend/src/utils/sandata.js.
//
// Until the CRM is a certified alternate EVV system, every visit for a client who is in Sandata must
// ALSO be checked in and out on SMC at the client's home. Keying visits into the Sandata portal
// afterward counts as a manual entry, and too many of those get an agency flagged. This only opens
// the app — it cannot check the caregiver in for them.
//
// Store listings (search "Sandata Mobile Connect", dark blue logo):
//   Android  com.sandata.smc.prod
//   iPhone   id6451209985
export const SMC_ANDROID_PACKAGE = 'com.sandata.smc.prod';
export const SMC_PLAY_URL = `https://play.google.com/store/apps/details?id=${SMC_ANDROID_PACKAGE}`;
export const SMC_APP_STORE_URL = 'https://apps.apple.com/us/app/sandata-mobile-connect/id6451209985';

// A client from GET /api/sandata/caregiver-context. The server decides `in_sandata` (the payer is a
// Sandata EVV payer and the client has a Medicaid ID on file; never private pay) — one rule, kept in
// backend/src/services/evvWeekly.ts clientInSandata().
export interface SandataClient { id: string; first_name?: string; last_name?: string; in_sandata?: boolean; medicaid_id?: string | null }

export function needsSandata(client: SandataClient | null | undefined): boolean {
  return !!client && client.in_sandata === true;
}

// Does THIS visit go to Sandata? The server decides at clock-in from the client's weekly EVV
// allowance and returns `sandata_required` on the visit:
//   false → this week's EVV hours are already met; the rest is non-EVV time: no Sandata
//   true  → send it
//   null/undefined → no answer (offline clock-in, timeout): fall back to needsSandata(), i.e.
//                    prompt — the safe side.
export function visitNeedsSandata(client: SandataClient | null | undefined, sandataRequired: boolean | null | undefined): boolean {
  if (sandataRequired === false) return false;
  return needsSandata(client);
}

// For the "no Sandata this visit" notice: a Sandata client whose weekly EVV hours are done.
export function evvWeekMet(client: SandataClient | null | undefined, sandataRequired: boolean | null | undefined): boolean {
  return sandataRequired === false && needsSandata(client);
}

export function smcLink(ua: string = (typeof navigator !== 'undefined' ? navigator.userAgent : '')): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return SMC_APP_STORE_URL; // the App Store page shows "Open" when installed
  if (/Android/i.test(ua)) {
    // Opens the installed app; Chrome falls back to the Play Store page if it isn't.
    return `intent://#Intent;package=${SMC_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(SMC_PLAY_URL)};end`;
  }
  return SMC_PLAY_URL;
}

// The client's Medicaid ID, for pasting into Sandata when starting the visit.
export function medicaidIdOf(client: SandataClient | null | undefined): string | null {
  const v = String((client && client.medicaid_id) || '').trim();
  return /^\d{10,12}$/.test(v) ? v : null;
}

// Copy text on a tap. navigator.clipboard needs a secure context and can be refused in some
// installed-app webviews, so fall back to the old select-and-copy trick.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export function openSandata(): void {
  const url = smcLink();
  // An intent:// launch doesn't leave our page. A store page opens in a new tab so the installed
  // app never navigates away from the caregiver's dashboard.
  if (url.startsWith('intent:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

// Office-side: Sandata visit-change reason codes (Wisconsin Alt-EVV Addendum v2.6 Appendix 3).
// 5 and 8 require a memo.
export const EVV_REASONS = [
  { code: '1', label: '1 — Caregiver Error (e.g. forgot to clock out)' },
  { code: '2', label: '2 — Member Unavailable' },
  { code: '3', label: '3 — Mobile Device Issue' },
  { code: '4', label: '4 — Telephony Issue' },
  { code: '5', label: '5 — Member Refused Verification (memo required)' },
  { code: '7', label: '7 — Missing in System' },
  { code: '8', label: '8 — Other (memo required)' },
];
export const EVV_REASONS_NEEDING_MEMO = ['5', '8'];
