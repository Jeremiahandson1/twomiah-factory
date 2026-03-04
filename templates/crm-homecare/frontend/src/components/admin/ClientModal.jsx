import { useState } from 'react';
import { createClient } from '../../config.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { X } from 'lucide-react';

const SERVICE_TYPES = ['personal_care', 'companionship', 'respite_care', 'skilled_nursing', 'homemaker'];

export default function ClientModal({ onClose, onSaved }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', address: '',
    city: '', state: '', zip: '', serviceType: 'personal_care',
    dateOfBirth: '', gender: '', insuranceProvider: '', insuranceId: '', notes: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName) return toast('First and last name required', 'error');
    setLoading(true);
    try {
      await createClient(form);
      toast('Client created', 'success');
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const field = (key, label, type = 'text', opts = {}) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1" {...opts} />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="font-bold text-lg">Add New Client</h2>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {field('firstName', 'First Name *')}
            {field('lastName', 'Last Name *')}
            {field('dateOfBirth', 'Date of Birth', 'date')}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
              <select value={form.gender} onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none">
                <option value="">Select…</option>
                {['Male', 'Female', 'Non-binary', 'Prefer not to say'].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            {field('phone', 'Phone', 'tel')}
            {field('email', 'Email', 'email')}
            {field('address', 'Address')}
            {field('city', 'City')}
            {field('state', 'State')}
            {field('zip', 'ZIP')}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Service Type</label>
              <select value={form.serviceType} onChange={e => setForm(p => ({ ...p, serviceType: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none">
                {SERVICE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            {field('insuranceProvider', 'Insurance Provider')}
            {field('insuranceId', 'Insurance ID')}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-70" style={{ backgroundColor: 'var(--color-primary)' }}>
              {loading ? 'Saving…' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
