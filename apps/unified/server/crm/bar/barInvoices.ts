// Invoice scanning for receiving (restaurant-bar parity #7, bar_invoice_scan; BevSpot's and Toast's invoice capture).
//
//   1. A photo or PDF of a supplier invoice is read (barInvoiceReader.ts) into lines: what, size, how many, price of one.
//   2. Each line is matched to a stock item (barInvoiceMatch.ts) — a suggestion only; the person changes any match, any quantity
//      or price, skips a line, or adds one.
//   3. NOTHING changes a count or a cost until a person confirms. Confirming makes one received purchase order (the same thing
//      "It came in" makes), so on hand and each item's price move exactly the way a received order moves them.
//   A scan that is confirmed cannot be confirmed again, and an invoice number already received is refused unless the person says so.
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { barInvoiceScan, barPurchaseOrder, barPurchaseOrderLine, barStockItem, barVendor, company } from '../../db/schema/index.ts'
import { nextPoNumber } from '../../data/bar.ts'
import { aliasKey, lineWarnings, reviewLines, suggestVendor, type ReviewLine, type StockLite } from './barInvoiceMatch.ts'
import { READER_OFF, sniffMediaType, type InvoiceReader } from './barInvoiceReader.ts'
import { StockError } from './barStock.ts'
import type { Actor } from './barManagers.ts'
import type { BarDb } from './db.ts'

/** What the venue's file store does for this (the app's storage service, whose real one is the object store). */
export interface InvoiceStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<{ body: ArrayBuffer | Buffer | Uint8Array; contentType: string } | null>
  deleteFile?(key: string): unknown
  storageConfigured?: () => boolean
}

export const MAX_INVOICE_BYTES = 10 * 1024 * 1024
/** Anthropic reads an image up to 5 MB; a PDF can be bigger. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Reads a company may ask for in a rolling day: each is a paid call. */
export const MAX_READS_PER_DAY = 40
const MAX_ALIASES = 400
const DAY = /^\d{4}-\d{2}-\d{2}$/

const clean = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null }

type ScanRow = typeof barInvoiceScan.$inferSelect

export function createBarInvoices(deps: { db: BarDb; reader: () => InvoiceReader; storage: () => InvoiceStorage; now?: () => Date }) {
  const { db } = deps
  const now = () => (deps.now ? deps.now() : new Date())

  async function stockFor(companyId: string, tx: any = db): Promise<StockLite[]> {
    const rows = await tx.select({ id: barStockItem.id, name: barStockItem.name, packName: barStockItem.packName, packSize: barStockItem.packSize, vendorId: barStockItem.vendorId, packCostCents: barStockItem.packCostCents })
      .from(barStockItem).where(and(eq(barStockItem.companyId, companyId), eq(barStockItem.isActive, true)))
    return rows.map((r: any) => ({ ...r, packSize: Number(r.packSize) }))
  }
  async function aliasesOf(companyId: string, tx: any = db): Promise<Record<string, string>> {
    const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const a = (co?.settings as any)?.invoiceAliases
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {}
  }

  /** A scan as the screen shows it: lines with their stock item, warnings, totals, and a repeat of an invoice already received. */
  async function view(row: ScanRow, withStock = false) {
    const lines = (row.lines as ReviewLine[]) || []
    const stock = await stockFor(row.companyId)
    const all = withStock ? stock : []
    const byId = new Map(stock.map((s) => [s.id, s]))
    const [vendor] = row.vendorId ? await db.select({ name: barVendor.name }).from(barVendor).where(eq(barVendor.id, row.vendorId)).limit(1) : []
    const view = lines.map((l) => {
      const item = l.stockItemId ? byId.get(l.stockItemId) ?? null : null
      return { ...l, stockName: item?.name ?? null, packName: item?.packName ?? null, currentCostCents: item?.packCostCents ?? null, warnings: lineWarnings(l, item) }
    })
    const counted = lines.filter((l) => !l.skip && l.qty !== null && l.packCostCents !== null)
    const linesTotalCents = counted.reduce((n, l) => n + Math.round(l.qty! * l.packCostCents!), 0)
    let duplicateOf: { id: string; number: number | null; at: string | null } | null = null
    if (row.status === 'review' && row.invoiceNumber) {
      const others = await db.select().from(barInvoiceScan).where(and(eq(barInvoiceScan.companyId, row.companyId), eq(barInvoiceScan.status, 'confirmed'), eq(barInvoiceScan.invoiceNumber, row.invoiceNumber)))
      const same = others.find((o) => o.id !== row.id && (o.vendorId ?? '') === (row.vendorId ?? '') && (o.supplierName ?? '').toLowerCase() === (row.supplierName ?? '').toLowerCase())
      if (same) {
        const [po] = same.orderId ? await db.select({ number: barPurchaseOrder.number }).from(barPurchaseOrder).where(eq(barPurchaseOrder.id, same.orderId)).limit(1) : []
        duplicateOf = { id: same.id, number: po?.number ?? null, at: same.confirmedAt ? same.confirmedAt.toISOString() : null }
      }
    }
    return {
      id: row.id, status: row.status, vendorId: row.vendorId, vendorName: vendor?.name ?? null, supplierName: row.supplierName, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate,
      totalCents: row.totalCents, linesTotalCents, differenceCents: row.totalCents !== null ? row.totalCents - linesTotalCents : null, notes: row.notes, reader: row.reader,
      fileName: row.fileName, fileType: row.fileType, hasFile: !!row.fileKey, orderId: row.orderId, createdByName: row.createdByName, confirmedByName: row.confirmedByName,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null, createdAt: row.createdAt.toISOString(),
      needsAttention: view.filter((l) => !l.skip && l.warnings.length > 0).length, duplicateOf, lines: view,
      ...(withStock ? { stock: all.map((s) => ({ id: s.id, name: s.name, packName: s.packName, packCostCents: s.packCostCents })) } : {}),
    }
  }

  async function ownScan(companyId: string, id: string, tx: any = db): Promise<ScanRow> {
    const [row] = await tx.select().from(barInvoiceScan).where(and(eq(barInvoiceScan.id, id), eq(barInvoiceScan.companyId, companyId))).limit(1)
    if (!row) throw new StockError('That invoice is gone.', 404)
    return row
  }

  /**
   * Read a file into a scan for review. Order matters: nothing is stored and no paid call is made until the file is known to be one
   * we can read, the reader is switched on and the day's limit is not used up; a failed reading leaves no row and no file.
   */
  async function scan(actor: Actor, file: { bytes: Buffer; name: string }, vendorIdIn: unknown) {
    const reader = deps.reader(), storage = deps.storage()
    const mediaType = sniffMediaType(file.bytes)
    if (!mediaType) throw new StockError('That file is not a photo or a PDF we can read. Use a JPEG, PNG or WebP photo, or a PDF.', 415)
    if (file.bytes.length > MAX_INVOICE_BYTES) throw new StockError('That file is over 10 MB. Take the photo again at a lower quality, or send the PDF a page at a time.', 413)
    if (mediaType !== 'application/pdf' && file.bytes.length > MAX_IMAGE_BYTES) throw new StockError('That photo is over 5 MB. Take it again at a lower quality, or from further back.', 413)
    if (!reader.configured()) throw new StockError(READER_OFF, 503)
    if (storage.storageConfigured && !storage.storageConfigured()) throw new StockError('Photo storage isn’t set up for this business yet, so an invoice can’t be kept for review. Email support@twomiah.com.', 503)
    const since = new Date(now().getTime() - 24 * 3600_000)
    const recent = await db.select({ id: barInvoiceScan.id }).from(barInvoiceScan).where(and(eq(barInvoiceScan.companyId, actor.companyId), gte(barInvoiceScan.createdAt, since)))
    if (recent.length >= MAX_READS_PER_DAY) throw new StockError(`That is ${MAX_READS_PER_DAY} invoices read in a day, the most we read for one business. Receive the rest by hand, or try again tomorrow.`, 429)
    let vendorId: string | null = null
    if (vendorIdIn) {
      const [v] = await db.select({ id: barVendor.id }).from(barVendor).where(and(eq(barVendor.id, String(vendorIdIn)), eq(barVendor.companyId, actor.companyId))).limit(1)
      if (!v) throw new StockError('That vendor is gone.', 404)
      vendorId = v.id
    }

    const got = await reader.read({ bytes: file.bytes, mediaType, name: file.name })
    if (!got.ok) throw new StockError(got.message, got.status)

    const vendors = await db.select({ id: barVendor.id, name: barVendor.name }).from(barVendor).where(and(eq(barVendor.companyId, actor.companyId), eq(barVendor.isActive, true)))
    vendorId = vendorId ?? suggestVendor(got.read.supplier, vendors)
    const lines = reviewLines(got.read.lines, await stockFor(actor.companyId), await aliasesOf(actor.companyId), vendorId)
    const ext = mediaType === 'application/pdf' ? 'pdf' : mediaType.split('/')[1].replace('jpeg', 'jpg')
    const key = `invoices/${actor.companyId}/${crypto.randomUUID()}.${ext}`
    await storage.put(key, file.bytes, mediaType)
    const [row] = await db.insert(barInvoiceScan).values({
      status: 'review', vendorId, supplierName: got.read.supplier, invoiceNumber: got.read.invoiceNumber, invoiceDate: got.read.invoiceDate, totalCents: got.read.totalCents,
      lines, notes: got.read.notes, fileKey: key, fileType: mediaType, fileName: clean(file.name, 120), reader: got.reader, createdByName: actor.name, companyId: actor.companyId,
    }).returning()
    return view(row, true)
  }

  async function list(companyId: string) {
    const rows = await db.select().from(barInvoiceScan).where(and(eq(barInvoiceScan.companyId, companyId), inArray(barInvoiceScan.status, ['review', 'confirmed']))).orderBy(desc(barInvoiceScan.createdAt)).limit(40)
    return Promise.all(rows.map(async (r) => { const v = await view(r); const { lines: _l, ...rest } = v; return { ...rest, lineCount: v.lines.length } }))
  }
  const get = async (companyId: string, id: string) => view(await ownScan(companyId, id), true)

  async function fileOf(companyId: string, id: string) {
    const row = await ownScan(companyId, id)
    if (!row.fileKey) throw new StockError('That file is gone.', 404)
    const obj = await deps.storage().getObject(row.fileKey)
    if (!obj) throw new StockError('That file is gone.', 404)
    return { body: obj.body, contentType: row.fileType || obj.contentType, name: row.fileName || 'invoice' }
  }

  /** The person's corrections. Only a scan still in review can change; a line is changed by its position, a new line has no `n`. */
  async function update(actor: Actor, id: string, b: { vendorId?: unknown; invoiceNumber?: unknown; invoiceDate?: unknown; lines?: unknown }) {
    const row = await ownScan(actor.companyId, id)
    if (row.status !== 'review') throw new StockError('That invoice is already closed.', 409)
    const set: Partial<typeof barInvoiceScan.$inferInsert> = { updatedAt: now() }
    if (b.vendorId !== undefined) {
      if (b.vendorId === null || b.vendorId === '') set.vendorId = null
      else {
        const [v] = await db.select({ id: barVendor.id }).from(barVendor).where(and(eq(barVendor.id, String(b.vendorId)), eq(barVendor.companyId, actor.companyId))).limit(1)
        if (!v) throw new StockError('That vendor is gone.', 404)
        set.vendorId = v.id
      }
    }
    if (b.invoiceNumber !== undefined) set.invoiceNumber = clean(b.invoiceNumber, 60)
    if (b.invoiceDate !== undefined) {
      const d = clean(b.invoiceDate, 10)
      if (d !== null && (!DAY.test(d) || Number.isNaN(Date.parse(d)))) throw new StockError('The invoice date looks like 2026-10-31.')
      set.invoiceDate = d
    }
    if (b.lines !== undefined) {
      if (!Array.isArray(b.lines) || b.lines.length > 200) throw new StockError('Check the lines.')
      const lines = [...((row.lines as ReviewLine[]) || [])]
      const ids = (b.lines as any[]).map((l) => l?.stockItemId).filter((x) => typeof x === 'string' && x)
      if (ids.length) {
        const own = await db.select({ id: barStockItem.id }).from(barStockItem).where(and(eq(barStockItem.companyId, actor.companyId), inArray(barStockItem.id, [...new Set(ids)] as string[])))
        if (own.length !== new Set(ids).size) throw new StockError('One of those stock items is gone.', 404)
      }
      for (const l of b.lines as any[]) {
        if (!l || typeof l !== 'object') throw new StockError('Check the lines.')
        let target: ReviewLine
        if (l.n === undefined || l.n === null) {
          const text = clean(l.text, 160)
          if (!text) throw new StockError('Say what the new line is.')
          target = { n: lines.length, text, size: clean(l.size, 60), qty: null, packCostCents: null, lineTotalCents: null, stockItemId: null, matchedBy: null, sure: false, skip: false, added: true }
          lines.push(target)
        } else {
          const at = lines.findIndex((x) => x.n === Number(l.n))
          if (at < 0) throw new StockError('One of those lines is gone.', 404)
          target = lines[at]
        }
        if (l.stockItemId !== undefined) {
          const next = l.stockItemId ? String(l.stockItemId) : null
          // Naming the item, even the one already suggested, is the person's check: it is theirs from then on, and remembered.
          target.stockItemId = next; target.matchedBy = next ? 'manual' : null; target.sure = !!next
        }
        if (l.qty !== undefined) {
          if (l.qty === null || l.qty === '') target.qty = null
          else { const n = Number(l.qty); if (!Number.isFinite(n) || n <= 0 || n > 100_000) throw new StockError('Check the quantity.'); target.qty = Math.round(n * 1000) / 1000 }
        }
        if (l.packCostCents !== undefined) {
          if (l.packCostCents === null || l.packCostCents === '') target.packCostCents = null
          else if (typeof l.packCostCents !== 'number' || !Number.isInteger(l.packCostCents) || l.packCostCents < 0 || l.packCostCents > 10_000_000) throw new StockError('The price is a whole number of cents.')
          else target.packCostCents = l.packCostCents
        }
        if (l.skip !== undefined) target.skip = !!l.skip
      }
      set.lines = lines
    }
    await db.update(barInvoiceScan).set(set).where(and(eq(barInvoiceScan.id, id), eq(barInvoiceScan.status, 'review')))
    return get(actor.companyId, id)
  }

  /**
   * Confirm: one received purchase order from the lines a person has checked. All or nothing, and only once. Every line that is not skipped
   * needs a stock item and a quantity; the price, when there is one, becomes the item's price exactly as "It came in" does.
   */
  async function confirm(actor: Actor, id: string, opts: { allowDuplicate?: boolean } = {}) {
    const row = await ownScan(actor.companyId, id)
    if (row.status === 'confirmed') throw new StockError('That invoice was already received.', 409)
    if (row.status !== 'review') throw new StockError('That invoice is closed.', 409)
    const shown = await view(row)
    if (shown.duplicateOf && !opts.allowDuplicate) throw new StockError(`Invoice ${row.invoiceNumber} from ${row.supplierName || 'this supplier'} was already received${shown.duplicateOf.number ? ` as order #${shown.duplicateOf.number}` : ''}. Receive it again only if this is a different delivery.`, 409)
    const lines = ((row.lines as ReviewLine[]) || []).filter((l) => !l.skip)
    if (!lines.length) throw new StockError('Every line is skipped. Nothing to receive.')
    const bad = lines.filter((l) => !l.stockItemId || !(l.qty !== null && l.qty > 0))
    if (bad.length) throw new StockError(`${bad.length} ${bad.length === 1 ? 'line still needs' : 'lines still need'} an item and a quantity (${bad.slice(0, 3).map((l) => `“${l.text}”`).join(', ')}${bad.length > 3 ? ', …' : ''}), or to be skipped.`)
    return db.transaction(async (tx: any) => {
      const [locked] = await tx.select().from(barInvoiceScan).where(and(eq(barInvoiceScan.id, id), eq(barInvoiceScan.companyId, actor.companyId))).limit(1).for('update')
      if (!locked || locked.status !== 'review') throw new StockError('That invoice was already received.', 409)
      const items = await tx.select({ id: barStockItem.id, name: barStockItem.name, packCostCents: barStockItem.packCostCents }).from(barStockItem).where(and(eq(barStockItem.companyId, actor.companyId), inArray(barStockItem.id, [...new Set(lines.map((l) => l.stockItemId!))])))
      if (items.length !== new Set(lines.map((l) => l.stockItemId)).size) throw new StockError('One of those stock items is gone.', 404)
      const byId = new Map<string, { id: string; name: string; packCostCents: number | null }>(items.map((i: any) => [i.id, i]))
      const at = now()
      const [po] = await tx.insert(barPurchaseOrder).values({
        number: await nextPoNumber(tx, actor.companyId), vendorId: locked.vendorId, status: 'received', note: clean(`Invoice ${locked.invoiceNumber || '(no number)'}, read from a photo`, 300),
        createdByName: actor.name, receivedAt: at, receivedByName: actor.name, companyId: actor.companyId,
      }).returning()
      await tx.insert(barPurchaseOrderLine).values(lines.map((l) => ({
        orderId: po.id, stockItemId: l.stockItemId!, packs: String(l.qty), packCostCents: l.packCostCents, receivedPacks: String(l.qty), receivedCostCents: l.packCostCents, companyId: actor.companyId,
      })))
      const costChanges: Array<{ stockItemId: string; name: string; fromCents: number | null; toCents: number }> = []
      for (const l of lines) {
        if (l.packCostCents === null) continue
        const item = byId.get(l.stockItemId!)!
        if (item.packCostCents !== l.packCostCents) costChanges.push({ stockItemId: item.id, name: item.name, fromCents: item.packCostCents, toCents: l.packCostCents })
        item.packCostCents = l.packCostCents
        await tx.update(barStockItem).set({ packCostCents: l.packCostCents, updatedAt: at }).where(and(eq(barStockItem.id, item.id), eq(barStockItem.companyId, actor.companyId)))
      }
      await tx.update(barInvoiceScan).set({ status: 'confirmed', orderId: po.id, confirmedByName: actor.name, confirmedAt: at, updatedAt: at }).where(eq(barInvoiceScan.id, id))
      // What was matched by hand is remembered, so the same words match the same item next time.
      const aliases = await aliasesOf(actor.companyId, tx)
      for (const l of lines) if (l.matchedBy === 'manual') { const k = aliasKey(l.text); if (k) { delete aliases[k]; aliases[k] = l.stockItemId! } }
      const keys = Object.keys(aliases); for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ALIASES))) delete aliases[k]
      const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, actor.companyId)).limit(1)
      await tx.update(company).set({ settings: { ...((co?.settings as any) || {}), invoiceAliases: aliases } }).where(eq(company.id, actor.companyId))
      return {
        scanId: id, orderId: po.id as string, orderNumber: po.number as number, lines: lines.length, costChanges,
        totalCents: lines.reduce((n, l) => n + (l.packCostCents === null ? 0 : Math.round(l.qty! * l.packCostCents)), 0),
      }
    })
  }

  async function discard(actor: Actor, id: string) {
    const row = await ownScan(actor.companyId, id)
    if (row.status !== 'review') throw new StockError('That invoice is already closed.', 409)
    const [done] = await db.update(barInvoiceScan).set({ status: 'discarded', updatedAt: now() }).where(and(eq(barInvoiceScan.id, id), eq(barInvoiceScan.status, 'review'))).returning({ id: barInvoiceScan.id })
    if (!done) throw new StockError('That invoice is already closed.', 409)
    if (row.fileKey) { try { await deps.storage().deleteFile?.(row.fileKey) } catch { /* the row is closed either way */ } }
    return { ok: true }
  }

  return { scan, list, get, fileOf, update, confirm, discard }
}
export type BarInvoices = ReturnType<typeof createBarInvoices>
