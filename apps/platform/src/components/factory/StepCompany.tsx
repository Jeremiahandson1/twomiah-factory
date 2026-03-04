import { useEffect, useRef, useState } from 'react'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = {
  config: FactoryConfig
  updateNested: <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) => void
  onNext: () => void
  onBack: () => void
}

export const INDUSTRY_OPTIONS = [
  { value: 'general_contractor', label: 'General Contractor' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'remodeling', label: 'Remodeling / Renovation' },
  { value: 'painting', label: 'Painting' },
  { value: 'landscaping', label: 'Landscaping / Lawn Care' },
  { value: 'concrete', label: 'Concrete / Masonry' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'windows_doors', label: 'Windows & Doors' },
  { value: 'siding', label: 'Siding / Gutters' },
  { value: 'insulation', label: 'Insulation' },
  { value: 'solar', label: 'Solar' },
  { value: 'pool_spa', label: 'Pool & Spa' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'commercial_construction', label: 'Commercial Construction' },
  { value: 'home_care', label: 'Home Care / Senior Care' },
  { value: 'other', label: 'Other (blank slate)' },
]

// Radius options for nearby cities search
const RADIUS_OPTIONS = [
  { value: 25, label: '25 miles' },
  { value: 50, label: '50 miles' },
  { value: 75, label: '75 miles' },
  { value: 100, label: '100 miles' },
]

function Field({ label, value, onChange, placeholder, type = 'text', required = false, error, children }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; required?: boolean; error?: string; children?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}{required && ' *'}</label>
      {children ?? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={'w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors ' + (error ? 'border-red-500' : 'border-gray-700')}
        />
      )}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}

// Load Google Maps JS API script once
function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.maps?.places) { resolve(); return }
    const existing = document.getElementById('google-maps-script')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = 'google-maps-script'
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + apiKey + '&libraries=places'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(script)
  })
}

export default function StepCompany({ config, updateNested, onNext, onBack }: Props) {
  const c = config.company
  const set = (key: keyof typeof c, value: any) => updateNested('company', { [key]: value } as any)

  const addressInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const [mapsReady, setMapsReady] = useState(false)
  const [mapsError, setMapsError] = useState('')
  const [searchingCities, setSearchingCities] = useState(false)
  const [cityRadius, setCityRadius] = useState(50)
  const [citySuggestions, setCitySuggestions] = useState<string[]>([])
  const [geoLatLng, setGeoLatLng] = useState<{ lat: number; lng: number } | null>(null)

  const apiKey = config.integrations?.googleMaps?.apiKey || (import.meta.env.VITE_GOOGLE_MAPS_KEY as string || '')

  // Load Maps API when key is available
  useEffect(() => {
    if (!apiKey) return
    loadGoogleMaps(apiKey)
      .then(() => setMapsReady(true))
      .catch(() => setMapsError('Could not load Google Maps'))
  }, [apiKey])

  // Init autocomplete on address field once Maps is ready
  useEffect(() => {
    if (!mapsReady || !addressInputRef.current) return
    const google = (window as any).google
    autocompleteRef.current = new google.maps.places.Autocomplete(addressInputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components', 'geometry', 'formatted_address'],
    })
    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace()
      if (!place?.address_components) return

      let streetNumber = '', streetName = '', city = '', state = '', zip = ''
      for (const comp of place.address_components) {
        const types = comp.types
        if (types.includes('street_number')) streetNumber = comp.long_name
        if (types.includes('route')) streetName = comp.long_name
        if (types.includes('locality')) city = comp.long_name
        if (types.includes('administrative_area_level_1')) state = comp.short_name
        if (types.includes('postal_code')) zip = comp.long_name
      }

      const fullAddress = streetNumber && streetName ? streetNumber + ' ' + streetName : place.formatted_address?.split(',')[0] || ''

      updateNested('company', {
        address: fullAddress,
        city,
        state,
        zip,
      } as any)

      // Store lat/lng for nearby cities search
      if (place.geometry?.location) {
        setGeoLatLng({
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        })
      }
    })
  }, [mapsReady])

  // Search nearby cities
  async function findNearbyCities() {
    if (!geoLatLng && !c.city) return
    if (!mapsReady) return
    setSearchingCities(true)
    setCitySuggestions([])

    try {
      const google = (window as any).google
      const radiusMeters = cityRadius * 1609.34 // miles to meters

      // Use lat/lng from autocomplete, or geocode the city name
      let center = geoLatLng
      if (!center && c.city) {
        const geocoder = new google.maps.Geocoder()
        const result: any = await new Promise((res, rej) =>
          geocoder.geocode({ address: c.city + ', ' + c.state }, (r: any, s: any) =>
            s === 'OK' ? res(r) : rej(new Error('Geocode failed'))
          )
        )
        center = {
          lat: result[0].geometry.location.lat(),
          lng: result[0].geometry.location.lng(),
        }
      }
      if (!center) return

      const map = new google.maps.Map(document.createElement('div'))
      const service = new google.maps.places.PlacesService(map)

      const results: any[] = await new Promise((res, rej) =>
        service.nearbySearch({
          location: center,
          radius: radiusMeters,
          type: 'locality',
        }, (r: any, s: any) => {
          if (s === 'OK' || s === 'ZERO_RESULTS') res(r || [])
          else rej(new Error('Places search failed: ' + s))
        })
      )

      // Filter out the home city, sort by distance, take top 8
      const homeCityLower = (c.city || '').toLowerCase()
      const nearby = results
        .map((r: any) => ({
          name: r.name as string,
          lat: r.geometry.location.lat() as number,
          lng: r.geometry.location.lng() as number,
        }))
        .filter(r => r.name.toLowerCase() !== homeCityLower)
        .sort((a, b) => {
          const distA = Math.sqrt(Math.pow(a.lat - center!.lat, 2) + Math.pow(a.lng - center!.lng, 2))
          const distB = Math.sqrt(Math.pow(b.lat - center!.lat, 2) + Math.pow(b.lng - center!.lng, 2))
          return distA - distB
        })
        .slice(0, 8)
        .map(r => r.name)

      setCitySuggestions(nearby)
    } catch (e: any) {
      console.warn('[Nearby Cities]', e.message)
    } finally {
      setSearchingCities(false)
    }
  }

  // Toggle a suggested city into/out of the nearbyCities array
  function toggleCity(cityName: string) {
    const current = c.nearbyCities || []
    if (current.includes(cityName)) {
      updateNested('company', { nearbyCities: current.filter((x: string) => x !== cityName) } as any)
    } else if (current.filter(Boolean).length < 4) {
      const updated = [...current]
      // Fill into first empty slot
      const emptyIdx = updated.findIndex(x => !x)
      if (emptyIdx >= 0) updated[emptyIdx] = cityName
      else updated.push(cityName)
      updateNested('company', { nearbyCities: updated.slice(0, 4) } as any)
    }
  }

  const canNext = !!c.name?.trim() && !!c.email?.trim() && !!c.phone?.trim() && !!c.city?.trim()

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Company Information</h2>
      <p className="text-gray-400 text-sm mb-6">This info gets embedded throughout the generated package.</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="col-span-2">
          <Field label="Company Name" required value={c.name} onChange={v => set('name', v)} placeholder="Acme Construction" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Industry</label>
          <select value={c.industry} onChange={e => set('industry', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500">
            <option value="">Select industry...</option>
            {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <Field label="Owner / Operator Name" value={c.ownerName} onChange={v => set('ownerName', v)} placeholder="John Smith" />
        <Field label="Email" required type="email" value={c.email} onChange={v => set('email', v)} placeholder="info@acme.com" />
        <Field label="Phone" required value={c.phone} onChange={v => set('phone', v)} placeholder="(555) 123-4567" />
        <Field label="Domain" value={c.domain} onChange={v => set('domain', v)} placeholder="acmeconstruction.com" />

        {/* Address with Google Autocomplete */}
        <div className="col-span-2">
          <label className="block text-xs text-gray-400 mb-1">
            Street Address
            {apiKey && mapsReady && <span className="ml-2 text-green-500 text-xs">● Google Autocomplete</span>}
            {apiKey && !mapsReady && !mapsError && <span className="ml-2 text-yellow-500 text-xs">Loading Maps...</span>}
            {mapsError && <span className="ml-2 text-red-400 text-xs">{mapsError}</span>}
            {!apiKey && <span className="ml-2 text-gray-500 text-xs">(add Google Maps key in Integrations for autocomplete)</span>}
          </label>
          <input
            ref={addressInputRef}
            type="text"
            defaultValue={c.address}
            onChange={e => set('address', e.target.value)}
            placeholder="123 Main Street"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        <Field label="City" required value={c.city} onChange={v => set('city', v)} placeholder="Eau Claire" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="State" value={c.state} onChange={v => set('state', v)} placeholder="WI" />
          <Field label="ZIP" value={c.zip} onChange={v => set('zip', v)} placeholder="54701" />
        </div>
        <div className="col-span-2">
          <Field label="Service Region Name" value={c.serviceRegion} onChange={v => set('serviceRegion', v)} placeholder="Chippewa Valley" />
        </div>

        {/* Nearby Cities */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400">Nearby Cities (for service area pages)</label>
            {apiKey && mapsReady && (
              <div className="flex items-center gap-2">
                <select
                  value={cityRadius}
                  onChange={e => setCityRadius(Number(e.target.value))}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-orange-500"
                >
                  {RADIUS_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button
                  onClick={findNearbyCities}
                  disabled={searchingCities || (!c.city && !geoLatLng)}
                  className="px-3 py-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors"
                >
                  {searchingCities ? 'Searching...' : '⟳ Auto-fill'}
                </button>
              </div>
            )}
          </div>

          {/* Suggestion chips */}
          {citySuggestions.length > 0 && (
            <div className="mb-3 p-3 bg-gray-800 border border-gray-700 rounded-lg">
              <p className="text-xs text-gray-400 mb-2">Click to add (up to 4):</p>
              <div className="flex flex-wrap gap-2">
                {citySuggestions.map(city => {
                  const selected = (c.nearbyCities || []).includes(city)
                  const full = (c.nearbyCities || []).filter(Boolean).length >= 4 && !selected
                  return (
                    <button
                      key={city}
                      onClick={() => toggleCity(city)}
                      disabled={full}
                      className={'px-3 py-1 rounded-full text-xs border transition-colors ' + (
                        selected
                          ? 'bg-orange-600 border-orange-500 text-white'
                          : full
                          ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-orange-500 hover:text-white'
                      )}
                    >
                      {selected ? '✓ ' : ''}{city}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Manual inputs */}
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map(i => (
              <input
                key={i}
                value={c.nearbyCities[i] || ''}
                onChange={e => {
                  const cities = [...(c.nearbyCities || ['', '', '', ''])]
                  cities[i] = e.target.value
                  updateNested('company', { nearbyCities: cities } as any)
                }}
                placeholder={'Nearby city ' + (i + 1)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              />
            ))}
          </div>
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} canNext={canNext} />
    </div>
  )
}
