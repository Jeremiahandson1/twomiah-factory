// Finding a property's lawn, beds and hardscape from the air (landscaping parity row 3; Aspire ProMaps, Jobber's lawn measuring, LMN
// through Attentive.ai; feature aerial_detect, not ready). Everything up to the imagery/AI provider is here; the provider is not:
//
//   · AerialProvider — what a provider must do: given the property's address and the map's view, return typed outlines
//     ({ areaType, label, path: [[lat, lng], …] }) or a plain-words error;
//   · the proposals are checked exactly as a drawn shape is (data/siteShapes.ts readShapes), and NEVER saved here: the map shows them
//     as editable outlines for the office to check, change or delete, and the ordinary Save keeps what they keep;
//   · with no provider connected the answer is "not connected", said plainly (code NO_PROVIDER).
//
// THE STEP LEFT: an account and contract with an imagery/detection provider (Attentive.ai's API, Nearmap AI, EagleView, or Google's
// imagery with a segmentation model), and an adapter here that maps its parcels to these area types. Until then `providerFor`
// answers null.
import { readShapes, SHAPE_AREA_TYPES, type ShapeInput } from './siteShapes.ts'

export const AERIAL_FEATURE = 'aerial_detect'

export interface DetectInput {
  address: string
  center: { lat: number; lng: number }
  bounds: { north: number; south: number; east: number; west: number } | null
}
export interface DetectedShape { areaType: string; label?: string | null; path: Array<[number, number]> }
export interface AerialProvider {
  /** Shown to the office ("Found by …"). */
  name: string
  detect(input: DetectInput): Promise<{ shapes: DetectedShape[] } | { error: string }>
}

let testProvider: AerialProvider | null = null
/** Tests only: stand a provider in (null takes it away). */
export function useAerialProviderForTests(p: AerialProvider | null) { testProvider = p }

/** The provider this server has, or null — none is connected yet (see THE STEP LEFT above). */
export function providerFor(_env: Record<string, string | undefined> = process.env): AerialProvider | null {
  return testProvider
}

/** The map's view as sent by the screen, checked. */
export function readView(b: any): { center: DetectInput['center']; bounds: DetectInput['bounds'] } | { error: string } {
  const lat = Number(b?.center?.lat), lng = Number(b?.center?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: 'Move the map to the property first.' }
  const bo = b?.bounds
  const bounds = bo && ['north', 'south', 'east', 'west'].every((k) => Number.isFinite(Number(bo[k])))
    ? { north: Number(bo.north), south: Number(bo.south), east: Number(bo.east), west: Number(bo.west) } : null
  return { center: { lat, lng }, bounds }
}

export type DetectOutcome =
  | { status: 'ok'; provider: string; shapes: ShapeInput[]; dropped: number }
  | { status: 'error'; code: 'NO_PROVIDER' | 'PROVIDER_FAILED'; error: string }

/**
 * Ask the provider; keep what passes the drawn-shape check, one shape at a time (a provider's odd outline is dropped and counted,
 * never fatal), with "found automatically — check it" in its label so nobody mistakes it for a measured one.
 */
export async function detectAreas(provider: AerialProvider | null, input: DetectInput): Promise<DetectOutcome> {
  if (!provider) return { status: 'error', code: 'NO_PROVIDER', error: 'Finding areas automatically needs an aerial imagery provider, and none is connected yet. Draw the areas on the map instead.' }
  let out: { shapes: DetectedShape[] } | { error: string }
  try { out = await provider.detect(input) } catch (err: any) { out = { error: String(err?.message || 'The provider did not answer') } }
  if ('error' in out) return { status: 'error', code: 'PROVIDER_FAILED', error: `${provider.name} could not find the areas: ${out.error}` }
  const kept: ShapeInput[] = []
  let dropped = 0
  for (const s of (Array.isArray(out.shapes) ? out.shapes : []).slice(0, 100)) {
    if (!(SHAPE_AREA_TYPES as readonly string[]).includes(s?.areaType)) { dropped++; continue }
    const read = readShapes([{ areaType: s.areaType, mode: 'add', label: s.label, path: s.path }])
    if ('error' in read) { dropped++; continue }
    const one = read.shapes[0]
    kept.push({ ...one, label: `${one.label ? `${one.label} — ` : ''}found automatically, check it`.slice(0, 80) })
  }
  return { status: 'ok', provider: provider.name, shapes: kept, dropped }
}
