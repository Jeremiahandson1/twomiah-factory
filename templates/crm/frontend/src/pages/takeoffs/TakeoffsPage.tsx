import { useState, useEffect } from 'react';
import {
  Calculator, Plus, Ruler, Package, Trash2,
  FileText, DollarSign, Loader2, ChevronRight,
  Download, Layers, Square, ArrowRight
} from 'lucide-react';
import api from '../../services/api';

interface TakeoffsPageProps {
  projectId?: string;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface SheetItem {
  id: string;
  name: string;
  planReference?: string;
  /*
   * The server sends item_count, which camelRows renames to itemCount. The old reader asked for
   * _count.items — a Prisma shape this codebase has never produced anywhere — so the sheet list
   * said "0 items" next to a sheet with two lines on it, and nothing could ever have made it say
   * otherwise. (T35 N3, carried from T32)
   */
  itemCount?: number | string;
  items?: TakeoffItem[];
}

interface MaterialData {
  materialName: string;
  baseQuantity: number;
  wasteQuantity: number;
  totalQuantity: number;
  unitCost: number;
  totalCost: number;
  unit: string;
}

interface TakeoffItem {
  id: string;
  name: string;
  location?: string;
  measurementType: string;
  measurementValue: number;
  length?: number;
  width?: number;
  height?: number;
  quantity?: number;
  wasteFactor?: number;
  assembly?: { name: string; wasteFactor?: number; measurementType?: string };
  calculatedMaterials?: MaterialData[];
}

interface AssemblyItem {
  id: string;
  name: string;
  category: string;
  measurementType: string;
}

interface TotalsData {
  totals: {
    materialCount: number;
    totalCost: number;
    totalPrice: number;
  };
}

const MEASUREMENT_LABELS: Record<string, string> = {
  area: 'Square Feet',
  linear: 'Linear Feet',
  count: 'Count',
  volume: 'Cubic Feet',
};

/**
 * Material Takeoff Page
 */
export default function TakeoffsPage({ projectId: propProjectId }: TakeoffsPageProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<string>(propProjectId || '');
  const [sheets, setSheets] = useState<SheetItem[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<SheetItem | null>(null);
  /**
   * Export to PO. (T32 M4)
   *
   * A purchase order is addressed to a vendor, so the button asks for one — wiring it straight to
   * the endpoint would raise an order addressed to nobody. Vendors only, which is the same list the
   * Bills form now asks for (T32 M13).
   */
  const [exportOpen, setExportOpen] = useState<boolean>(false);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [exportVendor, setExportVendor] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  useEffect(() => {
    if (!exportOpen || vendors.length) return;
    api.get('/api/contacts?type=vendor&limit=500')
      .then((res: Record<string, unknown>) => setVendors(((res?.data || res || []) as Array<{ id: string; name: string }>)))
      .catch(() => setVendors([]));
  }, [exportOpen]);
  const doExport = async () => {
    if (!selectedSheet || !exportVendor) return;
    setExporting(true);
    try {
      const po = await api.post(`/api/takeoffs/sheets/${selectedSheet.id}/export-po`, { vendorId: exportVendor }) as Record<string, unknown>;
      setExportOpen(false);
      setExportVendor('');
      // Straight to the order that was just raised — the point of the action, not a toast.
      if (po?.id) window.location.href = '/crm/purchase-orders';
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not raise the purchase order');
    } finally { setExporting(false); }
  };
  const [exportError, setExportError] = useState<string>('');
  const [assemblies, setAssemblies] = useState<AssemblyItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showNewSheet, setShowNewSheet] = useState<boolean>(false);
  const [showAddItem, setShowAddItem] = useState<boolean>(false);
  // Until the list arrives, "No projects found. Create a project first." is a lie on a tenant that
  // has projects — and now that the page no longer auto-selects, that message is actually reachable.
  // (T32 L1, the same guard SelectionsPage already carries)
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);

  // Load projects for standalone route (no projectId prop)
  useEffect(() => {
    if (!propProjectId) {
      api.get('/api/projects?limit=100').then((res: Record<string, unknown>) => {
        const data = (res?.data || res || []) as ProjectItem[];
        setProjects(data);
        /**
         * ONE project selects itself. TWO OR MORE is a choice. (T32 M4)
         *
         * This took `data[0].id` whatever the list held, so the chooser below never appeared and
         * the page opened on a project nobody picked — and a sheet created there was attached to
         * it silently. With a single project there is nothing to choose and making somebody pick
         * from a list of one is worse, so that case still selects itself.
         */
        if (data.length === 1 && !projectId) setProjectId(data[0].id);
        setProjectsLoaded(true);
      }).catch(() => setProjectsLoaded(true));
    }
  }, [propProjectId]);

  useEffect(() => {
    if (propProjectId) setProjectId(propProjectId);
  }, [propProjectId]);

  useEffect(() => {
    if (projectId) loadData();
  }, [projectId]);

  const loadData = async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [sheetsRes, assembliesRes] = await Promise.all([
        api.get(`/api/takeoffs/project/${projectId}`),
        api.get('/api/takeoffs/assemblies'),
      ]);
      setSheets((sheetsRes || []) as SheetItem[]);
      setAssemblies((assembliesRes || []) as AssemblyItem[]);

      // Auto-select first sheet
      if ((sheetsRes as SheetItem[])?.length > 0 && !selectedSheet) {
        loadSheet((sheetsRes as SheetItem[])[0].id);
      }
    } catch (error: unknown) {
      console.error('Failed to load takeoffs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSheet = async (sheetId: string) => {
    try {
      const sheet = await api.get(`/api/takeoffs/sheets/${sheetId}`);
      setSelectedSheet(sheet as SheetItem);
    } catch (error: unknown) {
      console.error('Failed to load sheet:', error);
    }
  };

  if (!projectId && !propProjectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <Calculator className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 mb-4 dark:text-slate-400">
            {projectsLoaded ? 'Select a project to view takeoffs' : 'Loading projects…'}
          </p>
          {!projectsLoaded ? null : projects.length > 0 ? (
            <select
              value={projectId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value)}
              className="px-4 py-2 border rounded-lg text-sm"
            >
              <option value="">Choose a project...</option>
              {projects.map((p: ProjectItem) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">No projects found. Create a project first.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Project selector (standalone mode) */}
      {!propProjectId && projects.length > 1 && (
        <div className="px-4 py-2 border-b bg-white flex items-center gap-2 dark:bg-slate-900">
          <span className="text-sm text-gray-500 dark:text-slate-400">Project:</span>
          <select
            value={projectId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setProjectId(e.target.value); setSelectedSheet(null); }}
            className="px-3 py-1.5 border rounded-lg text-sm font-medium"
          >
            {projects.map((p: ProjectItem) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar - Sheets List */}
      <div className="w-64 border-r bg-gray-50 flex flex-col dark:bg-slate-900">
        <div className="p-4 border-b">
          <h3 className="font-medium text-gray-900 dark:text-slate-100">Takeoff Sheets</h3>
          <button
            onClick={() => setShowNewSheet(true)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            New Sheet
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sheets.map((sheet: SheetItem) => (
            <button
              key={sheet.id}
              onClick={() => loadSheet(sheet.id)}
              /*
               * T32 M14 · the selected sheet's name measured 1.00:1 — invisible.
               *
               * `bg-orange-50` is a near-white cream and had no dark partner, so in dark mode the
               * SELECTED row kept a near-white ground while the name below it renders
               * dark:text-slate-100, which is also near-white. Same colour, no contrast at all, and
               * only on the row the user had just clicked.
               *
               * The hover and the divider were unpaired for the same reason and are fixed with it:
               * a contrast fix is the pair, and fixing the one cell the report measured would have
               * left the row beside it wrong.
               */
              className={`w-full px-4 py-3 text-left border-b hover:bg-gray-100 dark:border-slate-800 dark:hover:bg-slate-800 ${
                selectedSheet?.id === sheet.id ? 'bg-orange-50 border-l-4 border-l-orange-500 dark:bg-orange-950/40' : ''
              }`}
            >
              <p className="font-medium text-sm text-gray-900 dark:text-slate-100">{sheet.name}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">{Number(sheet.itemCount || 0)} {Number(sheet.itemCount || 0) === 1 ? 'item' : 'items'}</p>
            </button>
          ))}
          {sheets.length === 0 && !loading && (
            <div className="p-4 text-center text-gray-500 text-sm dark:text-slate-400">
              No takeoff sheets yet
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : selectedSheet ? (
          <>
            {/* Sheet Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{selectedSheet.name}</h2>
                {selectedSheet.planReference && (
                  <p className="text-sm text-gray-500 dark:text-slate-400">Plan: {selectedSheet.planReference}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddItem(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
                >
                  <Ruler className="w-4 h-4" />
                  Add Measurement
                </button>
              </div>
            </div>

            {/* Items Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedSheet.items && selectedSheet.items.length > 0 ? (
                <div className="space-y-4">
                  {selectedSheet.items.map((item: TakeoffItem) => (
                    <TakeoffItemCard
                      key={item.id}
                      item={item}
                      onUpdate={() => loadSheet(selectedSheet.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calculator className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-500 dark:text-slate-400">No measurements yet</p>
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="mt-4 text-orange-600 hover:text-orange-700 dark:hover:text-orange-200 dark:text-orange-300"
                  >
                    Add your first measurement
                  </button>
                </div>
              )}
            </div>

            {/* Totals Footer */}
            {selectedSheet.items && selectedSheet.items.length > 0 && (
              <TotalsFooter sheetId={selectedSheet.id} onExport={() => setExportOpen(true)} />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-slate-400">
            Select or create a takeoff sheet
          </div>
        )}
      </div>
      </div>

      {/* New Sheet Modal */}
      {showNewSheet && (
        <NewSheetModal
          projectId={projectId}
          onSave={(sheet: SheetItem) => {
            setShowNewSheet(false);
            loadData();
            loadSheet(sheet.id);
          }}
          onClose={() => setShowNewSheet(false)}
        />
      )}

      {/* Add Item Modal */}
      {showAddItem && selectedSheet && (
        <AddItemModal
          sheetId={selectedSheet.id}
          assemblies={assemblies}
          onSave={() => {
            setShowAddItem(false);
            loadSheet(selectedSheet.id);
          }}
          onClose={() => setShowAddItem(false)}
        />
      )}

      {/*
        * Export to purchase order. (T32 M4, moved here by the T33 blocker fix)
        *
        * It lives beside the other two modals, in the component that owns `exportOpen`, `vendors`,
        * `exportVendor`, `exporting`, `exportError` and `doExport`. It was inside TotalsFooter,
        * which has none of them — that threw on render and blanked the page. The dialog is
        * `position: fixed`, so where it sits in the tree makes no difference to what you see.
        */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setExportOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Export to purchase order" className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">Export to purchase order</h3>
            <p className="text-sm text-gray-600 dark:text-slate-300">
              The materials on <strong>{selectedSheet?.name}</strong> become the lines of a new purchase order.
            </p>
            {/*
              * WHY THE ORDER COSTS MORE THAN THE SHEET. (T35-13)
              *
              * The tester reconciled both figures to the cent and found the PO $12.00 above the
              * sheet: the sheet costs the measured quantity (15.95 sheets of drywall, 23.925 studs)
              * and the order has to ask for whole ones. Neither figure is wrong and the difference
              * is not an error — but finding that out took arithmetic, which is exactly the kind of
              * unexplained gap between two money figures that makes somebody distrust both.
              */}
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              Quantities are rounded <strong>up</strong> to whole units — you cannot buy 15.95 sheets of
              drywall — so the order total usually sits a little above the sheet's measured cost.
            </p>
            <label className="block text-sm font-medium mt-4 mb-1 text-gray-700 dark:text-slate-200">Vendor *</label>
            <select value={exportVendor} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExportVendor(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              <option value="">Choose a vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {!vendors.length && <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">No vendors on file yet — add one under Contacts first.</p>}
            {exportError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{exportError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setExportOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={doExport} disabled={!exportVendor || exporting} className="px-4 py-2 rounded-lg text-sm bg-orange-500 text-white disabled:opacity-50">
                {exporting ? 'Raising…' : 'Raise purchase order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TakeoffItemCardProps {
  item: TakeoffItem;
  onUpdate: () => void;
}

function TakeoffItemCard({ item, onUpdate }: TakeoffItemCardProps) {
  const [expanded, setExpanded] = useState<boolean>(false);

  const handleDelete = async () => {
    if (!confirm('Delete this measurement?')) return;
    try {
      await api.delete(`/api/takeoffs/items/${item.id}`);
      onUpdate();
    } catch (error: unknown) {
      alert('Failed to delete');
    }
  };

  const totalCost = item.calculatedMaterials?.reduce(
    (sum: number, m: MaterialData) => sum + Number(m.totalCost), 0
  ) || 0;

  return (
    <div className="bg-white rounded-xl border overflow-hidden dark:bg-slate-900">
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center dark:bg-blue-950/40">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-300" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-slate-100">{item.name}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {item.location && `${item.location} \u2022 `}
              {item.assembly?.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900 dark:text-slate-100">
              {Number(item.measurementValue).toLocaleString()} {MEASUREMENT_LABELS[item.measurementType]?.split(' ')[0]}
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400">${totalCost.toFixed(2)} materials</p>
          </div>
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t">
          {/* Measurements */}
          <div className="p-4 bg-gray-50 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm dark:bg-slate-900">
            {item.measurementType === 'area' && (
              <>
                <div>
                  <span className="text-gray-500 dark:text-slate-400">Length:</span>
                  <span className="ml-2 font-medium">{Number(item.length)} ft</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-slate-400">Width:</span>
                  <span className="ml-2 font-medium">{Number(item.width)} ft</span>
                </div>
              </>
            )}
            {item.measurementType === 'linear' && (
              <div>
                <span className="text-gray-500 dark:text-slate-400">Length:</span>
                <span className="ml-2 font-medium">{Number(item.length)} ft</span>
              </div>
            )}
            {item.measurementType === 'count' && (
              <div>
                <span className="text-gray-500 dark:text-slate-400">Quantity:</span>
                <span className="ml-2 font-medium">{item.quantity}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500 dark:text-slate-400">Waste Factor:</span>
              <span className="ml-2 font-medium">{Number(item.wasteFactor || item.assembly?.wasteFactor || 0)}%</span>
            </div>
          </div>

          {/* Materials List */}
          <div className="p-4">
            <p className="text-sm font-medium text-gray-700 mb-2 dark:text-slate-200">Calculated Materials</p>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900">
                <tr>
                  <th className="text-left px-3 py-2">Material</th>
                  <th className="text-right px-3 py-2">Base Qty</th>
                  <th className="text-right px-3 py-2">Waste</th>
                  <th className="text-right px-3 py-2">Total Qty</th>
                  <th className="text-right px-3 py-2">Unit Cost</th>
                  <th className="text-right px-3 py-2">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {item.calculatedMaterials?.map((mat: MaterialData, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{mat.materialName}</td>
                    <td className="px-3 py-2 text-right">{Number(mat.baseQuantity).toFixed(2)} {mat.unit}</td>
                    <td className="px-3 py-2 text-right text-orange-600 dark:text-orange-300">+{Number(mat.wasteQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">{Number(mat.totalQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">${Number(mat.unitCost).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">${Number(mat.totalCost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="p-4 border-t flex justify-end">
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface TotalsFooterProps {
  sheetId: string;
  /**
   * Ask the PARENT to open the export dialog.
   *
   * T33 blocker, and it was mine: when I wired the Export to PO button (T32 M4) I put it — and its
   * whole modal — inside this component, while `selectedSheet`, `exportOpen`, `vendors`, `doExport`
   * and the rest are state on TakeoffsPage. None of those names is in scope here, so the first
   * render of this footer threw `ReferenceError: selectedSheet is not defined` and blanked the
   * entire page. The footer renders as soon as a sheet with items is opened, so clicking any sheet
   * took the screen down on every tenant.
   *
   * It is a callback rather than the nine values the modal needed, because a totals footer has no
   * business knowing about vendors: it asks for the dialog, the page owns it. The modal moved up to
   * TakeoffsPage, which changes nothing on screen — it is `position: fixed`.
   */
  onExport: () => void;
}

function TotalsFooter({ sheetId, onExport }: TotalsFooterProps) {
  const [totals, setTotals] = useState<TotalsData | null>(null);

  useEffect(() => {
    loadTotals();
  }, [sheetId]);

  const loadTotals = async () => {
    try {
      const data = await api.get(`/api/takeoffs/sheets/${sheetId}/totals`);
      setTotals(data as TotalsData);
    } catch (error: unknown) {
      console.error('Failed to load totals:', error);
    }
  };

  if (!totals?.totals) return null;

  return (
    <div className="border-t bg-gray-50 p-4 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-sm text-gray-500 dark:text-slate-400">Materials</p>
            <p className="text-lg font-bold">{totals.totals.materialCount || 0}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-slate-400">Total Cost</p>
            <p className="text-lg font-bold text-green-700 dark:text-green-400">${(totals.totals.totalCost || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-slate-400">Total Price</p>
            <p className="text-lg font-bold">${(totals.totals.totalPrice || 0).toFixed(2)}</p>
          </div>
        </div>
        {/* Wired. This had no onClick at all — a dead button on the one screen whose purpose is
            turning quantities into an order. (T32 M4)
            The footer only renders inside the `selectedSheet` branch, so the old
            `disabled={!selectedSheet}` was always false — and reading that name here is what threw. */}
        <button
          onClick={onExport}
          title="Raise a purchase order from this sheet"
          /**
           * `hover:bg-white` with no dark partner is M14's "Export to PO turns white on hover" — in
           * dark mode the surface went white under light text and the label vanished. The guard
           * check-light-card-dark-text.ts caught it the moment this element was touched, which is
           * what it is for. Both themes get a hover, and the text is explicit in both.
           */
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-900"
        >
          <Download className="w-4 h-4" />
          Export to PO
        </button>
      </div>
    </div>
  );
}

interface NewSheetModalProps {
  projectId: string;
  onSave: (sheet: SheetItem) => void;
  onClose: () => void;
}

function NewSheetModal({ projectId, onSave, onClose }: NewSheetModalProps) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    planReference: '',
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const sheet = await api.post(`/api/takeoffs/project/${projectId}`, form);
      onSave(sheet as SheetItem);
    } catch (error: unknown) {
      alert('Failed to create sheet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold mb-4">New Takeoff Sheet</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., First Floor Framing"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Plan Reference</label>
              <input
                type="text"
                value={form.planReference}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, planReference: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Sheet A-101"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea
                value={form.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Creating...' : 'Create Sheet'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

interface AddItemModalProps {
  sheetId: string;
  assemblies: AssemblyItem[];
  onSave: () => void;
  onClose: () => void;
}

function AddItemModal({ sheetId, assemblies, onSave, onClose }: AddItemModalProps) {
  const [form, setForm] = useState({
    assemblyId: '',
    name: '',
    location: '',
    length: '',
    width: '',
    height: '',
    quantity: '1',
  });
  const [saving, setSaving] = useState<boolean>(false);

  const selectedAssembly = assemblies.find((a: AssemblyItem) => a.id === form.assemblyId);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/takeoffs/sheets/${sheetId}/items`, {
        ...form,
        // quantity holds text while it is typed; it becomes a number here, once
        quantity: Number(form.quantity) || 0,
        name: form.name || selectedAssembly?.name,
      });
      onSave();
    } catch (error: unknown) {
      alert('Failed to add measurement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold mb-4">Add Measurement</h2>

          {/*
            A fresh tenant has no assemblies, and no screen creates one — so the dropdown below was
            empty and a measurement could not be added at all. The product already knows how to seed
            a standard set (POST /api/takeoffs/assemblies/seed); nothing ever offered it. (T32 B5)

            Shown only when the list is empty, so it is a way out of a dead end rather than a button
            that invites duplicate assemblies.
          */}
          {assemblies.length === 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <p className="text-amber-900 dark:text-amber-200">
                No assemblies yet. An assembly is the recipe — what a square foot of drywall or a linear
                foot of wall framing costs in materials.
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.post('/api/takeoffs/assemblies/seed', {});
                    onSave();
                  } catch {
                    alert('Could not add the standard assemblies');
                  }
                }}
                className="mt-2 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-800"
              >
                Add the standard assemblies
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Assembly Type</label>
              <select
                value={form.assemblyId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, assemblyId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select assembly...</option>
                {Object.entries(
                  assemblies.reduce((acc: Record<string, AssemblyItem[]>, a: AssemblyItem) => {
                    if (!acc[a.category]) acc[a.category] = [];
                    acc[a.category].push(a);
                    return acc;
                  }, {} as Record<string, AssemblyItem[]>)
                ).map(([category, items]: [string, AssemblyItem[]]) => (
                  <optgroup key={category} label={category.charAt(0).toUpperCase() + category.slice(1)}>
                    {items.map((a: AssemblyItem) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name (Optional)</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder={selectedAssembly?.name || 'Same as assembly'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Living Room"
                />
              </div>
            </div>

            {/*
              * Found by widening check-unpaired-dark-ink's walk to the base CRM frontend, which it
              * had never looked at. The `text-gray-900` here was dead weight — the only child sets
              * its own colour — and both the panel and that child were unpaired, so this hint
              * stayed a near-white card inside a dark modal. (T32 M14)
              */}
            {selectedAssembly && (
              <div className="p-3 bg-blue-50 rounded-lg dark:bg-blue-950/40">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Measurement type: <strong>{MEASUREMENT_LABELS[selectedAssembly.measurementType]}</strong>
                </p>
              </div>
            )}

            {/* Measurement Fields */}
            {selectedAssembly?.measurementType === 'area' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Length (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.length}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Width (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.width}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, width: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
              </div>
            )}

            {selectedAssembly?.measurementType === 'linear' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Length (ft)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.length}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, length: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
            )}

            {selectedAssembly?.measurementType === 'count' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Quantity</label>
                <input
                  type="number"
                  value={form.quantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  min="1"
                  required
                />
              </div>
            )}

            {selectedAssembly?.measurementType === 'volume' && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Length (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.length}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Width (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.width}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, width: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Height (ft)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.height}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, height: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.assemblyId}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Measurement'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
