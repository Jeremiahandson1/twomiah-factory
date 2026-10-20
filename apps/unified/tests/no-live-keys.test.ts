// The harness blanks every outside service's key from the shell (noLiveKeys.ts) and keeps our own secrets.
import { test, expect } from 'bun:test'
import './harness.ts'
import { blankLiveKeys, liveKeys, withoutLiveKeys } from './noLiveKeys.ts'

const shell = {
  ANTHROPIC_API_KEY: 'sk-ant-real', OPENAI_API_KEY: 'sk-real', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x',
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', RESEND_API_KEY: 're_x', GOOGLE_MAPS_BROWSER_KEY: 'g', QBO_CLIENT_ID: 'q',
  R2_SECRET_ACCESS_KEY: 'r', WORCS_PASSWORD: 'w', DATABASE_URL: 'postgres://prod', FACTORY_URL: 'https://factory',
  JWT_SECRET: 'j', PAYMENT_ENC_KEY: 'p', FACTORY_SYNC_KEY: 'f', TEST_PG_URL: 'postgres://local', PATH: '/bin', TZ: 'UTC',
}

test('every outside service key is blanked; our own secrets and the local test database are kept', () => {
  const out = withoutLiveKeys(shell)
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'GOOGLE_MAPS_BROWSER_KEY', 'QBO_CLIENT_ID', 'R2_SECRET_ACCESS_KEY', 'WORCS_PASSWORD', 'DATABASE_URL', 'FACTORY_URL'])
    expect({ k, v: out[k] }).toEqual({ k, v: '' })
  for (const k of ['JWT_SECRET', 'PAYMENT_ENC_KEY', 'FACTORY_SYNC_KEY', 'TEST_PG_URL', 'PATH', 'TZ'])
    expect({ k, v: out[k] }).toEqual({ k, v: (shell as any)[k] })
})

test('blankLiveKeys blanks them in place, as the harness does to process.env when it loads', () => {
  const env: Record<string, string | undefined> = { ...shell }
  blankLiveKeys(env)
  expect(liveKeys(env).filter((k) => env[k])).toEqual([])
  expect(env.JWT_SECRET).toBe('j')
})
