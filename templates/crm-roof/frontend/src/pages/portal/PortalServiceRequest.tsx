import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenTool, Loader2, CheckCircle } from 'lucide-react';
import { portalHeaders } from './PortalLayout';

export default function PortalServiceRequest() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    description: '',
    preferredDate: '',
    phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) { setError('Please describe what you need'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/portal/service-request', {
        method: 'POST',
        headers: { ...portalHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to submit');
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="px-4 py-6 max-w-lg mx-auto">
        <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700 text-center">
          <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Request Submitted</h2>
          <p className="text-gray-400 text-sm mb-6">
            We've received your service request and will get back to you shortly.
          </p>
          <button
            onClick={() => navigate('/portal/dashboard')}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <PenTool className="w-6 h-6 text-blue-400" /> Service Request
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">Tell us what you need and we'll get back to you</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">What do you need? *</label>
          <textarea
            value={form.description}
            onChange={(e) => { setForm({ ...form, description: e.target.value }); setError(''); }}
            rows={4}
            placeholder="Describe the issue or service you need..."
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Preferred Date</label>
          <input
            type="date"
            value={form.preferredDate}
            onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Phone Number</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="(555) 123-4567"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Submitting...' : 'Submit Request'}
        </button>
      </form>
    </div>
  );
}
