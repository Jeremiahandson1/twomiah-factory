/**
 * Metrc API Client Service
 *
 * Handles cannabis seed-to-sale compliance tracking via the Metrc API.
 * Supports: packages, sales receipts, transfers, plants, waste reporting.
 *
 * Auth: HTTP Basic (base64 of apiKey:userKey)
 * Rate limit: 50 req/sec per Metrc docs
 * Base URL varies by state: https://api-{state}.metrc.com/
 */

import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'

// ============================================
// TYPES
// ============================================

interface MetrcConfig {
  id: number
  companyId: number
  apiKey: string
  userKey: string
  licenseNumber: string
  state: string
  lastSyncAt: string | null
  enabled: boolean
}

interface MetrcPackage {
  Id: number
  Label: string
  PackageType: string
  SourceHarvestNames: string | null
  Quantity: number
  UnitOfMeasureName: string
  ProductName: string
  ProductCategoryName: string
  ItemName: string
  LabTestingState: string
  IsProcessing: boolean
  IsOnHold: boolean
  IsFinished: boolean
  LastModifiedDateTime: string
}

interface MetrcSaleReceipt {
  Id: number
  ReceiptNumber: string
  SalesDateTime: string
  SalesCustomerType: string
  TotalPackages: number
  TotalPrice: number
  Transactions: MetrcSaleTransaction[]
  LastModifiedDateTime: string
}

interface MetrcSaleTransaction {
  PackageId: number
  PackageLabel: string
  Quantity: number
  UnitOfMeasureName: string
  TotalAmount: number
}

interface MetrcTransfer {
  Id: number
  ManifestNumber: string
  ShipperFacilityLicenseNumber: string
  ShipperFacilityName: string
  CreatedDateTime: string
  LastModifiedDateTime: string
  DeliveryCount: number
}

interface MetrcTransferDeliveryPackage {
  PackageId: number
  PackageLabel: string
  ProductName: string
  ItemName: string
  Quantity: number
  UnitOfMeasureName: string
  ShipmentPackageState: string
}

interface MetrcPlant {
  Id: number
  Label: string
  State: string
  GrowthPhase: string
  PlantBatchName: string
  StrainName: string
  LocationName: string
  PlantedDate: string
  LastModifiedDateTime: string
}

interface CreatePackagePayload {
  Tag: string
  Item: string
  Quantity: number
  UnitOfMeasure: string
  PatientLicenseNumber?: string
  Note?: string
  IsProductionBatch: boolean
  ProductionBatchNumber?: string
  IsDonation: boolean
  ProductRequiresRemediation: boolean
  ActualDate: string
  Ingredients: Array<{
    Package: string
    Quantity: number
    UnitOfMeasure: string
  }>
}

interface CreateSaleReceiptPayload {
  SalesDateTime: string
  SalesCustomerType: string
  PatientLicenseNumber?: string
  Transactions: Array<{
    PackageLabel: string
    Quantity: number
    UnitOfMeasure: string
    TotalAmount: number
  }>
}

interface WastePayload {
  Id: number
  WasteMethodName: string
  MixedMaterial: string
  WasteWeight: number
  UnitOfMeasureName: string
  ReasonName: string
  ActualDate: string
}

interface AdjustPackagePayload {
  Label: string
  Quantity: number
  UnitOfMeasure: string
  AdjustmentReason: string
  AdjustmentDate: string
  ReasonNote?: string
}

// ============================================
// RATE LIMITER
// ============================================

class RateLimiter {
  private timestamps: number[] = []
  private readonly maxRequests = 50
  private readonly windowMs = 1000

  async throttle(): Promise<void> {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0]
      const waitMs = this.windowMs - (now - oldestInWindow) + 10
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }

    this.timestamps.push(Date.now())
  }
}

const rateLimiter = new RateLimiter()

// ============================================
// METRC CLIENT
// ============================================

class MetrcClient {
  private baseUrl: string
  private authHeader: string
  private licenseNumber: string

  constructor(apiKey: string, userKey: string, licenseNumber: string, state: string) {
    this.baseUrl = `https://api-${state.toLowerCase()}.metrc.com`
    this.authHeader = `Basic ${btoa(`${apiKey}:${userKey}`)}`
    this.licenseNumber = licenseNumber
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    await rateLimiter.throttle()

    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value)
        }
      }
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        })

        if (response.status === 429) {
          // Rate limited — back off and retry
          const backoffMs = Math.pow(2, attempt) * 1000
          await new Promise(resolve => setTimeout(resolve, backoffMs))
          continue
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unknown error')
          throw new Error(`Metrc API ${method} ${path} failed (${response.status}): ${errorBody}`)
        }

        // Some POST endpoints return empty body on success
        const text = await response.text()
        if (!text) return undefined as T

        return JSON.parse(text) as T
      } catch (err: any) {
        lastError = err
        if (attempt < 2 && (err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET'))) {
          const backoffMs = Math.pow(2, attempt) * 1000
          await new Promise(resolve => setTimeout(resolve, backoffMs))
          continue
        }
        throw err
      }
    }

    throw lastError || new Error('Metrc API request failed after 3 retries')
  }

  // --- Packages ---

  async getPackages(licenseNumber: string, lastModifiedStart?: string, lastModifiedEnd?: string): Promise<MetrcPackage[]> {
    const params: Record<string, string> = { licenseNumber }
    if (lastModifiedStart) params.lastModifiedStart = lastModifiedStart
    if (lastModifiedEnd) params.lastModifiedEnd = lastModifiedEnd
    return this.request<MetrcPackage[]>('GET', '/packages/v2/active', undefined, params)
  }

  async getPackageById(id: number): Promise<MetrcPackage> {
    return this.request<MetrcPackage>('GET', `/packages/v2/${id}`)
  }

  async createPackages(licenseNumber: string, packages: CreatePackagePayload[]): Promise<void> {
    await this.request<void>('POST', '/packages/v2/create', packages, { licenseNumber })
  }

  async adjustPackages(licenseNumber: string, adjustments: AdjustPackagePayload[]): Promise<void> {
    await this.request<void>('POST', '/packages/v2/adjust', adjustments, { licenseNumber })
  }

  // --- Sales ---

  async getSalesReceipts(licenseNumber: string, salesDateStart: string, salesDateEnd: string): Promise<MetrcSaleReceipt[]> {
    return this.request<MetrcSaleReceipt[]>('GET', '/sales/v2/receipts', undefined, {
      licenseNumber,
      salesDateStart,
      salesDateEnd,
    })
  }

  async createSalesReceipts(licenseNumber: string, receipts: CreateSaleReceiptPayload[]): Promise<void> {
    await this.request<void>('POST', '/sales/v2/receipts', receipts, { licenseNumber })
  }

  // --- Transfers ---

  async getTransfers(licenseNumber: string): Promise<MetrcTransfer[]> {
    return this.request<MetrcTransfer[]>('GET', '/transfers/v2/incoming', undefined, { licenseNumber })
  }

  async getTransferDeliveries(transferId: number): Promise<MetrcTransferDeliveryPackage[]> {
    return this.request<MetrcTransferDeliveryPackage[]>('GET', `/transfers/v2/delivery/${transferId}/packages`)
  }

  // --- Plants ---

  async getPlants(licenseNumber: string): Promise<MetrcPlant[]> {
    const [vegetative, flowering] = await Promise.all([
      this.request<MetrcPlant[]>('GET', '/plants/v2/vegetative', undefined, { licenseNumber }),
      this.request<MetrcPlant[]>('GET', '/plants/v2/flowering', undefined, { licenseNumber }),
    ])
    return [...vegetative, ...flowering]
  }

  async reportWaste(licenseNumber: string, wasteItems: WastePayload[]): Promise<void> {
    await this.request<void>('POST', '/plants/v2/waste', wasteItems, { licenseNumber })
  }
}

// ============================================
// HELPERS
// ============================================

function buildClient(config: MetrcConfig): MetrcClient {
  return new MetrcClient(config.apiKey, config.userKey, config.licenseNumber, config.state)
}

async function getMetrcConfig(companyId: number): Promise<MetrcConfig> {
  const rows = await db.execute(
    sql`SELECT id, company_id as "companyId", api_key as "apiKey", user_key as "userKey",
               license_number as "licenseNumber", state, last_sync_at as "lastSyncAt", enabled
        FROM metrc_config WHERE company_id = ${companyId} AND enabled = true LIMIT 1`
  )
  const config = (rows as any).rows?.[0] || (rows as any)[0]
  if (!config) throw new Error(`No Metrc config found for company ${companyId}`)
  return config as MetrcConfig
}

async function logSync(companyId: number, syncType: string, status: string, recordCount: number, error?: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO metrc_sync_log (company_id, sync_type, status, record_count, error, created_at)
        VALUES (${companyId}, ${syncType}, ${status}, ${recordCount}, ${error || null}, NOW())`
  )
}

// ============================================
// SYNC ALL
// ============================================

async function syncAll(companyId: number): Promise<{ packages: number; sales: number; transfers: number }> {
  const config = await getMetrcConfig(companyId)
  const client = buildClient(config)
  const license = config.licenseNumber

  // Determine sync window — from last sync or past 24 hours
  const since = config.lastSyncAt
    ? new Date(config.lastSyncAt).toISOString()
    : new Date(Date.now() - 86_400_000).toISOString()
  const now = new Date().toISOString()

  let packageCount = 0
  let salesCount = 0
  let transferCount = 0

  // --- Sync Packages ---
  try {
    const packages = await client.getPackages(license, since, now)
    packageCount = packages.length

    for (const pkg of packages) {
      await db.execute(
        sql`INSERT INTO metrc_packages (
              company_id, metrc_id, label, package_type, product_name, product_category,
              item_name, quantity, unit_of_measure, lab_testing_state,
              is_on_hold, is_finished, last_modified, raw_json, updated_at
            ) VALUES (
              ${companyId}, ${pkg.Id}, ${pkg.Label}, ${pkg.PackageType},
              ${pkg.ProductName}, ${pkg.ProductCategoryName}, ${pkg.ItemName},
              ${pkg.Quantity}, ${pkg.UnitOfMeasureName}, ${pkg.LabTestingState},
              ${pkg.IsOnHold}, ${pkg.IsFinished}, ${pkg.LastModifiedDateTime},
              ${JSON.stringify(pkg)}, NOW()
            )
            ON CONFLICT (company_id, metrc_id) DO UPDATE SET
              label = EXCLUDED.label,
              quantity = EXCLUDED.quantity,
              lab_testing_state = EXCLUDED.lab_testing_state,
              is_on_hold = EXCLUDED.is_on_hold,
              is_finished = EXCLUDED.is_finished,
              last_modified = EXCLUDED.last_modified,
              raw_json = EXCLUDED.raw_json,
              updated_at = NOW()`
      )

      // Link to local product by metrc_tag if present
      if (pkg.Label) {
        await db.execute(
          sql`UPDATE product SET metrc_package_id = ${pkg.Id}
              WHERE company_id = ${companyId} AND metrc_tag = ${pkg.Label}
              AND metrc_package_id IS DISTINCT FROM ${pkg.Id}`
        )
      }
    }

    await logSync(companyId, 'packages', 'success', packageCount)
  } catch (err: any) {
    await logSync(companyId, 'packages', 'error', 0, err.message)
    console.error(`[metrc] Package sync failed for company ${companyId}:`, err.message)
  }

  // --- Sync Sales ---
  try {
    const sinceDate = since.split('T')[0]
    const nowDate = now.split('T')[0]
    const receipts = await client.getSalesReceipts(license, sinceDate, nowDate)
    salesCount = receipts.length

    for (const receipt of receipts) {
      await db.execute(
        sql`INSERT INTO metrc_sale_receipts (
              company_id, metrc_id, receipt_number, sales_date_time, customer_type,
              total_packages, total_price, transactions_json, last_modified, raw_json, updated_at
            ) VALUES (
              ${companyId}, ${receipt.Id}, ${receipt.ReceiptNumber}, ${receipt.SalesDateTime},
              ${receipt.SalesCustomerType}, ${receipt.TotalPackages}, ${receipt.TotalPrice},
              ${JSON.stringify(receipt.Transactions)}, ${receipt.LastModifiedDateTime},
              ${JSON.stringify(receipt)}, NOW()
            )
            ON CONFLICT (company_id, metrc_id) DO UPDATE SET
              total_packages = EXCLUDED.total_packages,
              total_price = EXCLUDED.total_price,
              transactions_json = EXCLUDED.transactions_json,
              last_modified = EXCLUDED.last_modified,
              raw_json = EXCLUDED.raw_json,
              updated_at = NOW()`
      )

      // Link to local orders by matching receipt number
      if (receipt.ReceiptNumber) {
        await db.execute(
          sql`UPDATE "order" SET metrc_receipt_id = ${receipt.Id}
              WHERE company_id = ${companyId}
                AND metrc_receipt_number = ${receipt.ReceiptNumber}
                AND metrc_receipt_id IS DISTINCT FROM ${receipt.Id}`
        )
      }
    }

    await logSync(companyId, 'sales', 'success', salesCount)
  } catch (err: any) {
    await logSync(companyId, 'sales', 'error', 0, err.message)
    console.error(`[metrc] Sales sync failed for company ${companyId}:`, err.message)
  }

  // --- Sync Transfers ---
  try {
    const transfers = await client.getTransfers(license)
    transferCount = transfers.length

    for (const transfer of transfers) {
      await db.execute(
        sql`INSERT INTO metrc_transfers (
              company_id, metrc_id, manifest_number, shipper_license, shipper_name,
              delivery_count, created_date_time, last_modified, raw_json, updated_at
            ) VALUES (
              ${companyId}, ${transfer.Id}, ${transfer.ManifestNumber},
              ${transfer.ShipperFacilityLicenseNumber}, ${transfer.ShipperFacilityName},
              ${transfer.DeliveryCount}, ${transfer.CreatedDateTime},
              ${transfer.LastModifiedDateTime}, ${JSON.stringify(transfer)}, NOW()
            )
            ON CONFLICT (company_id, metrc_id) DO UPDATE SET
              delivery_count = EXCLUDED.delivery_count,
              last_modified = EXCLUDED.last_modified,
              raw_json = EXCLUDED.raw_json,
              updated_at = NOW()`
      )

      // Fetch and store delivery packages
      try {
        const deliveryPkgs = await client.getTransferDeliveries(transfer.Id)
        for (const dpkg of deliveryPkgs) {
          await db.execute(
            sql`INSERT INTO metrc_packages (
                  company_id, metrc_id, label, package_type, product_name, product_category,
                  item_name, quantity, unit_of_measure, lab_testing_state,
                  is_on_hold, is_finished, last_modified, raw_json, updated_at
                ) VALUES (
                  ${companyId}, ${dpkg.PackageId}, ${dpkg.PackageLabel}, 'transfer',
                  ${dpkg.ProductName}, NULL, ${dpkg.ItemName},
                  ${dpkg.Quantity}, ${dpkg.UnitOfMeasureName}, ${dpkg.ShipmentPackageState},
                  false, false, NOW(), ${JSON.stringify(dpkg)}, NOW()
                )
                ON CONFLICT (company_id, metrc_id) DO UPDATE SET
                  quantity = EXCLUDED.quantity,
                  raw_json = EXCLUDED.raw_json,
                  updated_at = NOW()`
          )
        }
      } catch (err: any) {
        console.error(`[metrc] Transfer delivery fetch failed for transfer ${transfer.Id}:`, err.message)
      }
    }

    await logSync(companyId, 'transfers', 'success', transferCount)
  } catch (err: any) {
    await logSync(companyId, 'transfers', 'error', 0, err.message)
    console.error(`[metrc] Transfer sync failed for company ${companyId}:`, err.message)
  }

  // Update last sync timestamp
  await db.execute(
    sql`UPDATE metrc_config SET last_sync_at = NOW() WHERE company_id = ${companyId}`
  )

  return { packages: packageCount, sales: salesCount, transfers: transferCount }
}

// ============================================
// REPORT SALE
// ============================================

async function reportSale(companyId: number, orderId: number): Promise<{ receiptNumber?: string }> {
  const config = await getMetrcConfig(companyId)
  const client = buildClient(config)

  // Fetch order with line items
  const orderRows = await db.execute(
    sql`SELECT o.id, o.order_number, o.created_at, o.customer_type,
               o.total, o.contact_id
        FROM "order" o WHERE o.id = ${orderId} AND o.company_id = ${companyId} LIMIT 1`
  )
  const orderRow = (orderRows as any).rows?.[0] || (orderRows as any)[0]
  if (!orderRow) throw new Error(`Order ${orderId} not found for company ${companyId}`)

  // Fetch order items with their linked metrc package labels
  const itemRows = await db.execute(
    sql`SELECT oi.quantity, oi.unit_price, oi.total,
               p.metrc_tag, p.unit_of_measure
        FROM order_item oi
        JOIN product p ON p.id = oi.product_id
        WHERE oi.order_id = ${orderId}
          AND p.metrc_tag IS NOT NULL`
  )
  const items = (itemRows as any).rows || itemRows as any[]

  if (!items.length) {
    throw new Error(`Order ${orderId} has no items with Metrc package tags`)
  }

  const transactions = items.map((item: any) => ({
    PackageLabel: item.metrc_tag,
    Quantity: parseFloat(item.quantity),
    UnitOfMeasure: item.unit_of_measure || 'Each',
    TotalAmount: parseFloat(item.total),
  }))

  const salesDateTime = new Date(orderRow.created_at).toISOString()
  const customerType = orderRow.customer_type === 'medical' ? 'Patient' : 'Consumer'

  const receipt: CreateSaleReceiptPayload = {
    SalesDateTime: salesDateTime,
    SalesCustomerType: customerType,
    Transactions: transactions,
  }

  await client.createSalesReceipts(config.licenseNumber, [receipt])

  // Mark order as reported
  await db.execute(
    sql`UPDATE "order" SET metrc_reported = true, metrc_reported_at = NOW()
        WHERE id = ${orderId}`
  )

  await logSync(companyId, 'sale_report', 'success', 1)

  return { receiptNumber: orderRow.order_number }
}

// ============================================
// EXPORTS
// ============================================

export { MetrcClient }

export default {
  syncAll,
  reportSale,
  MetrcClient,
  buildClient,
  getMetrcConfig,
}
