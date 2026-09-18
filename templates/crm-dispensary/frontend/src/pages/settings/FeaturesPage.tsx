import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import { ALL_NAV_ITEMS } from '../../components/layout/AppLayout';

// Structural view of the nav config — some templates type ALL_NAV_ITEMS as
// NavItem[], others leave it inferred; this keeps the page portable either way.
const NAV_ITEMS = ALL_NAV_ITEMS as Array<{ label: string; features?: string[] }>;

// Friendlier labels for feature ids that are shared by a multi-feature nav item
// (e.g. "Marketing" bundles three) or are gated only by an inline page guard
// (visualizer / client_portal never appear as their own sidebar item).
const LABEL_OVERRIDES: Record<string, string> = {
  google_reviews: 'Google Reviews',
  email_marketing: 'Email Marketing',
  referral_program: 'Referral Program',
  two_way_texting: 'Two-Way Texting',
  visualizer: 'Design Visualizer',
  client_portal: 'Client Portal',
};

// Feature ids gated only by an inline guard (not by a sidebar nav item),
// so they aren't discoverable from ALL_NAV_ITEMS.
const INLINE_ONLY_IDS = ['visualizer', 'client_portal'];

// The single source of truth for what is optional: every feature id the running
// CRM actually gates on. Derived from the sidebar nav config so this list can
// never drift from what the app checks, and can never write an id nothing reads.
function buildOptionalFeatures(): { id: string; label: string }[] {
  const idToLabel = new Map<string, string>();
  for (const item of NAV_ITEMS) {
    if (!item.features) continue;
    for (const f of item.features) {
      if (!idToLabel.has(f)) {
        idToLabel.set(f, item.features.length === 1 ? item.label : (LABEL_OVERRIDES[f] || item.label));
      }
    }
  }
  for (const f of INLINE_ONLY_IDS) {
    if (!idToLabel.has(f)) idToLabel.set(f, LABEL_OVERRIDES[f] || f);
  }
  // Overrides always win for clarity.
  for (const [id, label] of Object.entries(LABEL_OVERRIDES)) {
    if (idToLabel.has(id)) idToLabel.set(id, label);
  }
  return Array.from(idToLabel.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default function FeaturesPage() {
  const navigate = useNavigate();
  const { company, updateCompany } = useAuth();
  const toast = useToast();

  const optionalFeatures = useMemo(() => buildOptionalFeatures(), []);
  const optionalIds = useMemo(() => new Set(optionalFeatures.map((f) => f.id)), [optionalFeatures]);

  const [selected, setSelected] = useState<Set<string>>(() => {
    const current = (company?.enabledFeatures || []) as string[];
    return new Set(current.filter((f) => optionalIds.has(f)));
  });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return optionalFeatures;
    return optionalFeatures.filter((f) => f.label.toLowerCase().includes(q) || f.id.includes(q));
  }, [optionalFeatures, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Preserve every id the CRM depends on (core modules, plan-granted ids, etc.);
      // only the optional/nav-gated ids are ever added or removed here.
      const preserved = ((company?.enabledFeatures || []) as string[]).filter((f) => !optionalIds.has(f));
      const next = [...preserved, ...Array.from(selected)];
      await api.put('/api/company/features', { features: next });
      updateCompany({ enabledFeatures: next } as any);
      toast.success('Features updated');
    } catch (err) {
      toast.error((err as Error).message || 'Failed to update features');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button onClick={() => navigate('/crm/settings')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Settings
      </button>

      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold">Features</h1>
          <p className="text-gray-500 mt-1 max-w-2xl">
            Turn on only what you use — the sidebar stays clean and focused. Every feature is
            included free on your plan, so add or remove anything anytime at no extra charge.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 px-5 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="relative my-5 max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="Search features..."
          className="w-full pl-9 pr-3 py-2 border rounded-lg"
        />
      </div>

      <p className="text-sm text-gray-400 mb-3">{selected.size} of {optionalFeatures.length} optional modules on</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((f) => {
          const on = selected.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                on ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className={`font-medium ${on ? 'text-orange-700' : 'text-gray-700'}`}>{f.label}</span>
              <span
                className={`shrink-0 w-5 h-5 rounded flex items-center justify-center border ${
                  on ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-300 text-transparent'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
