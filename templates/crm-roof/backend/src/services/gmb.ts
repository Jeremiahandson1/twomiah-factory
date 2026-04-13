/**
 * Google My Business (GMB) / Google Business Profile sync service
 *
 * Pulls reviews posted to your Google Business Profile listing into the
 * local `review` table so they show up in the Reviews Page dashboard.
 *
 * ──────────────────────────────────────────────────────────────────────
 * TO GO LIVE:
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1) Create a Google Cloud project and enable the "My Business Business
 *    Information API" + "My Business Account Management API":
 *    https://developers.google.com/my-business/content/overview
 *
 * 2) Create OAuth 2.0 credentials (Desktop or Web application):
 *    https://console.cloud.google.com/apis/credentials
 *    Download the client_secret JSON.
 *
 * 3) Go through the OAuth flow ONCE to get a refresh_token for the agency's
 *    Google account. Store these in .env:
 *    GMB_CLIENT_ID=<client_id from JSON>
 *    GMB_CLIENT_SECRET=<client_secret from JSON>
 *    GMB_REFRESH_TOKEN=<refresh_token from OAuth flow>
 *    GMB_ACCOUNT_ID=accounts/<numeric id>
 *    GMB_LOCATION_ID=locations/<numeric id>
 *
 * 4) Implement `fetchAccessToken()` to exchange refresh_token for a fresh
 *    access_token via https://oauth2.googleapis.com/token
 *
 * 5) Implement `fetchReviewsFromGoogle()` to call the reviews list endpoint
 *    (deprecated v4 API is still the only way to programmatically read
 *    reviews — note Google has been restricting this API, check current
 *    status). Alternative: use a third-party aggregator like Grade.us,
 *    BirdEye, or Podium.
 *
 * 6) Schedule `syncReviews(companyId)` to run hourly via a cron job.
 *
 * Until configured, POST /api/reviews/sync/gmb returns "not configured".
 */

import { db } from '../../db/index.ts'
import { review } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'

export class GmbNotConfiguredError extends Error {
  constructor() {
    super(
      'Google My Business sync is not configured. ' +
      'Set GMB_CLIENT_ID, GMB_CLIENT_SECRET, GMB_REFRESH_TOKEN, GMB_ACCOUNT_ID, ' +
      'and GMB_LOCATION_ID in .env. See services/gmb.ts header for setup instructions.'
    )
  }
}

export interface GoogleReview {
  googleReviewId: string
  reviewerName: string
  rating: number
  comment?: string
  createdAt: Date
  replied?: boolean
  replyText?: string
}

// ─────────────────────────────────────────────────────────────
// OAUTH — refresh-token → access-token exchange
// ─────────────────────────────────────────────────────────────

let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function fetchAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token
  }

  const clientId = process.env.GMB_CLIENT_ID
  const clientSecret = process.env.GMB_CLIENT_SECRET
  const refreshToken = process.env.GMB_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new GmbNotConfiguredError()
  }

  // TODO: Implement the actual token exchange. Skeleton:
  // const res = await fetch('https://oauth2.googleapis.com/token', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({
  //     client_id: clientId,
  //     client_secret: clientSecret,
  //     refresh_token: refreshToken,
  //     grant_type: 'refresh_token',
  //   }),
  // })
  // const json = await res.json()
  // cachedAccessToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  // return json.access_token

  throw new GmbNotConfiguredError()
}

// ─────────────────────────────────────────────────────────────
// REVIEWS FETCH — call Google, normalize to GoogleReview[]
// ─────────────────────────────────────────────────────────────

async function fetchReviewsFromGoogle(): Promise<GoogleReview[]> {
  const accountId = process.env.GMB_ACCOUNT_ID
  const locationId = process.env.GMB_LOCATION_ID
  if (!accountId || !locationId) throw new GmbNotConfiguredError()

  const token = await fetchAccessToken()

  // TODO: Actual API call. The v4 reviews endpoint:
  // GET https://mybusiness.googleapis.com/v4/{accountId}/{locationId}/reviews
  // with Authorization: Bearer {token}
  //
  // Returns { reviews: [{ reviewId, reviewer: { displayName }, starRating, comment, createTime, reviewReply }] }
  // Map to GoogleReview[].
  //
  // NOTE: Google has been restricting this API. If it's unavailable,
  // consider using a third-party aggregator (BirdEye, Grade.us, Podium)
  // which have more reliable programmatic access.

  throw new GmbNotConfiguredError()
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — called by routes/reviews.ts
// ─────────────────────────────────────────────────────────────

/** Sync GMB reviews into the local `review` table. Dedupes on googleReviewId. */
export async function syncReviews(companyId: string) {
  const googleReviews = await fetchReviewsFromGoogle()

  let inserted = 0
  let skipped = 0

  for (const gr of googleReviews) {
    // Check if this Google review already exists (dedup on the Google ID
    // stored in the comment field or a future dedicated column).
    const existing = await db
      .select()
      .from(review)
      .where(and(eq(review.companyId, companyId), eq(review.platform, 'google')))
      .limit(50)

    const alreadyImported = existing.some((r: any) => r.comment?.includes(gr.googleReviewId))
    if (alreadyImported) { skipped++; continue }

    await db.insert(review).values({
      companyId,
      rating: gr.rating,
      comment: gr.comment,
      platform: 'google',
      reviewerName: gr.reviewerName,
      verified: true, // Google reviews are pre-verified
      receivedAt: gr.createdAt,
    } as any)
    inserted++
  }

  return { fetchedCount: googleReviews.length, insertedCount: inserted, skippedCount: skipped }
}

export const isConfigured = (): boolean => {
  return !!(process.env.GMB_CLIENT_ID && process.env.GMB_CLIENT_SECRET && process.env.GMB_REFRESH_TOKEN && process.env.GMB_ACCOUNT_ID && process.env.GMB_LOCATION_ID)
}

export default { syncReviews, isConfigured }
