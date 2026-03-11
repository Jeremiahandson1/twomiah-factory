import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import portalApi from './portalApi';

export default function PortalServiceRequest() {
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ jobNumber: string; responseHours: number } | null>(null);

  const [form, setForm] = useState({
    equipmentId: '',
    description: '',
    urgency: 'routine' as 'routine' | 'urgent',
    preferredContact: 'call' as 'call' | 'text' | 'email',
  });

  useEffect(() => {
    portalApi.get('/api/portal/equipment').then(setEquipment).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;

    setSubmitting(true);
    try {
      const result = await portalApi.post('/api/portal/service-request', {
        equipmentId: form.equipmentId || null,
        description: form.description.trim(),
        urgency: form.urgency,
        preferredContact: form.preferredContact,
      });
      setSubmitted(result);
    } catch (err: any) {
      alert(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  // Confirmation screen
  if (submitted) {
    return (
      <div className="px-4 py-12 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Request Received</h1>
        <p className="text-gray-600 mb-1">
          We'll be in touch within <strong>{submitted.responseHours} hours</strong>.
        </p>
        <p className="text-sm text-gray-400 mb-8">Reference: {submitted.jobNumber}</p>
        <button
          onClick={() => navigate('/portal')}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Request Service</h1>
      <p className="text-sm text-gray-500 mb-6">Tell us what you need help with</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Equipment Select */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Equipment</label>
          <select
            value={form.equipmentId}
            onChange={(e) => setForm(f => ({ ...f, equipmentId: e.target.value }))}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="">Other / Not sure</option>
            {equipment.map(eq => (
              <option key={eq.id} value={eq.id}>
                {eq.name} {eq.manufacturer ? `(${eq.manufacturer})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Issue Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">What's the issue?</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe what's happening..."
            rows={4}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {/* Urgency */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">How urgent is this?</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, urgency: 'routine' }))}
              className={`p-4 rounded-xl border-2 text-center transition-colors ${
                form.urgency === 'routine'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <Wrench className="w-5 h-5 mx-auto mb-1" />
              <p className="font-semibold text-sm">Routine</p>
              <p className="text-xs mt-0.5 opacity-70">Within a few days</p>
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, urgency: 'urgent' }))}
              className={`p-4 rounded-xl border-2 text-center transition-colors ${
                form.urgency === 'urgent'
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
              <p className="font-semibold text-sm">Urgent</p>
              <p className="text-xs mt-0.5 opacity-70">Need help today</p>
            </button>
          </div>
        </div>

        {/* Preferred Contact */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">How should we reach you?</label>
          <div className="flex gap-2">
            {(['call', 'text', 'email'] as const).map(method => (
              <button
                key={method}
                type="button"
                onClick={() => setForm(f => ({ ...f, preferredContact: method }))}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${
                  form.preferredContact === method
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !form.description.trim()}
          className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 text-white rounded-xl font-bold text-base hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Submit Request
        </button>
      </form>
    </div>
  );
}
