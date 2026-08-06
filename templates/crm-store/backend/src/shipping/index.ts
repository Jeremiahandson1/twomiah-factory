// Shipping registry. Same shape as suppliers/index.ts: one connected config,
// credentials decrypted just-in-time, null when nothing is set up (the store
// then behaves exactly as it does today — manual tracking entry).
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { shippingConfig } from '../../db/schema.ts'
import { decryptJSON } from '../lib/crypto.ts'
import type { ShippingCredentials, ShippingProvider, Parcel } from './types.ts'
import { EasyPostProvider } from './easypost.ts'

export const DEFAULT_PARCEL: Parcel = { lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 16 }

export function buildShippingProvider(provider: string, creds: ShippingCredentials): ShippingProvider {
  if (provider === 'easypost') return new EasyPostProvider(creds)
  throw new Error('Unknown shipping provider: ' + provider)
}

export async function getActiveShipping(): Promise<
  { provider: ShippingProvider; parcel: Parcel; fromAddress: any } | null
> {
  const [cfg] = await db.select().from(shippingConfig).where(eq(shippingConfig.connected, true)).limit(1)
  if (!cfg) return null
  const creds = decryptJSON<ShippingCredentials>(cfg.credentialsEnc)
  creds.mode = (cfg.mode as 'test' | 'live') ?? 'test'
  return {
    provider: buildShippingProvider(cfg.provider, creds),
    parcel: (cfg.defaultParcel as Parcel) || DEFAULT_PARCEL,
    fromAddress: cfg.fromAddress,
  }
}
