import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, Gift, Truck, ShoppingBag, Receipt, Clock, ToggleLeft, ToggleRight, AtSign, Globe, Inbox, CreditCard, Plug, Monitor, Upload } from 'lucide-react';
import { Button } from '../components/ui/DataTable';
// NOTE: the Two-Factor and Till PIN cards are deliberately NOT here. This page is company
// configuration and admin-only, and putting a budtender's own PIN behind that gate is exactly the
// fault T41 found. They live on MyAccountPage, which every role can reach. (T41)

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

type DayHours = { open: string; close: string; closed: boolean };
type StoreHours = Record<string, DayHours>;

const defaultHours = (): StoreHours =>
  Object.fromEntries(DAYS.map(d => [d, { open: '09:00', close: '21:00', closed: false }]));

// These five have a real company column, which is the one place they are stored and validated.
// PUT /api/company REFUSES them inside `settings` (SETTING_HAS_A_COLUMN) so a value cannot end up
// with two homes holding two answers. This screen used to mirror them into the blob, and every tab
// spreads the stored blob back up on save — so once a tenant had the legacy copies, every section
// here failed with a 400, including the four that never touch a rate.
const COLUMN_BACKED = ['taxRate', 'localTaxRate', 'exciseTaxRate', 'purchaseLimitOz', 'storeHours'] as const;

/** The stored settings blob, minus anything that belongs in a column. Send this, never the raw blob. */
function settingsWithoutColumns(stored: any): Record<string, any> {
  const out: Record<string, any> = { ...(stored || {}) };
  for (const k of COLUMN_BACKED) delete out[k];
  return out;
}

const pad = (t: string) => { const [h, m] = String(t).split(':'); return `${String(h ?? '').padStart(2, '0')}:${m ?? '00'}`; };

// Whether a module is switched on, and where the switch is.
//
// The Delivery and Merch tabs each carried their own on/off toggle stored under settings, which
// nothing on the server reads — so both said "disabled" while the module was on and its page was
// in the menu. A switch that changes nothing is worse than no switch: it tells the owner their
// shop is in a state it is not in. (T45 M23)
function ModuleState({ on, onLabel, offLabel, onNavigate }: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onNavigate: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${on ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' : 'border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800'}`}>
      <span className={`text-sm font-medium ${on ? 'text-green-800 dark:text-green-200' : 'text-gray-600 dark:text-slate-300'}`}>
        {on ? onLabel : offLabel}
      </span>
      <button
        onClick={onNavigate}
        className="text-sm font-medium text-green-700 hover:text-green-800 whitespace-nowrap dark:text-green-300 dark:hover:text-green-200"
      >
        Change in Features
      </button>
    </div>
  );
}

// Which clock the shop runs on. The server's storeTimeZone() prefers settings.timezone, then the
// licensed state, then UTC — so "Automatic" is a real choice and must write NOTHING rather than an
// empty string. This is the shortlist a US dispensary needs, not the authority: the server validates
// the name with Intl, and reports what Automatic resolves to as `effectiveTimeZone`, so this file
// never carries a second copy of the state→zone table the compliance day is built on. (T28 L-e)
const TIME_ZONES: Array<[string, string]> = [
  ['America/New_York', 'Eastern — New York'],
  ['America/Detroit', 'Eastern — Detroit'],
  ['America/Indiana/Indianapolis', 'Eastern — Indianapolis'],
  ['America/Chicago', 'Central — Chicago'],
  ['America/Denver', 'Mountain — Denver'],
  ['America/Boise', 'Mountain — Boise'],
  ['America/Phoenix', 'Mountain, no DST — Phoenix'],
  ['America/Los_Angeles', 'Pacific — Los Angeles'],
  ['America/Anchorage', 'Alaska — Anchorage'],
  ['Pacific/Honolulu', 'Hawaii — Honolulu'],
  ['UTC', 'UTC'],
];

/** Store hours arrive in two shapes: the seeded column form ({mon:'9:00-21:00'}) and this form's own
 *  ({mon:{open,close,closed}}). Read either, so the hours a dispensary was generated with are the
 *  hours it is shown — before this the column was never read and every day rendered 09:00–21:00. */
function normalizeHours(raw: any): StoreHours {
  const out = defaultHours();
  if (!raw || typeof raw !== 'object') return out;
  for (const d of DAYS) {
    const v = (raw as any)[d];
    if (v == null) continue;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s || /^closed$/i.test(s)) { out[d] = { ...out[d], closed: true }; continue; }
      const [open, close] = s.split('-').map(p => p.trim());
      if (open && close) out[d] = { open: pad(open), close: pad(close), closed: false };
    } else if (typeof v === 'object') {
      out[d] = { open: pad(v.open || out[d].open), close: pad(v.close || out[d].close), closed: !!v.closed };
    }
  }
  return out;
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!enabled)} className="flex items-center gap-3 group">
      {enabled
        ? <ToggleRight className="w-8 h-8 text-green-600" />
        : <ToggleLeft className="w-8 h-8 text-gray-400 group-hover:text-gray-500" />}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">{children}</label>;
}

function Input({ value, onChange, type = 'text', placeholder = '', className = '' }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition ${className}`} />;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, company, updateCompany, hasFeature, isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('general');

  // Kiosks. The pairing flow was built end to end — POST /devices mints a code, the tablet spends it
  // at /pair — and the kiosk screen tells the customer "Add this device under Settings → Kiosks", but
  // that screen did not exist, so there was no way to mint a code and no kiosk could ever be paired.
  // (T27 H1)
  const [kiosks, setKiosks] = useState<any[]>([]);
  const [kiosksLoaded, setKiosksLoaded] = useState(false);
  const [newKioskName, setNewKioskName] = useState('');
  const [addingKiosk, setAddingKiosk] = useState(false);
  // Shown once, right after it is minted — the server does not hand it back again.
  const [freshPairing, setFreshPairing] = useState<{ id: string; name: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  // Mirrors the server's requireAdmin (admin|owner). Without this a non-admin
  // could fill in the whole form and get a bare 403 toast.
  const canManageUsers = (user as any)?.role === 'admin' || (user as any)?.role === 'owner';
  const isOwner = (user as any)?.role === 'owner';
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'user' });

  // General
  const [generalForm, setGeneralForm] = useState({
    name: '', address: '', phone: '', email: '', taxRate: '0', localTaxRate: '0', exciseTaxRate: '15', purchaseLimitOz: '1',
    timezone: '',
    paymentTermsDays: '30',
  });
  // What the server says Automatic resolves to, so the manager can see the default rather than guess.
  const [effectiveTz, setEffectiveTz] = useState('');
  const [storeHours, setStoreHours] = useState<StoreHours>(defaultHours());

  // Loyalty
  // welcomePoints and birthdayBonus were not on this form and were not sent on save — and the save
  // REPLACED settings.loyalty wholesale, so pressing Save with no edits at all wiped both, and the
  // next new member got 0 welcome points instead of 50. The thresholds shown were the placeholders
  // below rather than the shop's real ladder, because those live under loyalty.tierThresholds and
  // nothing read them. (T45 H1)
  const [loyaltyForm, setLoyaltyForm] = useState({
    enabled: false,
    pointsPerDollar: '1',
    welcomePoints: '0',
    birthdayBonus: '0',
    bronzeThreshold: '100',
    silverThreshold: '500',
    goldThreshold: '1000',
    platinumThreshold: '2500',
  });

  // Delivery
  const [deliveryForm, setDeliveryForm] = useState({
    enabled: false,
    defaultFee: '5.00',
    minimumOrder: '50.00',
  });

  // Merch
  const [merchForm, setMerchForm] = useState({
    enabled: false,
    stripePublishableKey: '',
    stripeSecretKey: '',
  });

  // Receipts
  const [receiptForm, setReceiptForm] = useState({
    headerText: '',
    footerText: '',
    showLogo: true,
  });

  useEffect(() => {
    if (company) {
      const settings = company.settings || {};
      // Tax rates live in real company columns (taxRate / localTaxRate / exciseTaxRate) — that is
      // what the register charges. This form used to read them from company.settings, so it
      // showed "Sales Tax 0%" while the POS charged 10% (go-live QA M-1). Prefer the column;
      // fall back to settings for tenants that only ever saved there.
      const pick = (col: any, legacy: any, dflt: string) =>
        col != null && col !== '' ? String(col) : (legacy != null && legacy !== '' ? String(legacy) : dflt);
      setGeneralForm({
        name: company.name || '',
        address: company.address || '',
        phone: company.phone || '',
        email: company.email || '',
        taxRate: pick(company.taxRate, settings.taxRate, '0'),
        localTaxRate: pick(company.localTaxRate, settings.localTaxRate, '0'),
        exciseTaxRate: pick(company.exciseTaxRate, settings.exciseTaxRate, '15'),
        purchaseLimitOz: pick(company.purchaseLimitOz, settings.purchaseLimitOz, '1'),
        timezone: typeof settings.timezone === 'string' ? settings.timezone : '',
        paymentTermsDays: settings.paymentTermsDays != null && settings.paymentTermsDays !== '' ? String(settings.paymentTermsDays) : '30',
      });
      // /auth/me returns a trimmed company; fetch the full row so the column values win.
      api.get('/api/company').then((full: any) => {
        const co = full?.data || full;
        if (!co) return;
        setGeneralForm(prev => ({
          ...prev,
          taxRate: pick(co.taxRate, prev.taxRate, '0'),
          localTaxRate: pick(co.localTaxRate, prev.localTaxRate, '0'),
          exciseTaxRate: pick(co.exciseTaxRate, prev.exciseTaxRate, '15'),
          purchaseLimitOz: pick(co.purchaseLimitOz, prev.purchaseLimitOz, '1'),
          timezone: typeof co.settings?.timezone === 'string' ? co.settings.timezone : prev.timezone,
          paymentTermsDays: co.settings?.paymentTermsDays != null && co.settings.paymentTermsDays !== '' ? String(co.settings.paymentTermsDays) : prev.paymentTermsDays,
        }));
        setEffectiveTz(co.effectiveTimeZone || '');
        // Store hours live in the column too, and that is where the seed puts them. Prefer it;
        // fall back to the blob for tenants that only ever saved there.
        if (co.storeHours) setStoreHours(normalizeHours(co.storeHours));
      }).catch(() => {});
      if (settings.storeHours) setStoreHours(normalizeHours(settings.storeHours));
      // Read the SERVER's resolved loyalty config (the flat loyalty* keys sanitizeCompany returns),
      // not the raw blob — the blob keeps the thresholds one level down in tierThresholds, which is
      // why this tab showed 100/500/1000/2500 while the shop was really running 500/1500/5000. (T45 H1)
      {
        const t = (company as any)?.loyaltyTierThresholds || settings.loyalty?.tierThresholds || {};
        setLoyaltyForm(prev => ({
          ...prev,
          enabled: (company as any)?.loyaltyEnabled ?? !!settings.loyalty?.enabled,
          pointsPerDollar: String((company as any)?.loyaltyPointsPerDollar ?? settings.loyalty?.pointsPerDollar ?? prev.pointsPerDollar),
          welcomePoints: String((company as any)?.loyaltyWelcomePoints ?? settings.loyalty?.welcomePoints ?? prev.welcomePoints),
          birthdayBonus: String((company as any)?.loyaltyBirthdayBonus ?? settings.loyalty?.birthdayBonus ?? prev.birthdayBonus),
          bronzeThreshold: String(t.bronze ?? prev.bronzeThreshold),
          silverThreshold: String(t.silver ?? prev.silverThreshold),
          goldThreshold: String(t.gold ?? prev.goldThreshold),
          platinumThreshold: String(t.platinum ?? prev.platinumThreshold),
        }));
      }
      if (settings.delivery) setDeliveryForm({ ...deliveryForm, ...settings.delivery, enabled: !!settings.delivery?.enabled });
      if (settings.merch) setMerchForm({ ...merchForm, ...settings.merch, enabled: !!settings.merch?.enabled });
      if (settings.receipts) setReceiptForm({ ...receiptForm, ...settings.receipts, showLogo: settings.receipts?.showLogo !== false });
    }
    loadUsers();
  }, [company]);

  // Revoking access is a deactivation, not a delete — orders and loyalty rows
  // point at this user, and the seat count is of ACTIVE users, so this is also
  // what frees a seat. Before this the table was read-only.
  // Owner-only grant: who may see the login-user list besides the owner. (Wrench QA decision)
  const handleToggleUserListGrant = async (u: any) => {
    const has = ((u.extraPermissions as string[]) || []).includes('users:read');
    try {
      await api.company.updateUser(u.id, { extraPermissions: has ? [] : ['users:read'] });
      toast.success(has ? 'User list access removed' : 'User list access granted');
      loadUsers();
    } catch (err) { toast.error((err as Error).message || 'Could not change permissions'); }
  };
  const handleToggleUserAccess = async (id: string, currentlyActive: boolean) => {
    if (currentlyActive && !confirm('Revoke access for this user? They will not be able to sign in, and their seat is freed.')) return;
    try {
      await api.company.updateUser(id, { isActive: !currentlyActive });
      toast.success(currentlyActive ? 'Access revoked' : 'Access restored');
      loadUsers();
    } catch (err) { toast.error((err as Error).message || 'Could not change access'); }
  };

  // "Manage Team" opens the team_member roster — HR records with no login. This
  // creates an actual seat, which is what the plan is sold by; nothing in the UI
  // called the (long-existing) create-user endpoint before, so every dispensary
  // account was stuck at one login.
  const handleAddUser = async () => {
    if (!newUser.firstName.trim() || !newUser.lastName.trim()) { toast.error('First and last name are required'); return; }
    if (!newUser.email.trim()) { toast.error('Email is required'); return; }
    if (newUser.password.length < 8 || !/[A-Za-z]/.test(newUser.password) || !/\d/.test(newUser.password)) { toast.error('Password must be at least 8 characters and include at least one letter and one number'); return; }
    setAddingUser(true);
    try {
      await api.company.createUser(newUser);
      toast.success('User added');
      setAddUserOpen(false);
      setNewUser({ firstName: '', lastName: '', email: '', password: '', role: 'field' });
      loadUsers();
    } catch (err) { toast.error((err as Error).message || 'Could not add the user'); }
    finally { setAddingUser(false); }
  };

  const loadUsers = async () => {
    try {
      const data = await api.company.users();
      setUsers(Array.isArray(data) ? data : (data?.data || []));
    } catch (err) {
      console.error('Failed to load users');
    }
  };

  const saveSettings = async (section: string) => {
    setSaving(true);
    try {
      const payload: any = {};

      if (section === 'general') {
        payload.name = generalForm.name;
        payload.address = generalForm.address;
        payload.phone = generalForm.phone;
        payload.email = generalForm.email;
        // Write the rates and the hours to the columns the register and the storefront read (M-1).
        // Nothing is mirrored into `settings`: the server refuses the shadow copy, and a second
        // home is how the form came to show 0% while the POS charged 10% in the first place.
        payload.taxRate = parseFloat(generalForm.taxRate) || 0;
        payload.localTaxRate = parseFloat(generalForm.localTaxRate) || 0;
        payload.exciseTaxRate = parseFloat(generalForm.exciseTaxRate) || 0;
        payload.purchaseLimitOz = parseFloat(generalForm.purchaseLimitOz) || 0;
        payload.storeHours = storeHours;
        const generalSettings = settingsWithoutColumns(company?.settings);
        // Automatic means "no opinion" — storeTimeZone() then falls back to the licensed state. The
        // server MERGES settings, so simply omitting the key would leave a previously chosen zone in
        // place and Automatic would not stick. Send null, which is what the reader treats as unset.
        generalSettings.timezone = generalForm.timezone || null;
        // Payment terms are now on this screen, because a value the server refuses has to be fixable
        // somewhere. A tenant carrying 400 days from before the rule could not save ANY setting. (T30)
        generalSettings.paymentTermsDays = Number(generalForm.paymentTermsDays) || 0;
        payload.settings = generalSettings;
      } else if (section === 'loyalty') {
        payload.settings = {
          ...settingsWithoutColumns(company?.settings),
        };
        // The loyalty config goes through the server's OWN keys, which it merges into
        // settings.loyalty (T21 M7). Writing the block by hand replaced it wholesale, so every field
        // this form does not carry — welcome points, birthday bonus — was deleted by a save that
        // changed nothing else. Send what this screen actually edits and let the server merge. (T45 H1)
        Object.assign(payload, {
          loyaltyEnabled: loyaltyForm.enabled,
          loyaltyPointsPerDollar: Number(loyaltyForm.pointsPerDollar) || 0,
          loyaltyWelcomePoints: Math.max(0, Math.floor(Number(loyaltyForm.welcomePoints) || 0)),
          loyaltyBirthdayBonus: Math.max(0, Math.floor(Number(loyaltyForm.birthdayBonus) || 0)),
          loyaltyTierThresholds: {
            bronze: Number(loyaltyForm.bronzeThreshold) || 0,
            silver: Number(loyaltyForm.silverThreshold) || 0,
            gold: Number(loyaltyForm.goldThreshold) || 0,
            platinum: Number(loyaltyForm.platinumThreshold) || 0,
          },
        });
      } else if (section === 'delivery') {
        payload.settings = {
          ...settingsWithoutColumns(company?.settings),
          delivery: {
            enabled: deliveryForm.enabled,
            defaultFee: deliveryForm.defaultFee,
            minimumOrder: deliveryForm.minimumOrder,
          },
        };
      } else if (section === 'merch') {
        payload.settings = {
          ...settingsWithoutColumns(company?.settings),
          merch: {
            enabled: merchForm.enabled,
            stripePublishableKey: merchForm.stripePublishableKey,
            stripeSecretKey: merchForm.stripeSecretKey,
          },
        };
      } else if (section === 'receipts') {
        payload.settings = {
          ...settingsWithoutColumns(company?.settings),
          receipts: {
            headerText: receiptForm.headerText,
            footerText: receiptForm.footerText,
            showLogo: receiptForm.showLogo,
          },
        };
      }

      const updated = await api.company.update(payload);
      updateCompany(updated);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateHours = (day: string, field: keyof DayHours, value: string | boolean) => {
    setStoreHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  // ── Kiosks ──────────────────────────────────────────────────────────────────────────────────────
  const loadKiosks = async () => {
    try {
      const res: any = await api.get('/api/kiosk/devices');
      setKiosks(res?.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load kiosks');
    } finally {
      setKiosksLoaded(true);
    }
  };

  useEffect(() => { if (tab === 'kiosks' && !kiosksLoaded) loadKiosks(); }, [tab, kiosksLoaded]);

  /**
   * Watch for the tablet pairing itself.
   *
   * Pairing happens on the KIOSK, not here: the tablet spends the code at /pair and the server marks the
   * device active. Nothing tells this page — the kiosk routes emit no socket event and this screen has
   * never used one — so the row sat on "Awaiting pairing" until somebody reloaded, while the device was
   * already live. (Dispensary T28 L-h)
   *
   * Polling only while the code is on screen, because that is the whole window anyone cares about: the
   * manager is standing here reading it out. It stops the moment the device goes active (and says so), if
   * the panel is dismissed, or after five minutes — the code itself is good for 24 hours, so "poll until
   * it expires" would be a day-long timer, not a bound.
   */
  useEffect(() => {
    if (!freshPairing) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop || Date.now() - started > 5 * 60 * 1000) return;
      try {
        const res: any = await api.get('/api/kiosk/devices');
        const list = res?.data || [];
        setKiosks(list);
        const mine = list.find((k: any) => k.id === freshPairing.id);
        if (mine?.status === 'active') {
          toast.success(`“${freshPairing.name}” is paired and ready.`);
          setFreshPairing(null);
          return;
        }
      } catch { /* a failed poll is not worth a toast — the next one will do */ }
      if (!stop) timer = setTimeout(tick, 4000);
    };
    let timer = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(timer); };
  }, [freshPairing]);

  // Coming back to the desk after pairing at the tablet is the other half of the same story, and costs
  // nothing to cover: re-read the list when the window is focused again while this tab is open.
  useEffect(() => {
    if (tab !== 'kiosks') return;
    const onFocus = () => { loadKiosks(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [tab]);

  const handleAddKiosk = async () => {
    const name = newKioskName.trim();
    if (!name) { toast.error('Give the kiosk a name, so you can tell it from the others.'); return; }
    setAddingKiosk(true);
    try {
      const made: any = await api.post('/api/kiosk/devices', { name });
      // The code is only in this response. Hold it on screen until the manager dismisses it.
      setFreshPairing({ id: made.id, name, code: made.pairingCode });
      setNewKioskName('');
      await loadKiosks();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add kiosk');
    } finally {
      setAddingKiosk(false);
    }
  };

  const handleRevokeKiosk = async (k: any) => {
    if (!confirm(`Revoke "${k.name}"? The tablet stops working straight away and has to be paired again.`)) return;
    try {
      await api.post(`/api/kiosk/devices/${k.id}/revoke`, {});
      toast.success(`${k.name} revoked`);
      await loadKiosks();
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke kiosk');
    }
  };

  const handleDeleteKiosk = async (k: any) => {
    if (!confirm(`Delete "${k.name}"? This only works for a kiosk that has never taken a sale.`)) return;
    try {
      await api.delete(`/api/kiosk/devices/${k.id}`);
      toast.success(`${k.name} deleted`);
      if (freshPairing?.id === k.id) setFreshPairing(null);
      await loadKiosks();
    } catch (err: any) {
      // The server refuses with a 409 and an explanation when the kiosk is part of the sales record.
      toast.error(err.message || 'Failed to delete kiosk');
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'loyalty', label: 'Loyalty', icon: Gift },
    { id: 'delivery', label: 'Delivery', icon: Truck },
    { id: 'merch', label: 'Merch', icon: ShoppingBag },
    { id: 'receipts', label: 'Receipts', icon: Receipt },
    // Only where the tenant actually has kiosks — matching the Kiosk nav item, which is gated the same way.
    // …and only for an ADMIN. Every button on that tab — add, revoke, delete — is admin-only on the
    // server (T43 N6), and the Kiosk screen has told staff "ask an admin or the owner" since T42.
    // Showing a manager the tab would hand them three buttons that answer 403, which is the same
    // defect T44 filed against the End-of-Day menu entry.
    ...(hasFeature('kiosk') && isAdmin ? [{ id: 'kiosks', label: 'Kiosks', icon: Monitor }] : []),
    { id: 'team', label: 'Team', icon: Users },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      {/* A 192px SIDEBAR BESIDE THE FORM LEFT 142px FOR THE FORM. (T41 "Settings scrolls sideways
          (675px)") Measured at 390px: clientWidth 390, scrollWidth 687, and the element past the
          edge was this pane — flex-1 cannot shrink below its content's minimum, so the form pushed
          the page sideways by 297px instead. Below lg the nav sits above the form; `min-w-0` lets
          the pane actually take the width it is given rather than its content's minimum. */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="w-full lg:w-48 flex-shrink-0 space-y-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left transition ${
                tab === t.id ? 'bg-green-50 text-green-700 font-medium dark:bg-green-500/15 dark:text-green-300' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              <t.icon className="w-5 h-5" />
              {t.label}
            </button>
          ))}
          <div className="border-t my-3 pt-3">
            <button onClick={() => navigate('/crm/settings/billing')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <CreditCard className="w-5 h-5" />
              Billing &amp; Payments
            </button>
            <button onClick={() => navigate('/crm/settings/integrations')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <Plug className="w-5 h-5" />
              Integrations
            </button>
            <button onClick={() => navigate('/crm/settings/features')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <ToggleLeft className="w-5 h-5" />
              Features
            </button>
            {/* Onboarding points owners here to bring their customers and products across, and
                until now the link went nowhere. Owner/admin only, matching the API. (T45 H4) */}
            {isAdmin && (
              <button onClick={() => navigate('/crm/settings/import')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
                <Upload className="w-5 h-5" />
                Import
              </button>
            )}
            <button onClick={() => navigate('/crm/settings/email')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <AtSign className="w-5 h-5" />
              Branded Email
            </button>
            <button onClick={() => navigate('/crm/settings/email-domain')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <Globe className="w-5 h-5" />
              Email Domain
            </button>
            <button onClick={() => navigate('/crm/settings/email-inbox')} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-600 hover:bg-gray-100 dark:text-slate-400">
              <Inbox className="w-5 h-5" />
              Email Inbox
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          {/* GENERAL */}
          {tab === 'general' && (
            <div className="space-y-6 max-w-2xl">
              <h2 className="text-lg font-semibold">Store Information</h2>

              <div className="space-y-4">
                <div>
                  <FieldLabel>Store Name</FieldLabel>
                  <Input value={generalForm.name} onChange={v => setGeneralForm({ ...generalForm, name: v })} />
                </div>

                <div>
                  <FieldLabel>Address</FieldLabel>
                  <Input value={generalForm.address} onChange={v => setGeneralForm({ ...generalForm, address: v })} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Phone</FieldLabel>
                    <Input value={generalForm.phone} onChange={v => setGeneralForm({ ...generalForm, phone: v })} type="tel" />
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <Input value={generalForm.email} onChange={v => setGeneralForm({ ...generalForm, email: v })} type="email" />
                  </div>
                </div>

                <div className="w-48">
                  <FieldLabel>Sales Tax Rate (%)</FieldLabel>
                  <div className="relative">
                    <Input
                      value={generalForm.taxRate}
                      onChange={v => setGeneralForm({ ...generalForm, taxRate: v })}
                      type="number"
                      placeholder="0.00"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 text-sm">%</span>
                  </div>
                </div>

                <div className="w-48">
                  <FieldLabel>Local Tax Rate (%)</FieldLabel>
                  <div className="relative">
                    <Input
                      value={generalForm.localTaxRate}
                      onChange={v => setGeneralForm({ ...generalForm, localTaxRate: v })}
                      type="number"
                      placeholder="0.00"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 text-sm">%</span>
                  </div>
                </div>

                <div className="w-48">
                  <FieldLabel>Cannabis Excise Tax (%)</FieldLabel>
                  <div className="relative">
                    <Input
                      value={generalForm.exciseTaxRate}
                      onChange={v => setGeneralForm({ ...generalForm, exciseTaxRate: v })}
                      type="number"
                      placeholder="15.00"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 text-sm">%</span>
                  </div>
                </div>

                <div className="w-64">
                  <FieldLabel>Purchase Limit (oz flower-equivalent per transaction)</FieldLabel>
                  <div className="relative">
                    <Input
                      value={generalForm.purchaseLimitOz}
                      onChange={v => setGeneralForm({ ...generalForm, purchaseLimitOz: v })}
                      type="number"
                      placeholder="1"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 text-sm">oz</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Enforced at the register and online menu. This is the retail SALE limit per transaction (not the personal possession limit) — 1 oz of flower in most adult-use states, including Colorado. Raise it only where your state's retail rules allow.</p>
                </div>

                <div className="w-64">
                  <FieldLabel>Payment Terms (days)</FieldLabel>
                  <Input
                    value={generalForm.paymentTermsDays}
                    onChange={v => setGeneralForm({ ...generalForm, paymentTermsDays: v })}
                    type="number"
                    placeholder="30"
                  />
                  {/* This field exists because the server refuses a value outside 0–365, and a tenant
                      carrying 400 days from before that rule could not save ANY setting on this page
                      with nowhere to correct it. A rule the UI gives you no way to satisfy is a trap.
                      (Dispensary T30) */}
                  {/* …and a tenant that still HOLDS 400 loads this page with 400 in the box and no
                      hint that the next Save will be refused because of it. Say so on arrival, not
                      after the attempt. (T45 L13) */}
                  {(() => {
                    const days = Number(generalForm.paymentTermsDays);
                    const outOfRange = generalForm.paymentTermsDays !== '' &&
                      (!Number.isInteger(days) || days < 0 || days > 365);
                    {/* …and the warning itself was out of date. (T41)
                        "Payment terms stored as 400 days and accepted by the server; the General tab
                         then blocks every save."
                        It does not block it. The server grandfathers a value it did not ask for —
                        an UNCHANGED out-of-range figure is replayed and accepted, precisely so a
                        tenant carrying 400 is not locked out of its own settings page (the comment
                        above it says why). This message still said "nothing on this page will save
                        until you do", which was the rule BEFORE the grandfathering and is now
                        simply untrue; the tester read it and recorded the page as blocked. A warning
                        that describes behaviour the product no longer has is worse than none. */}
                    return outOfRange ? (
                      <p className="text-xs text-amber-700 mt-1 dark:text-amber-300">
                        {generalForm.paymentTermsDays} is outside 0–365. It is kept as it is and the rest of this
                        page still saves, but any NEW value has to be between 0 and 365 — so once you change this
                        box you will have to put it in range.
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">How long a customer has to pay an invoice. Used as the default due date; 0–365.</p>
                </div>

                <div className="w-64">
                  <FieldLabel>Timezone</FieldLabel>
                  <select
                    value={generalForm.timezone}
                    onChange={e => setGeneralForm({ ...generalForm, timezone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">Automatic{effectiveTz ? ` — ${effectiveTz}` : ''}</option>
                    {TIME_ZONES.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Decides which day a sale is reported on — compliance reports, end-of-day close, the dashboard's "today" and peak-hour charts all use it. Automatic follows the state on your license{effectiveTz ? `, currently ${effectiveTz}` : ''}. Set it if you trade in a different zone.</p>
                </div>
              </div>

              {/* Store Hours */}
              <div>
                <h3 className="text-md font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Store Hours
                </h3>
                <div className="space-y-2">
                  {DAYS.map(day => (
                    <div key={day} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
                      <span className="w-24 text-sm font-medium text-gray-700 dark:text-slate-200">{DAY_LABELS[day]}</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!storeHours[day]?.closed}
                          onChange={e => updateHours(day, 'closed', !e.target.checked)}
                          className="w-4 h-4 rounded text-green-600 focus:ring-green-500"
                        />
                        <span className="text-sm text-gray-500 dark:text-slate-400">{storeHours[day]?.closed ? 'Closed' : 'Open'}</span>
                      </label>
                      {!storeHours[day]?.closed && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input
                            type="time"
                            value={storeHours[day]?.open || '09:00'}
                            onChange={e => updateHours(day, 'open', e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                          <span className="text-gray-500 dark:text-slate-400 text-sm">to</span>
                          <input
                            type="time"
                            value={storeHours[day]?.close || '21:00'}
                            onChange={e => updateHours(day, 'close', e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={() => saveSettings('general')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}

          {/* LOYALTY */}
          {tab === 'loyalty' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Loyalty Program</h2>

              <Toggle
                enabled={loyaltyForm.enabled}
                onChange={v => setLoyaltyForm({ ...loyaltyForm, enabled: v })}
                label={loyaltyForm.enabled ? 'Loyalty program is active' : 'Loyalty program is disabled'}
              />

              {loyaltyForm.enabled && (
                <div className="space-y-5 pt-2">
                  <div className="w-48">
                    <FieldLabel>Points per Dollar Spent</FieldLabel>
                    <Input
                      value={loyaltyForm.pointsPerDollar}
                      onChange={v => setLoyaltyForm({ ...loyaltyForm, pointsPerDollar: v })}
                      type="number"
                      placeholder="1"
                    />
                  </div>

                  {/* Both were stored, both were paid out by the award engine, and neither was on
                      this screen — so a saved welcome bonus could be wiped by a save and never put
                      back, because there was nowhere to type it. (T45 H1) */}
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    <div>
                      <FieldLabel>Welcome Bonus</FieldLabel>
                      <Input
                        value={loyaltyForm.welcomePoints}
                        onChange={v => setLoyaltyForm({ ...loyaltyForm, welcomePoints: v })}
                        type="number"
                        placeholder="0"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Points a customer gets when they join. 0 for none.</p>
                    </div>
                    <div>
                      <FieldLabel>Birthday Bonus</FieldLabel>
                      <Input
                        value={loyaltyForm.birthdayBonus}
                        onChange={v => setLoyaltyForm({ ...loyaltyForm, birthdayBonus: v })}
                        type="number"
                        placeholder="0"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Once per year, on their first sale that day.</p>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 dark:text-slate-200">Tier Thresholds (points required)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <FieldLabel>Bronze</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-700" />
                          <input
                            type="number"
                            value={loyaltyForm.bronzeThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, bronzeThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Silver</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-gray-400" />
                          <input
                            type="number"
                            value={loyaltyForm.silverThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, silverThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Gold</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-yellow-500" />
                          <input
                            type="number"
                            value={loyaltyForm.goldThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, goldThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Platinum</FieldLabel>
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-400" />
                          <input
                            type="number"
                            value={loyaltyForm.platinumThreshold}
                            onChange={e => setLoyaltyForm({ ...loyaltyForm, platinumThreshold: e.target.value })}
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('loyalty')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Loyalty Settings'}
              </Button>
            </div>
          )}

          {/* DELIVERY */}
          {tab === 'delivery' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Delivery Settings</h2>

              {/* This tab used to carry its own on/off switch, stored at settings.delivery.enabled,
                  which NOTHING on the server reads — so it said "Delivery is disabled" while the
                  module was switched on and Delivery was sitting in the menu. Two switches for one
                  thing, disagreeing. The module switch is Settings → Features; this tab now reports
                  it and sets the numbers that the delivery module actually uses. (T45 M23) */}
              <ModuleState
                on={hasFeature('delivery')}
                onLabel="Delivery is switched on for this shop"
                offLabel="Delivery is switched off for this shop"
                onNavigate={() => navigate('/crm/settings/features')}
              />

              {hasFeature('delivery') && (
                <div className="space-y-4 pt-2">
                  <div className="w-56">
                    <FieldLabel>Default Delivery Fee ($)</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={deliveryForm.defaultFee}
                        onChange={e => setDeliveryForm({ ...deliveryForm, defaultFee: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                      />
                    </div>
                  </div>

                  <div className="w-56">
                    <FieldLabel>Minimum Order Amount ($)</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={deliveryForm.minimumOrder}
                        onChange={e => setDeliveryForm({ ...deliveryForm, minimumOrder: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 dark:border-slate-700"
                      />
                    </div>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('delivery')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Delivery Settings'}
              </Button>
            </div>
          )}

          {/* MERCH */}
          {tab === 'merch' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Merch Store</h2>

              {/* Same as Delivery above: settings.merch.enabled is read by nothing. (T45 M23) */}
              <ModuleState
                on={hasFeature('merch_store')}
                onLabel="The merch store is switched on for this shop"
                offLabel="The merch store is switched off for this shop"
                onNavigate={() => navigate('/crm/settings/features')}
              />

              {hasFeature('merch_store') && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    Connect your Stripe account to accept payments for merchandise.
                  </p>
                  <div>
                    <FieldLabel>Stripe Publishable Key</FieldLabel>
                    <Input
                      value={merchForm.stripePublishableKey}
                      onChange={v => setMerchForm({ ...merchForm, stripePublishableKey: v })}
                      placeholder="pk_live_..."
                    />
                  </div>
                  <div>
                    <FieldLabel>Stripe Secret Key</FieldLabel>
                    <Input
                      value={merchForm.stripeSecretKey}
                      onChange={v => setMerchForm({ ...merchForm, stripeSecretKey: v })}
                      type="password"
                      placeholder="sk_live_..."
                    />
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">This key is stored securely and never exposed to the frontend.</p>
                  </div>
                </div>
              )}

              <Button onClick={() => saveSettings('merch')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Merch Settings'}
              </Button>
            </div>
          )}

          {/* RECEIPTS */}
          {tab === 'receipts' && (
            <div className="space-y-6 max-w-xl">
              <h2 className="text-lg font-semibold">Receipt Settings</h2>

              <div className="space-y-4">
                <div>
                  <FieldLabel>Receipt Header Text</FieldLabel>
                  <textarea
                    value={receiptForm.headerText}
                    onChange={e => setReceiptForm({ ...receiptForm, headerText: e.target.value })}
                    rows={3}
                    placeholder="Text printed at the top of receipts (e.g. store name, license info)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition dark:border-slate-700"
                  />
                </div>

                <div>
                  <FieldLabel>Receipt Footer Text</FieldLabel>
                  <textarea
                    value={receiptForm.footerText}
                    onChange={e => setReceiptForm({ ...receiptForm, footerText: e.target.value })}
                    rows={3}
                    placeholder="Text printed at the bottom (e.g. return policy, thank you message)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition dark:border-slate-700"
                  />
                </div>

                <Toggle
                  enabled={receiptForm.showLogo}
                  onChange={v => setReceiptForm({ ...receiptForm, showLogo: v })}
                  label={receiptForm.showLogo ? 'Show logo on receipts' : 'Logo hidden on receipts'}
                />
              </div>

              <Button onClick={() => saveSettings('receipts')} disabled={saving}>
                {saving ? 'Saving...' : 'Save Receipt Settings'}
              </Button>
            </div>
          )}

          {/* TEAM */}
          {tab === 'kiosks' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Kiosks</h2>
                <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">
                  Add a tablet here, then enter its pairing code on the kiosk screen. The code is shown once and expires on its own.
                </p>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 max-w-xs">
                  <FieldLabel>Kiosk name</FieldLabel>
                  <Input value={newKioskName} onChange={setNewKioskName} placeholder="Front counter tablet" />
                </div>
                <Button onClick={handleAddKiosk} disabled={addingKiosk}>
                  {addingKiosk ? 'Adding…' : 'Add Kiosk'}
                </Button>
              </div>

              {freshPairing && (
                <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:bg-slate-800 dark:border-green-700">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-green-900 dark:text-green-200">
                        Pairing code for “{freshPairing.name}”
                      </p>
                      <p className="mt-2 font-mono text-2xl tracking-widest text-green-900 dark:text-green-100">{freshPairing.code}</p>
                      <p className="mt-2 text-xs text-green-800 dark:text-green-300">
                        Enter this on the kiosk. It is not shown again — if it expires, add the kiosk again for a new code.
                      </p>
                    </div>
                    <button onClick={() => setFreshPairing(null)} className="text-sm font-medium text-green-800 hover:text-green-900 dark:text-green-300 dark:hover:text-green-200">
                      Done
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto border rounded-lg dark:border-slate-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase dark:text-slate-300">Kiosk</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase dark:text-slate-300">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase dark:text-slate-300">Last seen</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase dark:text-slate-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                    {kiosks.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-sm text-center text-gray-500 dark:text-slate-400">
                          {kiosksLoaded ? 'No kiosks yet. Add one above to get a pairing code.' : 'Loading…'}
                        </td>
                      </tr>
                    )}
                    {kiosks.map(k => (
                      <tr key={k.id}>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium">{k.name}</div>
                          {k.tokenLast4 && <div className="text-xs text-gray-500 dark:text-slate-400">ends {k.tokenLast4}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {k.status === 'active'
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Paired</span>
                            : k.status === 'revoked'
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Revoked</span>
                              : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Awaiting pairing</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                          {/* On the STORE's clock, not the browser's. An owner checking a tablet from
                              home in another state read a last-seen hours out from what the shop saw.
                              effectiveTimeZone is what the server resolved (a set zone, else the
                              licensed state), so this column and the compliance day agree. (T43 N11) */}
                          {k.lastSeenAt
                            ? new Date(k.lastSeenAt).toLocaleString(undefined, effectiveTz ? { timeZone: effectiveTz } : undefined)
                            : '—'}
                        </td>
                        {/* Delete is offered only where it will actually work. It used to sit on every row,
                            including the ones the server refuses 409 for, and the operator found out by
                            pressing it — the toast explains it well, but a button you cannot use is still a
                            button you pressed for nothing. A device that HAS taken sessions can only be
                            revoked, which is already here; once it is revoked there is nothing left to do
                            with it, so the row says why it is staying rather than showing an empty cell.
                            (Dispensary T28 L-i) */}
                        <td className="px-4 py-3 text-sm text-right space-x-3">
                          {k.status !== 'revoked' && (
                            <button onClick={() => handleRevokeKiosk(k)} className="text-xs font-medium text-red-600 hover:text-red-700 dark:hover:text-red-300">
                              Revoke
                            </button>
                          )}
                          {Number(k.sessionCount || 0) === 0 ? (
                            <button onClick={() => handleDeleteKiosk(k)} className="text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200" title="This kiosk has never taken a session, so it can be removed entirely">
                              Delete
                            </button>
                          ) : (
                            <span className="text-xs text-gray-500 dark:text-slate-400" title={`${k.sessionCount} kiosk session${Number(k.sessionCount) === 1 ? '' : 's'} — part of the sales record`}>
                              Kept for the sales record
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Team Members</h2>
                <div className="flex items-center gap-2">
                  {canManageUsers && (
                    <Button onClick={() => { setNewUser({ firstName: '', lastName: '', email: '', password: '', role: 'field' }); setAddUserOpen(true); }}>
                      Add User
                    </Button>
                  )}
                  <Button onClick={() => navigate('/crm/team')}>
                    Manage Team
                  </Button>
                </div>
              </div>

              {addUserOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddUserOpen(false)}>
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-4">Add User</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">First name *</label>
                          <input value={newUser.firstName} onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Last name *</label>
                          <input value={newUser.lastName} onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Email *</label>
                        <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Temporary password *</label>
                        <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="At least 8 characters" className="w-full text-sm border rounded-lg px-3 py-2" />
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Share this with them — they can change it after signing in.</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Role</label>
                        <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                          <option value="user">Budtender — register sales, customers, ID checks, cash drawer; needs a manager for discounts, voids and refunds</option>
                          <option value="driver">Driver — delivery runs only: their route, order status and stop check-offs. No register, no cash drawer</option>
                          <option value="manager">Manager — everything a budtender does plus approvals, inventory, batches, compliance and reports; not company settings or billing</option>
                          <option value="admin">Admin — full access, including company settings, billing and team</option>
                          <option value="viewer">Viewer — read-only. Can open any page but cannot change anything</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                      <button onClick={() => setAddUserOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400">Cancel</button>
                      <Button onClick={handleAddUser} disabled={addingUser}>{addingUser ? 'Adding...' : 'Add User'}</Button>
                    </div>
                  </div>
                </div>
              )}
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Role</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Status</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400 text-sm">No team members found</td>
                      </tr>
                    )}
                    {users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">{u.firstName} {u.lastName}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{u.email}</td>
                        <td className="px-4 py-3 text-sm capitalize">{u.role}</td>
                        <td className="px-4 py-3 text-sm">
                          {u.isActive
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">Inactive</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {u.id === (user as any)?.id
                            ? <span className="text-xs text-gray-500 dark:text-slate-400">You</span>
                            : canManageUsers ? (
                              <>{isOwner && u.role !== 'owner' && (
                        <label className="inline-flex items-center gap-1 text-xs text-gray-500 mr-3 dark:text-slate-400" title="Lets this person see the list of logins under Settings › Users">
                          <input type="checkbox" checked={(u.extraPermissions || []).includes('users:read')} onChange={() => handleToggleUserListGrant(u)} /> can view user list
                        </label>
                      )}
                      <button onClick={() => handleToggleUserAccess(u.id, !!u.isActive)} className={`text-xs font-medium ${u.isActive ? 'text-red-600 hover:text-red-700 dark:hover:text-red-300' : 'text-green-600 hover:text-green-700 dark:hover:text-green-300'}`}>
                                {u.isActive ? 'Revoke access' : 'Restore access'}
                              </button></>
                            ) : null}
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
    </div>
  );
}
