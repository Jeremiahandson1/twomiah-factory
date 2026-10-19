// Moved from templates/crm-homecare/frontend/src/components/admin/ExpenseManagement.tsx (/crm/expenses).
// Complete expense tracking: Categories, Filtering, Reports, Receipt Management, Budgets.
//
// Replies read (server/crm/homecare/payroll/expenses.ts — home care's own `expenses` table, care-payroll:update):
//   GET    /api/expenses?startDate=&endDate=&limit=   { data, pagination }: id, userId, category, description, amount,
//                                                     date, receiptUrl, status, notes, userFirstName, userLastName.
//                                                     The template's list was every row of the range (a bare array);
//                                                     the route pages (50 by default), so the screen asks for 1000.
//   POST   /api/expenses                              reads date (or expenseDate), category, description, amount, receiptUrl, notes
//   PUT    /api/expenses/:id                          reads date — the template sent only expenseDate, so an edited date never saved
//   DELETE /api/expenses/:id                          care-payroll:delete
// The vendor, payment method and the tax-deductible and reimbursable flags are stored (migration 0011); the template's
// server dropped them, so they read back empty there.
import { useEffect, useState, type FormEvent } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'
import { money as formatCurrency } from './shared'

interface Expense {
  id: string
  category: string | null
  description: string | null
  amount: string | number | null
  date: string | null
  receiptUrl: string | null
  status: string | null
  notes: string | null
  /** Not stored (see above). */
  vendor?: string | null
  paymentMethod?: string | null
  taxDeductible?: boolean | null
  reimbursable?: boolean | null
  reimbursedTo?: string | null
}

const categories = [
  { id: 'equipment', label: 'Equipment', icon: '🖥️', color: '#3498db' },
  { id: 'supplies', label: 'Supplies', icon: '📦', color: '#9b59b6' },
  { id: 'utilities', label: 'Utilities', icon: '💡', color: '#f39c12' },
  { id: 'maintenance', label: 'Maintenance', icon: '🔧', color: '#95a5a6' },
  { id: 'training', label: 'Training', icon: '📚', color: '#27ae60' },
  { id: 'marketing', label: 'Marketing', icon: '📣', color: '#e74c3c' },
  { id: 'office', label: 'Office', icon: '🏢', color: '#1abc9c' },
  { id: 'travel', label: 'Travel', icon: '✈️', color: '#e67e22' },
  { id: 'insurance', label: 'Insurance', icon: '🛡️', color: '#2c3e50' },
  { id: 'payroll', label: 'Payroll Tax', icon: '💰', color: '#16a085' },
  { id: 'professional', label: 'Professional Services', icon: '👔', color: '#8e44ad' },
  { id: 'other', label: 'Other', icon: '📋', color: '#7f8c8d' },
]

const paymentMethods = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'check', label: '🏦 Check' },
  { id: 'credit_card', label: '💳 Credit Card' },
  { id: 'debit_card', label: '💳 Debit Card' },
  { id: 'bank_transfer', label: '🏦 Bank Transfer' },
  { id: 'paypal', label: '📱 PayPal' },
  { id: 'other', label: '📋 Other' },
]

const blankForm = () => ({
  expenseDate: toLocalYMD(new Date()),
  category: 'supplies',
  vendor: '',
  description: '',
  amount: '',
  paymentMethod: 'credit_card',
  reimbursable: false,
  reimbursedTo: '',
  taxDeductible: true,
  notes: '',
  receiptUrl: '',
})

// The budget bar's fill and the spent figure: an ink per state that reads in both themes.
const BUDGET_INK = { over: 'var(--hc-red-ink)', warning: 'var(--hc-warning-ink)', good: 'var(--hc-green-ink)', none: 'var(--hc-green-ink)' } as const

export default function ExpenseManagement() {
  const toast = useToast()
  const confirm = useConfirm()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [message, setMessage] = useState('')

  // Filters
  const [dateRange, setDateRange] = useState({
    startDate: toLocalYMD(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toLocalYMD(new Date()),
  })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Budget tracking
  const [budgets, setBudgets] = useState<Record<string, number>>({
    equipment: 5000, supplies: 2000, utilities: 1500, maintenance: 1000, training: 3000,
    marketing: 1500, office: 1000, travel: 2000, insurance: 5000, other: 1000,
  })

  const [formData, setFormData] = useState(blankForm)

  useEffect(() => {
    loadExpenses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange])

  const loadExpenses = async () => {
    try {
      setExpenses(rows<Expense>(await api.get('/api/expenses', { startDate: dateRange.startDate, endDate: dateRange.endDate, limit: 1000 })))
    } catch (error) {
      console.error('Failed to load expenses:', error)
      setExpenses([])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const body = { ...formData, date: formData.expenseDate, amount: parseFloat(formData.amount) }
      if (editingExpense) await api.put(`/api/expenses/${editingExpense.id}`, body)
      else await api.post('/api/expenses', body)

      resetForm()
      loadExpenses()
      setMessage(editingExpense ? '✓ Expense updated' : '✓ Expense recorded')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Failed to save expense'))
    }
  }

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense)
    setFormData({
      expenseDate: expense.date?.split('T')[0] || '',
      category: expense.category || 'other',
      vendor: expense.vendor || '',
      description: expense.description || '',
      amount: expense.amount?.toString() || '',
      paymentMethod: expense.paymentMethod || 'credit_card',
      reimbursable: expense.reimbursable || false,
      reimbursedTo: expense.reimbursedTo || '',
      taxDeductible: expense.taxDeductible !== false,
      notes: expense.notes || '',
      receiptUrl: expense.receiptUrl || '',
    })
    setShowForm(true)
  }

  const handleDelete = async (expenseId: string) => {
    if (!(await confirm('Delete this expense?', { danger: true }))) return
    try {
      await api.delete(`/api/expenses/${expenseId}`)
      loadExpenses()
      setMessage('✓ Expense deleted')
      setTimeout(() => setMessage(''), 2000)
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const resetForm = () => {
    setFormData(blankForm())
    setEditingExpense(null)
    setShowForm(false)
  }

  // Filter expenses
  const filteredExpenses = expenses.filter((expense) => {
    const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter
    const q = searchTerm.toLowerCase()
    const matchesSearch = !searchTerm ||
      expense.description?.toLowerCase().includes(q) ||
      expense.vendor?.toLowerCase().includes(q) ||
      expense.notes?.toLowerCase().includes(q)
    return matchesCategory && matchesSearch
  })

  const handleExportCSV = () => {
    const headers = ['Date', 'Category', 'Vendor', 'Description', 'Amount', 'Payment Method', 'Tax Deductible', 'Notes']
    const csvRows = filteredExpenses.map((e) => [
      e.date?.split('T')[0],
      e.category,
      e.vendor || '',
      e.description || '',
      e.amount,
      e.paymentMethod,
      e.taxDeductible ? 'Yes' : 'No',
      e.notes || '',
    ])
    const csv = [headers.join(','), ...csvRows.map((r) => r.map((cell) => `"${cell ?? ''}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-${dateRange.startDate}-to-${dateRange.endDate}.csv`
    a.click()
  }

  // Calculate totals
  const calculateTotals = () => {
    const byCategory: Record<string, number> = {}
    categories.forEach((c) => { byCategory[c.id] = 0 })
    let total = 0
    let taxDeductible = 0
    let reimbursable = 0
    filteredExpenses.forEach((expense) => {
      const amount = parseFloat(String(expense.amount)) || 0
      total += amount
      if (expense.category) byCategory[expense.category] = (byCategory[expense.category] || 0) + amount
      if (expense.taxDeductible) taxDeductible += amount
      if (expense.reimbursable) reimbursable += amount
    })
    return { total, byCategory, taxDeductible, reimbursable }
  }

  const totals = calculateTotals()

  const getCategoryInfo = (categoryId: string | null) =>
    categories.find((c) => c.id === categoryId) || { label: categoryId || '', icon: '📋', color: '#999999' }

  const getPaymentMethodLabel = (methodId: string | null | undefined) => {
    const method = paymentMethods.find((m) => m.id === methodId)
    return method ? method.label : methodId
  }

  const getBudgetStatus = (category: string, spent: number): { percentage: number; status: keyof typeof BUDGET_INK } => {
    const budget = budgets[category] || 0
    if (budget === 0) return { percentage: 0, status: 'none' }
    const percentage = (spent / budget) * 100
    return { percentage, status: percentage >= 100 ? 'over' : percentage >= 80 ? 'warning' : 'good' }
  }

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  return (
    <div>
      <div className="page-header">
        <h2>💰 Expense Management</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="hc-btn hc-btn-primary" onClick={() => { resetForm(); setShowForm(!showForm) }}>
            {showForm ? '✕ Cancel' : '➕ Add Expense'}
          </button>
          <button className="hc-btn hc-btn-secondary" onClick={() => setShowBudgetModal(true)}>📊 Budgets</button>
          <button className="hc-btn hc-btn-secondary" onClick={handleExportCSV}>📥 Export CSV</button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      {/* Summary Cards */}
      <div className="grid">
        <div className="hc-stat-card">
          <h3>Total Expenses</h3>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{formatCurrency(totals.total)}</div>
          <div className="hc-stat-subtext">{filteredExpenses.length} transactions</div>
        </div>
        <div className="hc-stat-card">
          <h3>Tax Deductible</h3>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{formatCurrency(totals.taxDeductible)}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Reimbursable</h3>
          <div className="value" style={{ color: 'var(--hc-info-ink)' }}>{formatCurrency(totals.reimbursable)}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Avg per Transaction</h3>
          <div className="value">{formatCurrency(filteredExpenses.length > 0 ? totals.total / filteredExpenses.length : 0)}</div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="hc-card">
        <h3>Spending by Category</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {categories.filter((c) => totals.byCategory[c.id] > 0).map((category) => {
            const spent = totals.byCategory[category.id]
            const budget = getBudgetStatus(category.id, spent)
            return (
              <div key={category.id} style={{ padding: '1rem', background: 'var(--hc-subtle)', borderRadius: '8px', borderLeft: `4px solid ${category.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{category.icon} {category.label}</span>
                  <strong>{formatCurrency(spent)}</strong>
                </div>
                {budgets[category.id] > 0 && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ height: '6px', background: 'var(--hc-line)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(budget.percentage, 100)}%`, height: '100%', background: BUDGET_INK[budget.status], transition: 'width 0.3s' }} />
                    </div>
                    <small className="text-muted">{budget.percentage.toFixed(0)}% of {formatCurrency(budgets[category.id])} budget</small>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Expense Form */}
      {showForm && (
        <div className="hc-card hc-card-form">
          <h3>{editingExpense ? 'Edit Expense' : 'Record New Expense'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Date *</label>
                <input type="date" value={formData.expenseDate} onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} required>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Amount *</label>
                <input type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" required />
              </div>
              <div className="form-group">
                <label>Payment Method</label>
                <select value={formData.paymentMethod} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}>
                  {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Vendor</label>
                <input type="text" value={formData.vendor} onChange={(e) => setFormData({ ...formData, vendor: e.target.value })} placeholder="e.g., Amazon, Office Depot" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="What was purchased?" />
              </div>
            </div>

            <div className="form-grid-2" style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.taxDeductible} onChange={(e) => setFormData({ ...formData, taxDeductible: e.target.checked })} />
                  Tax Deductible
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={formData.reimbursable} onChange={(e) => setFormData({ ...formData, reimbursable: e.target.checked })} />
                  Reimbursable
                </label>
              </div>
            </div>

            {formData.reimbursable && (
              <div className="form-group">
                <label>Reimburse To</label>
                <input type="text" value={formData.reimbursedTo} onChange={(e) => setFormData({ ...formData, reimbursedTo: e.target.value })} placeholder="Employee name" />
              </div>
            )}

            <div className="form-group">
              <label>Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} placeholder="Additional details..." />
            </div>

            <div className="form-group">
              <label>Receipt URL</label>
              <input type="url" value={formData.receiptUrl} onChange={(e) => setFormData({ ...formData, receiptUrl: e.target.value })} placeholder="https://..." />
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">{editingExpense ? 'Update' : 'Record'} Expense</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="hc-card">
        <div className="filter-controls">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Start Date</label>
            <input type="date" value={dateRange.startDate} onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input type="date" value={dateRange.endDate} onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
            <label>Search</label>
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search description, vendor..." />
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      {filteredExpenses.length === 0 ? (
        <div className="hc-card hc-card-centered">
          <p>No expenses found for the selected filters.</p>
        </div>
      ) : (
        <table className="hc-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Vendor</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Tax Ded.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.map((expense) => {
              const categoryInfo = getCategoryInfo(expense.category)
              return (
                <tr key={expense.id}>
                  <td>{formatDate(expense.date)}</td>
                  <td>
                    {/* A 12% tint of the category colour: the row's ink reads on it over either ground. */}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', background: categoryInfo.color + '20', borderRadius: '4px', fontSize: '0.85rem' }}>
                      {categoryInfo.icon} {categoryInfo.label}
                    </span>
                  </td>
                  <td>{expense.vendor || '-'}</td>
                  <td>{expense.description || '-'}</td>
                  <td><strong style={{ color: 'var(--hc-red-ink)' }}>{formatCurrency(expense.amount)}</strong></td>
                  <td>{getPaymentMethodLabel(expense.paymentMethod)}</td>
                  <td>{expense.taxDeductible ? <span className="hc-badge hc-badge-success">Yes</span> : <span className="hc-badge hc-badge-secondary">No</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => handleEdit(expense)}>Edit</button>
                      <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDelete(expense.id)}>Delete</button>
                      {expense.receiptUrl && (
                        <a href={expense.receiptUrl} target="_blank" rel="noopener noreferrer" className="hc-btn hc-btn-sm hc-btn-primary">📎</a>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--hc-subtle)', fontWeight: 'bold' }}>
              <td colSpan={4} style={{ textAlign: 'right' }}>Total:</td>
              <td style={{ color: 'var(--hc-red-ink)' }}>{formatCurrency(totals.total)}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Budget Modal */}
      {showBudgetModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>📊 Monthly Budgets</h2>
              <button className="close-btn" onClick={() => setShowBudgetModal(false)}>×</button>
            </div>

            <p className="text-muted">Set monthly budget limits for each category to track spending.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              {categories.map((category) => {
                const spent = totals.byCategory[category.id] || 0
                const budget = budgets[category.id] || 0
                const status = getBudgetStatus(category.id, spent)
                return (
                  <div key={category.id} style={{ padding: '1rem', border: '1px solid var(--hc-line)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 'bold' }}>{category.icon} {category.label}</span>
                      <span style={{ color: BUDGET_INK[status.status] }}>{formatCurrency(spent)} spent</span>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.85rem' }}>Monthly Budget</label>
                      <input type="number" step="100" min="0" value={budgets[category.id] || ''}
                        onChange={(e) => setBudgets({ ...budgets, [category.id]: parseFloat(e.target.value) || 0 })} placeholder="0.00" />
                    </div>
                    {budget > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div style={{ height: '8px', background: 'var(--hc-line)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(status.percentage, 100)}%`, height: '100%', background: BUDGET_INK[status.status] }} />
                        </div>
                        <small style={{ color: status.status === 'over' ? 'var(--hc-red-ink)' : 'var(--hc-muted)' }}>
                          {status.percentage.toFixed(0)}% used ({formatCurrency(budget - spent)} remaining)
                        </small>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="modal-actions">
              <button className="hc-btn hc-btn-primary" onClick={() => setShowBudgetModal(false)}>Save Budgets</button>
              <button className="hc-btn hc-btn-secondary" onClick={() => setShowBudgetModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
