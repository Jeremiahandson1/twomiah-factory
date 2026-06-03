import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Palette, Check, Clock, ChevronDown, ChevronUp, Loader2, ImageIcon, StickyNote } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  selected: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  ordered: 'bg-purple-100 text-purple-700',
  received: 'bg-gray-100 text-gray-700',
};

export default function PortalSelections() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selections, setSelections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectionsLoading, setSelectionsLoading] = useState(false);

  // Load projects first
  useEffect(() => {
    async function loadProjects() {
      try {
        const data = await portalFetch('/projects');
        setProjects(data);
        if (data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, [portalFetch]);

  // Load selections when project changes
  useEffect(() => {
    if (!selectedProjectId) return;

    async function loadSelections() {
      setSelectionsLoading(true);
      try {
        const data = await portalFetch(`/selections/project/${selectedProjectId}/selections`);
        setSelections(data);
      } catch (error) {
        console.error('Failed to load selections:', error);
        setSelections([]);
      } finally {
        setSelectionsLoading(false);
      }
    }
    loadSelections();
  }, [portalFetch, selectedProjectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Selections</h1>
          <p className="text-gray-600">Choose finishes, fixtures, and materials for your project.</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Palette className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No projects available.</p>
        </div>
      </div>
    );
  }

  // Group selections by category
  const grouped: Record<string, any[]> = {};
  for (const sel of selections) {
    const catName = sel.category?.name || 'Uncategorized';
    if (!grouped[catName]) grouped[catName] = [];
    grouped[catName].push(sel);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Selections</h1>
        <p className="text-gray-600">Choose finishes, fixtures, and materials for your project.</p>
      </div>

      {/* Project selector */}
      {projects.length > 1 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="block w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.number})</option>
            ))}
          </select>
        </div>
      )}

      {selectionsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : selections.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Palette className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No selections available for this project yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <CategoryGroup
              key={category}
              category={category}
              items={items}
              projectId={selectedProjectId!}
              portalFetch={portalFetch}
              onUpdate={(updatedSel) => {
                setSelections((prev) =>
                  prev.map((s) => (s.id === updatedSel.id ? { ...s, ...updatedSel, status: 'selected' } : s))
                );
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  category,
  items,
  projectId,
  portalFetch,
  onUpdate,
}: {
  category: string;
  items: any[];
  projectId: string;
  portalFetch: any;
  onUpdate: (sel: any) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const totalAllowance = items.reduce((sum, s) => sum + Number(s.allowance || 0), 0);
  const totalSelected = items.reduce((sum, s) => {
    if (s.selected_option) {
      return sum + Number(s.selected_option.price) * Number(s.quantity || 1);
    }
    return sum;
  }, 0);
  const pendingCount = items.filter((s) => s.status === 'pending').length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Palette className="w-5 h-5 text-purple-600" />
          </div>
          <div className="text-left">
            <h2 className="font-semibold text-gray-900">{category}</h2>
            <p className="text-sm text-gray-500">
              {items.length} selection{items.length !== 1 ? 's' : ''}
              {pendingCount > 0 && (
                <span className="ml-2 text-orange-600 font-medium">
                  {pendingCount} awaiting your choice
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {totalAllowance > 0 && (
            <div className="text-right text-sm">
              <p className="text-gray-500">Allowance</p>
              <p className="font-medium">${totalAllowance.toLocaleString()}</p>
            </div>
          )}
          {totalSelected > 0 && (
            <div className="text-right text-sm">
              <p className="text-gray-500">Selected</p>
              <p className={`font-medium ${totalSelected > totalAllowance ? 'text-red-600' : 'text-green-600'}`}>
                ${totalSelected.toLocaleString()}
                {totalAllowance > 0 && (
                  <span className="text-xs ml-1">
                    ({totalSelected - totalAllowance >= 0 ? '+' : ''}${(totalSelected - totalAllowance).toLocaleString()})
                  </span>
                )}
              </p>
            </div>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {items.map((sel) => (
            <SelectionItem
              key={sel.id}
              selection={sel}
              projectId={projectId}
              portalFetch={portalFetch}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionItem({
  selection,
  projectId,
  portalFetch,
  onUpdate,
}: {
  selection: any;
  projectId: string;
  portalFetch: any;
  onUpdate: (sel: any) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const canSelect = selection.status === 'pending' || selection.status === 'selected';
  const options = selection.availableOptionsList || [];
  const allowance = Number(selection.allowance || 0);
  const quantity = Number(selection.quantity || 1);

  const handleSelect = async (optionId: string) => {
    setSubmitting(true);
    setConfirmed(false);
    try {
      const result = await portalFetch(`/selections/project/${projectId}/selections/${selection.id}`, {
        method: 'POST',
        body: JSON.stringify({ optionId, notes: notes || undefined }),
      });
      onUpdate({ ...result, id: selection.id });
      setConfirmed(true);
      setShowOptions(false);
      setNotes('');
      setTimeout(() => setConfirmed(false), 3000);
    } catch (error: any) {
      alert('Failed to make selection: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900">{selection.name}</h3>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[selection.status] || 'bg-gray-100 text-gray-700'}`}>
              {selection.status}
            </span>
          </div>
          {selection.description && (
            <p className="text-sm text-gray-500 mt-1">{selection.description}</p>
          )}
          {selection.location && (
            <p className="text-xs text-gray-400 mt-1">Location: {selection.location}</p>
          )}
          {selection.due_date && (
            <p className={`text-xs mt-1 ${new Date(selection.due_date) < new Date() && selection.status === 'pending' ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
              Due: {new Date(selection.due_date).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
          {allowance > 0 && (
            <p className="text-gray-500">
              Allowance: <span className="font-medium text-gray-700">${allowance.toLocaleString()}</span>
            </p>
          )}
          {selection.selected_option && (
            <p className="text-gray-700 font-medium">
              Selected: ${(Number(selection.selected_option.price) * quantity).toLocaleString()}
              {allowance > 0 && (
                <span className={`ml-1 text-xs ${Number(selection.selected_option.price) * quantity > allowance ? 'text-red-600' : 'text-green-600'}`}>
                  ({Number(selection.selected_option.price) * quantity - allowance >= 0 ? '+' : ''}
                  ${(Number(selection.selected_option.price) * quantity - allowance).toLocaleString()})
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Current selection */}
      {selection.selected_option && (
        <div className="mt-2 p-3 bg-blue-50 rounded-lg flex items-center gap-3">
          <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">
              {selection.selected_option.name}
              {selection.selected_option.manufacturer && (
                <span className="text-blue-600 font-normal"> by {selection.selected_option.manufacturer}</span>
              )}
            </p>
            {selection.client_notes && (
              <p className="text-xs text-blue-700 mt-1">Note: {selection.client_notes}</p>
            )}
          </div>
          {selection.selected_option.image_url && (
            <img src={selection.selected_option.image_url} alt="" className="w-12 h-12 rounded object-cover" />
          )}
        </div>
      )}

      {/* Confirmation banner */}
      {confirmed && (
        <div className="mt-2 p-3 bg-green-50 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5 text-green-600" />
          <p className="text-sm font-medium text-green-800">Selection saved successfully!</p>
        </div>
      )}

      {/* Toggle options */}
      {canSelect && options.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowOptions(!showOptions)}
            className="text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
          >
            {showOptions ? 'Hide options' : `View ${options.length} option${options.length !== 1 ? 's' : ''}`}
            {showOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showOptions && (
            <div className="mt-3 space-y-3">
              {/* Notes field */}
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                  <StickyNote className="w-3 h-3" />
                  Add a note (optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Prefer matte finish..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              {/* Options grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {options.map((option: any) => {
                  const isSelected = selection.selected_option_id === option.id;
                  const totalPrice = Number(option.totalPrice || option.price * quantity);
                  const priceDiff = Number(option.priceDiff ?? (totalPrice - allowance));

                  return (
                    <div
                      key={option.id}
                      className={`border rounded-lg p-3 transition-all cursor-pointer hover:shadow-md ${
                        isSelected
                          ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50'
                          : 'border-gray-200 hover:border-orange-300'
                      }`}
                      onClick={() => !submitting && handleSelect(option.id)}
                    >
                      {option.image_url ? (
                        <img src={option.image_url} alt={option.name} className="w-full h-32 object-cover rounded mb-2" />
                      ) : (
                        <div className="w-full h-32 bg-gray-100 rounded mb-2 flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-gray-300" />
                        </div>
                      )}
                      <p className="font-medium text-sm text-gray-900">{option.name}</p>
                      {option.manufacturer && (
                        <p className="text-xs text-gray-500">{option.manufacturer}{option.model ? ` - ${option.model}` : ''}</p>
                      )}
                      {option.description && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{option.description}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-sm font-bold text-gray-900">${totalPrice.toLocaleString()}</p>
                        {allowance > 0 && (
                          <span className={`text-xs font-medium ${priceDiff > 0 ? 'text-red-600' : priceDiff < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                            {priceDiff > 0 ? '+' : ''}{priceDiff !== 0 ? `$${priceDiff.toLocaleString()}` : 'Within allowance'}
                          </span>
                        )}
                      </div>
                      {option.lead_time_days > 0 && (
                        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {option.lead_time_days} day lead time
                        </p>
                      )}
                      {isSelected && (
                        <div className="mt-2 flex items-center gap-1 text-blue-600 text-xs font-medium">
                          <Check className="w-3 h-3" /> Currently selected
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {submitting && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving your selection...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
