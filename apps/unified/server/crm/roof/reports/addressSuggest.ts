// Address suggestions for the public instant estimator (live test 11/11: the estimator page had a plain street box — no
// suggestions, nothing filled in — where the estimators it stands beside (Roofle, Zuper) suggest the address as it is
// typed and fill in the city, state and zip from the one picked).
//
// Asked of Google's Places API (New) by the SERVER, with the server's Maps key — not from the visitor's browser: the
// widget is pasted onto the roofer's own website, any web address, which a browser key locked to our domains would
// refuse; and no key reaches the page.
//
// Billing (Google's session pricing, read 2026-11-11): the suggestions asked while one address is typed carry one session
// token, and the session is closed by the Place Details call that fills in the city, state and zip (Essentials fields
// only: addressComponents). Asking for details with the same token is what makes the typing that came before it cost
// little; a visitor who never picks a suggestion pays per suggestion request, which the widget keeps few (it waits for
// a pause in typing and three characters).
const PLACES = 'https://places.googleapis.com/v1'
const placesKey = () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_SOLAR_API_KEY || ''

/** A session token as the widget makes one: letters, digits, - and _. */
export const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/
/** A Places id as Google gives one. */
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,400}$/

export interface AddressSuggestion { id: string; text: string }
export interface PickedAddress { address: string; city: string; state: string; zip: string }

/** Up to five US street addresses for what has been typed; [] when Google is not reachable or not set up. */
export async function suggestAddresses(input: string, session: string): Promise<AddressSuggestion[]> {
  const key = placesKey()
  if (!key) return []
  try {
    const r = await fetch(`${PLACES}/places:autocomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' },
      body: JSON.stringify({ input, sessionToken: session, includedRegionCodes: ['us'], includedPrimaryTypes: ['street_address', 'premise', 'subpremise'] }),
    })
    if (!r.ok) return []
    const d: any = await r.json()
    return ((d?.suggestions || []) as any[])
      .map((s) => ({ id: String(s?.placePrediction?.placeId || ''), text: String(s?.placePrediction?.text?.text || '') }))
      .filter((s) => s.id && s.text)
      .slice(0, 5)
  } catch {
    return []
  }
}

/** The street, city, state and zip of the address picked; null when Google does not answer. */
export async function pickedAddress(placeId: string, session: string): Promise<PickedAddress | null> {
  const key = placesKey()
  if (!key) return null
  try {
    const r = await fetch(`${PLACES}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'addressComponents' },
    })
    if (!r.ok) return null
    const d: any = await r.json()
    const part = (type: string, short = false) => {
      const c = ((d?.addressComponents || []) as any[]).find((x) => Array.isArray(x?.types) && x.types.includes(type))
      return String((short ? c?.shortText : c?.longText) || '')
    }
    const address = [part('street_number'), part('route')].filter(Boolean).join(' ')
    const city = part('locality') || part('sublocality_level_1') || part('postal_town')
    return { address, city, state: part('administrative_area_level_1', true), zip: part('postal_code') }
  } catch {
    return null
  }
}
