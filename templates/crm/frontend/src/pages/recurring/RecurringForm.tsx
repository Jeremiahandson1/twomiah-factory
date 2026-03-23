import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import api from '../../services/api';

interface FrequencyOption {
  value: string;
  label: string;
}

interface DayOfWeekOption {
  value: number;
  label: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface RecurringFormState {
  contactId: string;
  projectId: string;
  frequency: string;
  startDate: string;
  endDate: string;
  dayOfMonth: number;
  dayOfWeek: number;
  lineItems: LineItem[];
  notes: string;
  terms: string;
  taxRate: number;
  discount: number;
  autoSend: boolean;
  paymentTermsDays: number;
}

const FREQUENCIES: FrequencyOption[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const DAYS_OF_WEEK: DayOfWeekOption[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export default function RecurringForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [loading, setLoading] = useState<boolean>(isEdit);
  const [saving, setSaving] = useState<boolean>(false);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);

  const [form, setForm] = useState<RecurringFormState>({
    contactId: '',
    projectId: '',
    frequency: 'monthly',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    dayOfMonth: 1,
    dayOfWeek: 1,
    lineItems: [{ description: '', quantity: 1, unitPrice: 0 }],
    notes: '',
    terms: '',
    taxRate: 0,
    discount: 0,
    autoSend: false,
    paymentTermsDays: 30,
  });

  useEffect(() => {
    loadContacts();
    if (isEdit) loadRecurring();
  }, [id]);

  const loadContacts = async () => {
    try {
      const [contactsRes, projectsRes] = await Promise.all([
        api.get('/api/contacts?type=client&limit=200'),
        api.get('/api/projects?limit=200'),
      ]);
      setContacts((contactsRes as Record<string, unknown>).data as Record<string, unknown>[] || []);
      setProjects((projectsRes as Record<string, unknown>).data as Record<string, unknown>[] || []);
    } catch (error: unknown) {
      console.error('Failed to load contacts:', error);
    }
  };

  const loadRecurring = async () => {
    try {
      const data = await api.get(`/api/recurring/${id}`) as Record<string, unknown>;
      setForm({
        contactId: (data.contactId as string) || '',
        projectId: (data.projectId as string) || '',
        frequency: data.frequency as string,
        startDate: (data.startDate as string)?.split('T')[0] || '',
        endDate: (data.endDate as string)?.split('T')[0] || '',
        dayOfMonth: (data.dayOfMonth as number) || 1,
        dayOfWeek: (data.dayOfWeek as number) || 1,
        lineItems: (data.lineItems as Record<string, unknown>[])?.length > 0
          ? (data.lineItems as Record<string, unknown>[]).map((i: Record<string, unknown>) => ({ description: i.description as string, quantity: i.quantity as number, unitPrice: i.unitPrice as number }))
          : [{ description: '', quantity: 1, unitPrice: 0 }],
        notes: (data.notes as string) || '',
        terms: (data.terms as string) || '',
        taxRate: (data.taxRate as number) || 0,
        discount: (data.discount as number) || 0,
        autoSend: (data.autoSend as boolean) || false,
        paymentTermsDays: (data.paymentTermsDays as number) || 30,
      });
    } catch (error: unknown) {
      console.error('Failed to load recurring invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string | number | boolean) => {
    setForm({ ...form, [field]: value });
  };

  const handleLineItemChange = (index: number, field: string, value: string | number) => {
    const items = [...form.lineItems];
    items[index] = { ...items[index], [field]: value };
    setForm({ ...form, lineItems: items });
  };

  const addLineItem = () => {
    setForm({
      ...form,
      lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }],
    });
  };

  const removeLineItem = (index: number) => {
    if (form.lineItems.length <= 1) return;
    const items = form.lineItems.filter((_: LineItem, i: number) => i !== index);
    setForm({ ...form, lineItems: items });
  };

  const calculateTotals = (): { subtotal: number; taxAmount: number; total: number } => {
    const subtotal = form.lineItems.reduce((sum: number, item: LineItem) => {
      return sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    }, 0);
    const taxAmount = subtotal * (Number(form.taxRate) || 0) / 100;
    const total = subtotal + taxAmount - (Number(form.discount) || 0);
    return { subtotal, taxAmount, total };
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.contactId) {
      alert('Please select a contact');
      return;
    }
    if (form.lineItems.every((i: LineItem) => !i.description)) {
      alert('Please add at least one line item');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        dayOfMonth: ['monthly', 'quarterly'].includes(form.frequency) ? Number(form.dayOfMonth) : null,
        dayOfWeek: form.frequency === 'weekly' ? Number(form.dayOfWeek) : null,
        taxRate: Number(form.taxRate) || 0,
        discount: Number(form.discount) || 0,
        paymentTermsDays: Number(form.paymentTermsDays) || 30,
        lineItems: form.lineItems
          .filter((i: LineItem) => i.description)
          .map((i: LineItem) => ({
            description: i.description,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0,
          })),
      };

      if (isEdit) {
        await api.put(`/api/recurring/${id}`, payload);
      } else {
        await api.post('/api/recurring', payload);
      }

      navigate('/recurring');
    } catch (error: unknown) {
      alert('Failed to save: ' + ((error as Error).message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const { subtotal, taxAmount, total } = calculateTotals();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/recurring')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Recurring Invoice' : 'New Recurring Invoice'}
          </h1>
          <p className="text-gray-500">Set up automatic billing</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Contact & Project */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Customer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contact <span className="text-red-500">*</span>
              </label>
              <select
                value={form.contactId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('contactId', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                required
              >
                <option value="">Select contact...</option>
                {contacts.map((c: Record<string, unknown>) => (
                  <option key={c.id as string} value={c.id as string}>{c.name as string}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select
                value={form.projectId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('projectId', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                <option value="">No project</option>
                {projects.map((p: Record<string, unknown>) => (
                  <option key={p.id as string} value={p.id as string}>{p.name as string}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Schedule</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('frequency', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              >
                {FREQUENCIES.map((f: FrequencyOption) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {form.frequency === 'weekly' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
                <select
                  value={form.dayOfWeek}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('dayOfWeek', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                >
                  {DAYS_OF_WEEK.map((d: DayOfWeekOption) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            )}

            {['monthly', 'quarterly'].includes(form.frequency) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Day of Month</label>
                <select
                  value={form.dayOfMonth}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('dayOfMonth', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                >
                  {Array.from({ length: 28 }, (_: unknown, i: number) => i + 1).map((d: number) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('startDate', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date (optional)</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('endDate', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label>
              <input
                type="number"
                value={form.paymentTermsDays}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('paymentTermsDays', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                min="0"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.autoSend}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('autoSend', e.target.checked)}
                className="rounded border-gray-300 text-orange-500 focus:ring-orange-500 text-gray-900"
              />
              <span className="text-sm text-gray-700">
                Automatically send invoice when generated
              </span>
            </label>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Line Items</h2>
          <div className="space-y-3">
            {form.lineItems.map((item: LineItem, index: number) => (
              <div key={index} className="flex gap-3 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLineItemChange(index, 'description', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLineItemChange(index, 'quantity', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    min="1"
                  />
                </div>
                <div className="w-32">
                  <input
                    type="number"
                    placeholder="Price"
                    value={item.unitPrice}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLineItemChange(index, 'unitPrice', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div className="w-28 py-2 text-right font-medium">
                  ${((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toLocaleString()}
                </div>
                <button
                  type="button"
                  onClick={() => removeLineItem(index)}
                  className="p-2 text-gray-400 hover:text-red-500"
                  disabled={form.lineItems.length <= 1}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLineItem}
            className="mt-3 flex items-center gap-2 text-sm text-orange-600 hover:text-orange-700"
          >
            <Plus className="w-4 h-4" />
            Add Line Item
          </button>

          {/* Totals */}
          <div className="mt-6 pt-4 border-t">
            <div className="max-w-xs ml-auto space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span>${subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm items-center gap-2">
                <span className="text-gray-600">Tax %</span>
                <input
                  type="number"
                  value={form.taxRate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('taxRate', e.target.value)}
                  className="w-20 px-2 py-1 border rounded text-right"
                  min="0"
                  step="0.1"
                />
                <span className="w-24 text-right">${taxAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm items-center gap-2">
                <span className="text-gray-600">Discount</span>
                <input
                  type="number"
                  value={form.discount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('discount', e.target.value)}
                  className="w-20 px-2 py-1 border rounded text-right"
                  min="0"
                  step="0.01"
                />
                <span className="w-24 text-right">-${Number(form.discount || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>Total</span>
                <span>${total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Notes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (visible to customer)</label>
              <textarea
                value={form.notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange('notes', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terms</label>
              <textarea
                value={form.terms}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange('terms', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/recurring')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Update' : 'Create'} Recurring Invoice
          </button>
        </div>
      </form>
    </div>
  );
}
