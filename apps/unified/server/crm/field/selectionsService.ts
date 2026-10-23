// Selections: clients choose finishes, fixtures, colours and options against an allowance. Moved from the CRM
// template's services/selections.ts (templates/crm/backend/src/services); its raw SQL is in server/data/selections.ts,
// which answers camelCase, so the logic below reads camelCase names where the template read raw column names
// (selection.price_difference → selection.priceDifference). The numbers and the change orders are the template's.
//
// The customer portal (packages/tenant-backend portal.ts) takes this object as its `selections` and calls
// getClientSelections and clientMakeSelection.
import { and, eq } from 'drizzle-orm'
import { nextNumber, businessToday, companyTimeZone } from '@twomiah/tenant-backend'
import { project, changeOrder } from '../../db/schema/index.ts'
import { notFound } from '../../http/errors.ts'
import * as q from '../../data/selections.ts'
import type { CrmDeps } from '../deps.ts'

export function createSelectionsService(d: CrmDeps) {
  const { db } = d

  // ── categories ─────────────────────────────────────────────────────────────────────────────────

  const createCategory = (companyId: string, data: any) => q.insertCategory(db, companyId, data)
  const getCategories = (companyId: string) => q.listActiveCategories(db, companyId)

  async function seedDefaultCategories(companyId: string) {
    const defaults = [
      { name: 'Flooring', icon: 'grid', sortOrder: 1 },
      { name: 'Cabinets', icon: 'cabinet', sortOrder: 2 },
      { name: 'Countertops', icon: 'layers', sortOrder: 3 },
      { name: 'Appliances', icon: 'refrigerator', sortOrder: 4 },
      { name: 'Plumbing Fixtures', icon: 'droplet', sortOrder: 5 },
      { name: 'Lighting', icon: 'lightbulb', sortOrder: 6 },
      { name: 'Hardware', icon: 'door', sortOrder: 7 },
      { name: 'Paint Colors', icon: 'palette', sortOrder: 8 },
      { name: 'Tile', icon: 'square', sortOrder: 9 },
      { name: 'Windows & Doors', icon: 'window', sortOrder: 10 },
    ]
    for (const cat of defaults) {
      try {
        // No unique constraint, so checked by hand.
        if (!(await q.findCategoryIdByName(db, companyId, cat.name))) await q.insertSeedCategory(db, companyId, cat)
      } catch {
        // Skip duplicates silently, as the template did.
      }
    }
  }

  // ── options ────────────────────────────────────────────────────────────────────────────────────

  /** An option is filed under one of the company's categories; null when the category is not the company's. */
  async function createOption(companyId: string, data: any) {
    if (!(await q.categoryIsCompanys(db, companyId, data.categoryId))) return null
    return q.insertOption(db, companyId, data)
  }
  const getOptions = (companyId: string, { categoryId, search, active = true }: { categoryId?: string; search?: string; active?: boolean | null } = {}) =>
    q.listOptions(db, companyId, { categoryId, search, active })

  // ── project selections ─────────────────────────────────────────────────────────────────────────

  /** due_date, quantity and unit are written (the template's T32 L6). */
  const createProjectSelection = (companyId: string, data: any) => q.insertProjectSelection(db, companyId, data)

  async function getProjectSelections(projectId: string, companyId: string) {
    const selections = await q.listProjectSelections(db, projectId, companyId)
    return selections.map((sel: any) => {
      let priceDiff = 0
      if (sel.selectedOption) {
        const totalPrice = Number(sel.selectedOption.price) * Number(sel.quantity)
        priceDiff = totalPrice - (Number(sel.allowance) || 0)
      }
      return { ...sel, priceDifference: priceDiff, isUpgrade: priceDiff > 0, isCredit: priceDiff < 0 }
    })
  }

  async function getSelectionsSummary(projectId: string, companyId: string) {
    const selections = await getProjectSelections(projectId, companyId)
    const summary = {
      total: selections.length,
      pending: 0,
      selected: 0,
      approved: 0,
      ordered: 0,
      received: 0,
      totalAllowance: 0,
      totalSelected: 0,
      netDifference: 0,
      overdue: 0,
    } as any
    // Overdue once the due DAY is over on the company's clock — the invoices' rule (money.ts overdueCutoff). Comparing the
    // due day's midnight-UTC marker with this instant made a selection overdue all of its own due day. (2026-10-22)
    const today = businessToday(await companyTimeZone(db, companyId))
    for (const sel of selections) {
      summary[sel.status]++
      // decimal columns come back as strings; Number() prevents "0" + "450.00" = "0450.00"
      summary.totalAllowance += Number(sel.allowance) || 0
      if (sel.selectedOption) summary.totalSelected += Number(sel.selectedOption.price) * Number(sel.quantity)
      summary.netDifference += Number(sel.priceDifference) || 0
      if (sel.dueDate && new Date(sel.dueDate) < today && sel.status === 'pending') summary.overdue++
    }
    return summary
  }

  async function makeSelection(
    selectionId: string,
    companyId: string,
    { optionId, notes, selectedBy }: { optionId: string; notes?: string; selectedBy?: string },
  ) {
    const selection = await q.findProjectSelection(db, selectionId, companyId)
    if (!selection) throw notFound('Selection not found')
    const option = await q.findOption(db, optionId, companyId)
    if (!option) throw notFound('Option not found')

    const totalPrice = option.price * selection.quantity
    const priceDiff = totalPrice - (selection.allowance || 0)
    return q.recordSelectionChoice(db, selectionId, { optionId, selectedBy: selectedBy || null, notes: notes || null, priceDifference: priceDiff })
  }

  /**
   * Approve a selection, raising a change order for the difference when it moves money. Only a selection awaiting
   * approval can be approved (T32 H3); "0.00" is compared as a number (no $0.00 change order); the change order is
   * numbered in the project's CO sequence, as submitted (T32 L12, T58k).
   */
  async function approveSelection(
    selectionId: string,
    companyId: string,
    { approvedBy, createChangeOrder: shouldCreate = true }: { approvedBy: string; createChangeOrder?: boolean },
  ) {
    const selection = await q.findSelectionForApproval(db, selectionId, companyId)
    if (!selection) throw notFound('Selection not found')
    // The template threw a plain Error here, which answered 500; nothing chosen yet is the person's 400.
    if (!selection.selectedOptionId) throw Object.assign(new Error('No option selected'), { status: 400 })

    const APPROVABLE_FROM = ['pending', 'selected']
    if (!APPROVABLE_FROM.includes(String(selection.status))) {
      throw Object.assign(new Error(
        String(selection.status) === 'approved'
          ? `"${selection.name}" has already been approved${Math.abs(Number(selection.priceDifference ?? 0)) >= 0.005 ? ' and its change order raised' : ''}. To change it, pick an option again first.`
          : `"${selection.name}" is ${selection.status}, and only a selection that is awaiting approval can be approved.`,
      ), { status: 400, code: 'selection_wrong_status' })
    }

    await q.markSelectionApproved(db, selectionId, approvedBy)

    const diff = Number(selection.priceDifference ?? 0)
    const movesMoney = Number.isFinite(diff) && Math.abs(diff) >= 0.005

    let co = null
    if (shouldCreate && movesMoney) {
      const title = diff > 0 ? `Selection Upgrade: ${selection.name}` : `Selection Credit: ${selection.name}`
      const description = diff > 0
        ? `Upgrade from allowance to ${selection.selectedOption?.name}\n\nLocation: ${selection.location || 'N/A'}\nQuantity: ${selection.quantity} ${selection.unit}`
        : `Credit for selecting ${selection.selectedOption?.name} under allowance`
      co = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, changeOrder, changeOrder.number, changeOrder.companyId, companyId, {
          prefix: 'CO', pad: 3,
          scope: eq(changeOrder.projectId, selection.projectId),
          markKey: `CO:${selection.projectId}`,
        })
        const [row] = await tx.insert(changeOrder).values({
          companyId,
          projectId: selection.projectId,
          number,
          title,
          description,
          amount: diff.toFixed(2),
          status: 'submitted',
        }).returning()
        return row
      })
    }

    // The row was read before the update: hand back what the record now is.
    return { selection: { ...selection, status: 'approved' }, changeOrder: co }
  }

  async function markOrdered(
    selectionId: string,
    companyId: string,
    { orderNumber, expectedDate }: { orderedBy?: string; orderNumber?: string; expectedDate?: string },
  ) {
    return q.markSelectionOrdered(db, selectionId, companyId, {
      orderNumber: orderNumber || null,
      expectedDelivery: expectedDate ? new Date(expectedDate) : null,
    })
  }

  async function markReceived(selectionId: string, companyId: string, { notes }: { receivedBy?: string; notes?: string }) {
    return q.markSelectionReceived(db, selectionId, companyId, notes || null)
  }

  // ── client portal ──────────────────────────────────────────────────────────────────────────────

  async function getClientSelections(projectId: string, contactId: string) {
    const [proj] = await db.select().from(project).where(and(eq(project.id, projectId), eq(project.contactId, contactId)))
    if (!proj) throw new Error('Access denied')

    const selections = await q.listProjectSelectionsByDueDate(db, projectId)
    return Promise.all(selections.map(async (sel: any) => {
      let options: any[] = []
      if (sel.status === 'pending' || sel.status === 'selected') {
        // A json column of option ids the owner chose to offer; its contents are not renamed.
        const availableOptions = sel.availableOptions || []
        options = availableOptions.length > 0
          ? await q.optionsByIds(db, availableOptions)
          : await q.activeOptionsInCategory(db, sel.categoryId)
      }
      return {
        ...sel,
        availableOptionsList: options.map((opt: any) => ({
          ...opt,
          totalPrice: Number(opt.price) * Number(sel.quantity),
          priceDiff: Number(opt.price) * Number(sel.quantity) - (Number(sel.allowance) || 0),
        })),
      }
    }))
  }

  async function clientMakeSelection(
    projectId: string,
    selectionId: string,
    contactId: string,
    { optionId, notes }: { optionId: string; notes?: string },
  ) {
    const [proj] = await db.select().from(project).where(and(eq(project.id, projectId), eq(project.contactId, contactId)))
    if (!proj) throw new Error('Access denied')
    const selection = await q.findProjectSelectionInProject(db, selectionId, projectId)
    if (!selection) throw notFound('Selection not found')
    if (selection.status !== 'pending' && selection.status !== 'selected') throw new Error('Selection cannot be changed')
    return makeSelection(selectionId, proj.companyId, { optionId, notes, selectedBy: contactId })
  }

  // ── reports ────────────────────────────────────────────────────────────────────────────────────

  async function getSelectionsDueSoon(companyId: string, { days = 7 }: { days?: number } = {}) {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + days)
    return q.pendingSelectionsDueBy(db, companyId, dueDate)
  }

  const getOverdueSelections = async (companyId: string) => q.pendingSelectionsDueBefore(db, companyId, businessToday(await companyTimeZone(db, companyId)))

  return {
    createCategory,
    getCategories,
    seedDefaultCategories,
    createOption,
    getOptions,
    createProjectSelection,
    getProjectSelections,
    getSelectionsSummary,
    makeSelection,
    approveSelection,
    markOrdered,
    markReceived,
    getClientSelections,
    clientMakeSelection,
    getSelectionsDueSoon,
    getOverdueSelections,
  }
}

export type SelectionsService = ReturnType<typeof createSelectionsService>
