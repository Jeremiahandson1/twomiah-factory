// ─── QuickBooks Online OAuth2 Service ──────────────────────────────────────
// Handles OAuth2 authorization, token exchange, refresh, and basic API calls
// for connecting the Factory to QuickBooks Online.

const QBO_AUTH_ENDPOINT = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3'

function getClientId(): string {
  const id = process.env.QBO_CLIENT_ID
  if (!id) throw new Error('QBO_CLIENT_ID is not set')
  return id
}

function getClientSecret(): string {
  const secret = process.env.QBO_CLIENT_SECRET
  if (!secret) throw new Error('QBO_CLIENT_SECRET is not set')
  return secret
}

function getRedirectUri(): string {
  const apiUrl = process.env.API_URL || (process.env.NODE_ENV === 'production' ? 'https://twomiah-factory-api.onrender.com' : 'http://localhost:3001')
  return process.env.QBO_REDIRECT_URI || `${apiUrl}/api/v1/factory/integrations/qbo/callback`
}

function basicAuthHeader(): string {
  const credentials = `${getClientId()}:${getClientSecret()}`
  return 'Basic ' + btoa(credentials)
}

/**
 * Build the Intuit OAuth2 authorization URL.
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: getRedirectUri(),
    state,
  })
  return `${QBO_AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Exchange an authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(code: string, realmId: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  realm_id: string
}> {
  const res = await fetch(QBO_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(),
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QBO token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    realm_id: realmId,
  }
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const res = await fetch(QBO_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(),
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QBO token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  }
}

/**
 * Fetch company info from QBO to verify the connection works.
 */
export async function getCompanyInfo(accessToken: string, realmId: string): Promise<{
  companyName: string
  country: string
  [key: string]: any
}> {
  const res = await fetch(`${QBO_API_BASE}/company/${realmId}/companyinfo/${realmId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QBO company info request failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const info = data.CompanyInfo
  return {
    companyName: info?.CompanyName || 'Unknown',
    country: info?.Country || '',
    ...info,
  }
}
