import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { Plus, Search, User } from 'lucide-react';
import { useToast } from '../contexts/ToastContext.jsx';
import ClientModal from '../components/admin/ClientModal.jsx';

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/clients?isActive=true&limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setClients(data.clients || []);
      setTotal(data.total || 0);
    } catch (err) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [search]);

  const serviceLabel = (type) => ({
    personal_care: 'Personal Care', companionship: 'Companion', respite_care: 'Respite',
    skilled_nursing: 'Skilled Nursing', homemaker: 'Homemaker',
  }[type] || type || 'General');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500">{total} active clients</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={16} /> Add Client
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search clients…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
      </div>

      {loading ? <div className="text-gray-400 py-8 text-center">Loading…</div> : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Service</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Caregiver</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Onboarding</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/clients/${c.id}`} className="font-medium text-gray-900 hover:underline">
                      {c.lastName}, {c.firstName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{serviceLabel(c.serviceType)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.assignments?.[0]?.caregiver ? `${c.assignments[0].caregiver.firstName} ${c.assignments[0].caregiver.lastName}` : <span className="text-yellow-600">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${c.onboarding?.allCompleted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {c.onboarding?.allCompleted ? 'Complete' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!clients.length && <p className="text-center text-gray-400 py-8">No clients found</p>}
        </div>
      )}

      {showModal && <ClientModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />}
    </div>
  );
}
