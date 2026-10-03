/**
 * My Account — the person's OWN security, reachable by every role. (T41)
 *
 * WHY THIS PAGE EXISTS. I shipped a Till PIN card and the Two-Factor card on Settings › Security and
 * wrote "for EVERY role, not just an admin — a budtender is exactly who needs the PIN". Then T41
 * found: "Owner sees the Till PIN card on Settings › Security; Settings is admin-only, so budtender,
 * staff and manager can't reach it." I put a budtender-facing control behind an admin-only door —
 * and the comment on that door says why it is locked: a budtender could once open the whole company
 * Settings page, and that was fixed in T40.
 *
 * So the mistake was the PLACEMENT, not the gate. This dispensary has three security-ish surfaces
 * and none of them was the right home:
 *
 *   /crm/settings   company configuration — tax rates, purchase limit, features.   admin
 *   /crm/security   company POLICY — MFA requirement, password rules, sessions.    manager+
 *   (nothing)       the person's own credentials.                                  — everyone
 *
 * The third one was missing, which is the whole bug. A PIN and an authenticator belong to a person,
 * not to the shop, so they do not belong on either company page at any gate. This page has NO role
 * gate: everyone who can sign in can manage how they sign in, and nothing on it can affect anybody
 * else or the business's configuration.
 */
import { KeyRound, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { TwoFactorCard } from '../shared';
import { TillPinCard } from '../components/security/TillPinCard';

export default function MyAccountPage() {
  const { user } = useAuth();
  const toast = useToast();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <User className="w-6 h-6 text-orange-500 dark:text-orange-300" />My Account
        </h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">
          How you sign in. These settings are yours alone — changing them affects nobody else and
          nothing about the shop.
        </p>
      </div>

      <div className="bg-white rounded-lg border p-4 dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-slate-400">Signed in as</span>
          <span className="text-gray-900 font-medium dark:text-slate-100">{user?.email}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-500 dark:text-slate-400">Your role</span>
          <span className="text-gray-900 dark:text-slate-100">{user?.role}</span>
        </div>
      </div>

      {/* Two-factor first: it is the stronger of the two. */}
      <section aria-labelledby="acct-2fa">
        <h2 id="acct-2fa" className="sr-only">Two-factor authentication</h2>
        <TwoFactorCard api={api as any} toast={toast} />
      </section>

      <section aria-labelledby="acct-pin">
        <h2 id="acct-pin" className="sr-only">Till PIN</h2>
        <TillPinCard user={user} toast={toast} />
      </section>
    </div>
  );
}
