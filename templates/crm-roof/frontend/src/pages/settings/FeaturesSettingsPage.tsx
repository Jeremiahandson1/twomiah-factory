import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../services/api';
import { FEATURE_CATEGORIES } from '../../data/features';
import { ArrowLeft } from 'lucide-react';

// Self-serve feature toggles — brings the Settings "Features" card to life
// (it navigated here before this page existed). Reads the company's
// enabledFeatures, lets an admin/owner flip any feature, saves via
// PUT /api/company/features, then reloads so useFeature()-gated nav updates
// (roof's AuthContext exposes no refresh method).
export default function FeaturesSettingsPage() {
  const navigate = useNavigate();
  const { user, company } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const allIds = FEATURE_CATEGORIES.flatMap((c) => c.features.map((f) => f.id));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fresh = (await api.company.get()) as { enabledFeatures?: string[] } | null;
        // useFeature() treats a MISSING enabledFeatures as all-on — mirror that
        // here so the toggles show the truth. (The column defaults to [], so in
        // practice we always get an array.)
        const raw = fresh?.enabledFeatures ?? company?.enabledFeatures;
        const enabled = Array.isArray(raw) ? raw : allIds;
        setSelected(new Set(enabled));
        setInitial(new Set(enabled));
      } catch {
        const raw = company?.enabledFeatures;
        const enabled = Array.isArray(raw) ? raw : allIds;
        setSelected(new Set(enabled));
        setInitial(new Set(enabled));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const changedCount = (() => {
    let n = 0;
    selected.forEach((id) => { if (!initial.has(id)) n++; });
    initial.forEach((id) => { if (!selected.has(id)) n++; });
    return n;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.company.updateFeatures(Array.from(selected));
      toast.success('Features updated — refreshing so your menu matches');
      // No updateCompany/checkAuth in roof's AuthContext — a reload is the
      // reliable way to make useFeature()-gated nav pick up the change.
      setTimeout(() => window.location.reload(), 900);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save features');
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading features…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 pb-28">
      <button onClick={() => navigate('/crm/settings')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Settings
      </button>
      <h1 className="text-2xl font-bold mb-1">Features</h1>
      <p className="text-gray-500 mb-6">
        Every feature is included in your plan — switch on the ones you want. Changes apply to your whole team.
        {!isAdmin && <span className="block mt-1 text-amber-600 font-medium">Only admins can change features.</span>}
      </p>

      <div className="space-y-6">
        {FEATURE_CATEGORIES.map((cat) => {
          const onCount = cat.features.filter((f) => selected.has(f.id)).length;
          return (
            <div key={cat.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-gray-900">{cat.name}</h2>
                  <p className="text-sm text-gray-500">{cat.description}</p>
                </div>
                <span className="text-xs font-semibold text-gray-400 whitespace-nowrap">{onCount}/{cat.features.length} on</span>
              </div>
              <div className="divide-y divide-gray-50">
                {cat.features.map((f) => {
                  const on = selected.has(f.id);
                  return (
                    <div key={f.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 text-sm">{f.name}</div>
                        <div className="text-xs text-gray-500">{f.description}</div>
                      </div>
                      <button
                        role="switch"
                        aria-checked={on}
                        aria-label={`${f.name} — ${on ? 'on' : 'off'}`}
                        disabled={!isAdmin}
                        onClick={() => toggle(f.id)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin && changedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <span className="text-sm text-gray-600">{changedCount} unsaved {changedCount === 1 ? 'change' : 'changes'}</span>
            <div className="flex gap-3">
              <button onClick={() => setSelected(new Set(initial))} disabled={saving} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900">Discard</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
