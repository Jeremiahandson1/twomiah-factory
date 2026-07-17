import { db } from '../../db/index.ts'
import { paymentConfig } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { decrypt as decryptString, decryptJSON } from '../lib/crypto.ts'
import type { PaymentProvider, ProviderCredentials } from './types.ts'
import { StripeProvider } from './stripe.ts'
import { SquareProvider } from './square.ts'
import { PayPalProvider } from './paypal.ts'

// Loads the merchant's connected provider from payment_config, decrypts their
// OWN credentials just-in-time, and returns the matching adapter. There is at
// most one connected provider at a time (Phase 1).
export async function getActiveProvider(): Promise<PaymentProvider | null> {
  const [cfg] = await db.select().from(paymentConfig).where(eq(paymentConfig.connected, true)).limit(1)
  if (!cfg) return null

  const creds = decryptJSON<Omit<ProviderCredentials, 'mode' | 'webhookSecret'>>(cfg.credentialsEnc)
  const webhookSecret = cfg.webhookSecretEnc ? decryptString(cfg.webhookSecretEnc) : undefined
  const full: ProviderCredentials = {
    ...creds,
    webhookSecret,
    publishableKey: cfg.publishableKey ?? creds.publishableKey,
    mode: (cfg.mode as 'test' | 'live') ?? 'test',
  }

  switch (cfg.provider) {
    case 'stripe':
      return new StripeProvider(full)
    case 'square':
      return new SquareProvider(full)
    case 'paypal':
      return new PayPalProvider(full)
    default:
      return null
  }
}
