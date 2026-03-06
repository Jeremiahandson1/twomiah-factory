import { useState } from 'react';
import { 
  Trash2, Edit2, Archive, UserPlus, Calendar, CheckCircle, 
  X, Loader2, AlertTriangle 
} from 'lucide-react';
import api from '../../services/api';

/**
 * Bulk Action Bar
 * 
 * Shows when items are selected, provides bulk operations
 * 
 * Usage:
 *   <BulkActionBar
 *     selectedIds={selectedIds}
 *     entityType="jobs"
 *     onClear={() => setSelectedIds([])}
 *     onComplete={() => { setSelectedIds([]); reload(); }}
 *     actions={['delete', 'status', 'assign']}
 *   />
 */
export default function BulkActionBar({ 
  selectedIds = [], 
  entityType, 
  onClear, 
  onComplete,
  actions = ['delete'],
  customActions = [],
  users = [], // For assign action
  statuses = [], // For status change
}) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(null);
  const [actionData, setActionData] = useState({});

  if (selectedIds.length === 0) return null;

  const handleAction = async (action) => {
    if (action === 'delete') {
      setShowConfirm('delete');
      return;
    }
    
    await executeAction(action, actionData);
  };

  const executeAction = async (action, data = {}) => {
    setLoading(true);
    try {
      let endpoint = `/bulk/${entityType}`;
      let payload = { ids: selectedIds };

      switch (action) {
        case 'delete':
          endpoint += '/delete';
          break;
        case 'archive':
          endpoint += '/archive';
          break;
        case 'assign':
          endpoint += '/assign';
          payload.assignedToId = data.assignedToId;
          break;
        case 'status':
          endpoint += '/status';
          payload.status = data.status;
          break;
        case 'reschedule':
          endpoint += '/reschedule';
          payload.scheduledDate = data.scheduledDate;
          break;
        case 'update':
          endpoint += '/update';
          payload.updates = data.updates;
          break;
        case 'mark-paid':
          endpoint += '/mark-paid';
          break;
        case 'approve':
          endpoint += '/approve';
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      await api.post(endpoint, payload);
      onComplete?.();
    } catch (error) {
      alert(`Action failed: ${error.message}`);
    } finally {
      setLoading(false);
      setShowConfirm(null);
      setActionData({});
    }
  };

  const confirmDelete = () => {
    executeAction('delete');
  };

  return (
    <>
      {/* Action Bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
        <div className="bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4">
          {/* Selected count */}
          <div className="flex items-center gap-2 pr-4 border-r border-gray-700">
            <span className="bg-orange-500 text-white text-sm font-bold px-2 py-0.5 rounded">
              {selectedIds.length}
            </span>
            <span className="text-sm">selected</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Status change */}
            {actions.includes('status') && statuses.length > 0 && (
              <select
                value={actionData.status || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    executeAction('status', { status: e.target.value });
                  }
                }}
                className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700"
                disabled={loading}
              >
                <option value="">Change Status</option>
                {statuses.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            )}

            {/* Assign */}
            {actions.includes('assign') && users.length > 0 && (
              <select
                value={actionData.assignedToId || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    executeAction('assign', { assignedToId: e.target.value });
                  }
                }}
                className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700"
                disabled={loading}
              >
                <option value="">Assign To</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            )}

            {/* Reschedule */}
            {actions.includes('reschedule') && (
              <input
                type="date"
                onChange={(e) => {
                  if (e.target.value) {
                    executeAction('reschedule', { scheduledDate: e.target.value });
                  }
                }}
                className="bg-gray-800 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-700"
                disabled={loading}
              />
            )}

            {/* Archive */}
            {actions.includes('archive') && (
              <button
                onClick={() => handleAction('archive')}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm"
              >
                <Archive className="w-4 h-4" />
                Archive
              </button>
            )}

            {/* Mark Paid */}
            {actions.includes('mark-paid') && (
              <button
                onClick={() => executeAction('mark-paid')}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Paid
              </button>
            )}

            {/* Approve (time entries) */}
            {actions.includes('approve') && (
              <button
                onClick={() => executeAction('approve')}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
            )}

            {/* Custom actions */}
            {customActions.map((action) => (
              <button
                key={action.id}
                onClick={() => action.onClick(selectedIds)}
                disabled={loading}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${action.className || 'bg-gray-800 hover:bg-gray-700'}`}
              >
                {action.icon && <action.icon className="w-4 h-4" />}
                {action.label}
              </button>
            ))}

            {/* Delete */}
            {actions.includes('delete') && (
              <button
                onClick={() => handleAction('delete')}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}

          {/* Clear selection */}
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-gray-800 rounded-lg ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showConfirm === 'delete' && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowConfirm(null)} />
          <div className="relative min-h-screen flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Delete {selectedIds.length} items?</h3>
                  <p className="text-gray-500">This action cannot be undone.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Checkbox for selecting items
 */
export function SelectCheckbox({ checked, onChange, className = '' }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={`w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500 ${className}`}
    />
  );
}

/**
 * Select all checkbox for table headers
 */
export function SelectAllCheckbox({ selectedIds, allIds, onSelectAll, onClearAll }) {
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < allIds.length;

  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      onChange={(e) => {
        if (e.target.checked) {
          onSelectAll();
        } else {
          onClearAll();
        }
      }}
      className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500 text-gray-900"
    />
  );
}

/**
 * Hook for managing selection state
 */
export function useSelection(initialIds = []) {
  const [selectedIds, setSelectedIds] = useState(initialIds);

  const toggle = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const selectAll = (ids) => {
    setSelectedIds(ids);
  };

  const clear = () => {
    setSelectedIds([]);
  };

  const isSelected = (id) => selectedIds.includes(id);

  return {
    selectedIds,
    toggle,
    selectAll,
    clear,
    isSelected,
  };
}
