// Moved from templates/crm-homecare/frontend/src/components/ImpersonationModal.tsx — View As: pick a member of staff
// (or a client, for a read-only look at their portal) and get a short-lived session as them.
//   · Staff: GET /api/auth/users (a list reply: rows(); camelCase firstName/lastName) and
//     POST /api/auth/impersonate/:userId → { user } (server/crm/homecare/office/signIn.ts), the View As session itself
//     set as an httpOnly cookie, never handed to this page. Both ask users:read; the server refuses a person above the
//     asker's own rung and writes the audit row before it opens the View As.
//   · Clients: GET /api/clients?isActive=true, every page (lib/http.ts listAll; care-clients:read) and POST /api/portal/admin/preview/:clientId
//     → { token, user } (portals/clientPortal.ts, care-portal:update). The Client Portal tab is shown only to a seat
//     holding care-portal:update; the Staff tab only to users:read. The template offered both to every admin.
//   · The template read a bare array (`Array.isArray(userData) ? userData : []`), which the list reply never is: the
//     staff list would have been empty. Rows are camelCase; the template read first_name / last_name.
//   · Mounted by ./ViewAsPanel (the header's View As button, ./ViewAs.tsx): `onStaff` loads the app afresh as the person,
//     `onPortal` opens the client's portal with the preview token.
//   · Both themes: the panel, tabs, rows and buttons take the frame's tokens or light/dark pairs; the role colours are
//     ink on a tint in both.
import { useEffect, useState } from 'react';
import { useAuth, usePermissions } from '../../../../shared';
import { api, errorMessage, rows, listAll } from '../lib/http';
import { seatLabel } from './ViewAs';

/** The person or client a View As session is for, as the server answers it. */
export interface ViewAsUser {
  id: string;
  name: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  impersonatedBy: string;
}

interface StaffRow { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; role?: string | null }
interface ClientRow { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null }

interface Props {
  /** A View As of a member of staff is open (its session is the server's cookie). */
  onStaff: (user: ViewAsUser) => void;
  /** A client portal preview's read-only token. */
  onPortal: (token: string, user: ViewAsUser) => void;
  onClose: () => void;
}

type Tab = 'staff' | 'clients';

const isOffice = (role?: string | null) => role === 'admin' || role === 'owner';
const roleIcon = (role?: string | null) => (isOffice(role) ? '🔑' : '👤');
/** Ink on a tint, readable in both themes. */
const roleChip = (role?: string | null) => (isOffice(role)
  ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
  : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200');

export default function ImpersonationModal({ onStaff, onPortal, onClose }: Props) {
  const { can } = usePermissions();
  const { user: me } = useAuth();
  const mayStaff = can('users:read');
  const mayPortal = can('care-portal:update');
  const [users, setUsers] = useState<StaffRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [tab, setTab] = useState<Tab>(mayStaff ? 'staff' : 'clients');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    // Each list on its own: a refusal of one says so and leaves the other in place.
    const load = <T,>(go: Promise<unknown>, set: (r: T[]) => void, what: string) => go
      .then((reply) => { if (live) set(rows<T>(reply)); })
      .catch((e) => { if (live) setError(errorMessage(e, `Could not load the ${what}.`)); });
    Promise.all([
      mayStaff ? load<StaffRow>(api.get('/api/auth/users'), setUsers, 'staff') : null,
      mayPortal ? load<ClientRow>(listAll('/api/clients', { isActive: 'true' }), setClients, 'clients') : null,
    ]).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mayStaff, mayPortal]);

  const q = search.toLowerCase();
  // Not the person asking: a View As of yourself shows nothing new and only locks you out of your own changes.
  const filtered = users.filter((u) => u.id !== me?.id).filter((u) =>
    u.firstName?.toLowerCase().includes(q) ||
    u.lastName?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.role?.toLowerCase().includes(q) ||
    seatLabel(u.role).toLowerCase().includes(q),
  );
  const filteredClients = clients.filter((c) =>
    c.firstName?.toLowerCase().includes(q) ||
    c.lastName?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q) ||
    c.phone?.includes(q),
  );

  const start = async (id: string, go: () => Promise<void>) => {
    setImpersonating(id);
    setError('');
    try {
      await go();
    } catch (e) {
      setError(errorMessage(e, 'Failed'));
      setImpersonating(null);
    }
  };
  // A read-only look at a client's portal, as the client sees it.
  const handlePortalPreview = (clientId: string) => start(clientId, async () => {
    const data: { token: string; user: ViewAsUser } = await api.post(`/api/portal/admin/preview/${clientId}`, {});
    onPortal(data.token, data.user);
  });
  // The page loads afresh as the person: the button stays "Loading..." until it does.
  const handleImpersonate = (userId: string) => start(userId, async () => {
    const data: { user: ViewAsUser } = await api.post(`/api/auth/impersonate/${userId}`, {});
    onStaff(data.user);
  });

  const tabs = [
    ...(mayStaff ? [{ key: 'staff' as const, label: 'Staff', icon: '👤', count: users.filter((u) => u.id !== me?.id).length }] : []),
    ...(mayPortal ? [{ key: 'clients' as const, label: 'Client Portal', icon: '🏠', count: clients.length }] : []),
  ];

  const rowClass = 'flex items-center justify-between border-b border-gray-50 px-6 py-3 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/60';
  const busyBtn = 'cursor-not-allowed bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="View As User"
        style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '12px', width: '100%', maxWidth: '520px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--hc-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>👁️ View As User</h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--hc-muted)' }}>
              Select a user to see the app from their perspective
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--hc-muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--hc-line)' }}>
          {tabs.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => { setTab(t.key); setSearch(''); }}
              className={`flex-1 border-0 border-b-2 p-2.5 text-[0.85rem] font-semibold ${tab === t.key
                ? 'border-blue-600 bg-sky-50 text-blue-700 dark:border-blue-400 dark:bg-sky-950/40 dark:text-blue-300'
                : 'border-transparent bg-transparent text-gray-600 dark:text-slate-300'}`}
            >
              {t.icon} {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--hc-line)' }}>
          <input
            autoFocus
            type="text"
            placeholder={tab === 'staff' ? 'Search by name, email, or role...' : 'Search by name, email, or phone...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.6rem 0.9rem', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>Loading...</div>
          )}
          {error && (
            <div className="px-6 py-4 text-[0.85rem] text-red-700 dark:text-red-300">⚠️ {error}</div>
          )}
          {tab === 'staff' && !loading && filtered.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>No staff found</div>
          )}
          {tab === 'staff' && filtered.map((u) => (
            <div key={u.id} className={rowClass}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-[1.1rem] ${roleChip(u.role)}`}>
                  {roleIcon(u.role)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{u.firstName} {u.lastName}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>{u.email}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${roleChip(u.role)}`}>
                  {seatLabel(u.role)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleImpersonate(u.id)}
                disabled={impersonating === u.id}
                className={`whitespace-nowrap rounded-md border-0 px-4 py-1.5 text-[0.82rem] font-semibold ${impersonating === u.id ? busyBtn : 'cursor-pointer bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {impersonating === u.id ? 'Loading...' : 'View As'}
              </button>
            </div>
          ))}

          {/* Clients */}
          {tab === 'clients' && !loading && filteredClients.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>No clients found</div>
          )}
          {tab === 'clients' && filteredClients.map((c) => (
            <div key={c.id} className={rowClass}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-emerald-100 text-[1.1rem] dark:bg-emerald-900/40">
                  🏠
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.firstName} {c.lastName}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>{c.email || c.phone || 'No contact info'}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handlePortalPreview(c.id)}
                disabled={impersonating === c.id}
                className={`whitespace-nowrap rounded-md border-0 px-4 py-1.5 text-[0.82rem] font-semibold ${impersonating === c.id ? busyBtn : 'cursor-pointer bg-emerald-700 text-white hover:bg-emerald-800'}`}
              >
                {impersonating === c.id ? 'Loading...' : 'View Portal'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid var(--hc-line)', background: 'var(--hc-subtle)', borderRadius: '0 0 12px 12px', fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>
          🔒 All impersonation sessions are logged in the audit trail
        </div>
      </div>
    </div>
  );
}
