import { useState, useEffect } from 'react';
import { Banknote, Lock, Unlock, Clock, DollarSign, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { ConfirmModal } from '../components/ui/Modal';

export default function CashPage() {
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [openingAmount, setOpeningAmount] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionData, historyData] = await Promise.all([
        api.get('/api/cash/sessions', { status: 'open', limit: 1 }).then((r: any) => {
          const data = r?.data || (Array.isArray(r) ? r : []);
          return data[0] || null;
        }).catch(() => null),
        api.get('/api/cash/sessions', { limit: 20 }),
      ]);
      setCurrentSession(sessionData);
      setSessions(Array.isArray(historyData) ? historyData : historyData?.data || []);
    } catch (err) {
      console.error('Failed to load cash data:', err);
    } finally {
      setLoading(false);
    }
  };

  const openSession = async () => {
    const amount = parseFloat(openingAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid opening amount');
      return;
    }
    setOpening(true);
    try {
      const data = await api.post('/api/cash/sessions/open', { openingAmount: amount });
      setCurrentSession(data);
      toast.success('Cash drawer opened');
      setOpeningAmount('');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to open cash drawer');
    } finally {
      setOpening(false);
    }
  };

  const closeSession = async () => {
    const amount = parseFloat(closingAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Enter a valid closing amount');
      return;
    }
    setClosing(true);
    try {
      await api.post(`/api/cash/sessions/${currentSession.id}/close`, {
        closingAmount: amount,
        notes: closingNotes,
      });
      setCurrentSession(null);
      toast.success('Cash drawer closed');
      setClosingAmount('');
      setClosingNotes('');
      setCloseConfirm(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to close cash drawer');
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const expectedClosing = currentSession
    ? Number(currentSession.openingAmount || 0) + Number(currentSession.cashSales || 0) - Number(currentSession.cashRefunds || 0)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cash Management</h1>
        <p className="text-gray-600">Manage cash drawer sessions</p>
      </div>

      {/* Current Session */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {currentSession && currentSession.status === 'open' ? (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <Unlock className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Drawer Open</h2>
                <p className="text-sm text-gray-500">
                  Opened by {currentSession.openedByName || user?.firstName} at{' '}
                  {currentSession.openedAt ? new Date(currentSession.openedAt).toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Opening Amount</p>
                <p className="text-xl font-bold text-gray-900">${Number(currentSession.openingAmount || 0).toFixed(2)}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Cash Sales</p>
                <p className="text-xl font-bold text-green-600">${Number(currentSession.cashSales || 0).toFixed(2)}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Cash Refunds</p>
                <p className="text-xl font-bold text-red-600">${Number(currentSession.cashRefunds || 0).toFixed(2)}</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-sm text-green-700">Expected in Drawer</p>
                <p className="text-xl font-bold text-green-700">${expectedClosing.toFixed(2)}</p>
              </div>
            </div>

            {/* Close Drawer */}
            <div className="border-t pt-6">
              <h3 className="font-medium text-gray-900 mb-3">Close Drawer</h3>
              <div className="grid md:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Counted Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={closingAmount}
                    onChange={(e) => setClosingAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="End of shift notes"
                  />
                </div>
              </div>
              {closingAmount && (
                <div className="mt-3">
                  {(() => {
                    const diff = parseFloat(closingAmount) - expectedClosing;
                    if (Math.abs(diff) < 0.01) {
                      return (
                        <p className="text-green-600 text-sm flex items-center gap-1">
                          <CheckCircle className="w-4 h-4" /> Drawer balanced
                        </p>
                      );
                    }
                    return (
                      <p className={`text-sm flex items-center gap-1 ${diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        <AlertCircle className="w-4 h-4" />
                        {diff > 0 ? 'Over' : 'Short'} by ${Math.abs(diff).toFixed(2)}
                      </p>
                    );
                  })()}
                </div>
              )}
              <div className="mt-4">
                <button
                  onClick={() => setCloseConfirm(true)}
                  disabled={!closingAmount}
                  className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
                    closingAmount
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <Lock className="w-4 h-4" /> Close Drawer
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <Lock className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Drawer Closed</h2>
                <p className="text-sm text-gray-500">Open the cash drawer to start a new session</p>
              </div>
            </div>
            <div className="max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Opening Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 mb-3"
                placeholder="200.00"
              />
              <Button onClick={openSession} disabled={opening || !openingAmount}>
                <Unlock className="w-4 h-4 mr-2 inline" />
                {opening ? 'Opening...' : 'Open Drawer'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Session History */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900">Session History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Opened By</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Opening</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cash Sales</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expected</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Counted</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map(session => {
                const expected = Number(session.openingAmount || 0) + Number(session.cashSales || 0) - Number(session.cashRefunds || 0);
                const variance = session.closingAmount != null ? Number(session.closingAmount) - expected : null;
                return (
                  <tr key={session.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {session.openedAt ? new Date(session.openedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{session.openedByName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">${Number(session.openingAmount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-green-600">${Number(session.cashSales || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">${expected.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">
                      {session.closingAmount != null ? `$${Number(session.closingAmount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      {variance != null ? (
                        <span className={`font-medium ${
                          Math.abs(variance) < 0.01 ? 'text-green-600' :
                          variance > 0 ? 'text-blue-600' : 'text-red-600'
                        }`}>
                          {variance > 0 ? '+' : ''}{variance.toFixed(2)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        session.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {session.status || 'closed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No session history</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={closeConfirm}
        onClose={() => setCloseConfirm(false)}
        onConfirm={closeSession}
        title="Close Cash Drawer"
        message={`Close the cash drawer with a counted amount of $${parseFloat(closingAmount || '0').toFixed(2)}?`}
        confirmText="Close Drawer"
        loading={closing}
      />
    </div>
  );
}
