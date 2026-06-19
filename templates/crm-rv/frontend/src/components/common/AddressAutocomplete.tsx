import { useEffect, useRef, useCallback, useState } from 'react'

interface ParsedAddress {
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressAutocompleteProps {
  onSelect: (parsed: ParsedAddress) => void
  placeholder?: string
  className?: string
  value?: string
  onChange?: (value: string) => void
}

declare global {
  interface Window {
    google?: any
    _googleMapsLoading?: Promise<void>
  }
}

function loadGooglePlaces(): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve()
  if (window._googleMapsLoading) return window._googleMapsLoading

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) {
    console.warn('[AddressAutocomplete] VITE_GOOGLE_MAPS_API_KEY is not set')
    return Promise.reject(new Error('Google Maps API key not configured'))
  }

  window._googleMapsLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&loading=async`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Maps script failed to load'))
    document.head.appendChild(script)
  })

  return window._googleMapsLoading
}

interface AddressComponent {
  types: string[];
  longText?: string;
  long_name?: string;
  shortText?: string;
  short_name?: string;
}

function parseAddressComponents(components: AddressComponent[]): ParsedAddress {
  let streetNumber = ''
  let route = ''
  let city = ''
  let state = ''
  let zip = ''

  for (const comp of components) {
    const types: string[] = comp.types || []
    if (types.includes('street_number')) {
      streetNumber = comp.longText || comp.long_name || ''
    } else if (types.includes('route')) {
      route = comp.longText || comp.long_name || ''
    } else if (types.includes('locality')) {
      city = comp.longText || comp.long_name || ''
    } else if (types.includes('sublocality_level_1') && !city) {
      city = comp.longText || comp.long_name || ''
    } else if (types.includes('administrative_area_level_1')) {
      state = comp.shortText || comp.short_name || ''
    } else if (types.includes('postal_code')) {
      zip = comp.longText || comp.long_name || ''
    }
  }

  const address = [streetNumber, route].filter(Boolean).join(' ')
  return { address, city, state, zip }
}

export default function AddressAutocomplete({
  onSelect,
  placeholder = 'Start typing an address...',
  className,
  value,
  onChange,
}: AddressAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [usesFallback, setUsesFallback] = useState(false)

  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    let cancelled = false

    loadGooglePlaces()
      .then(async () => {
        if (cancelled || !containerRef.current) return

        try {
          // Import the places library (required for new API)
          await window.google.maps.importLibrary('places')

          // Try new PlaceAutocompleteElement first
          if (window.google.maps.places.PlaceAutocompleteElement) {
            const el = new window.google.maps.places.PlaceAutocompleteElement({
              componentRestrictions: { country: 'us' },
              types: ['address'],
            })

            // Style the inner input to match our design
            el.style.width = '100%'
            containerRef.current.appendChild(el)
            elementRef.current = el

            el.addEventListener('gmp-select', async (e: any) => {
              try {
                const place = e.placePrediction.toPlace()
                await place.fetchFields({ fields: ['addressComponents'] })
                const components = place.addressComponents || []
                const parsed = parseAddressComponents(components)
                onSelectRef.current(parsed)
                onChangeRef.current?.(parsed.address)
              } catch (err) {
                console.warn('[AddressAutocomplete] Failed to fetch place details:', err)
              }
            })
          } else if (window.google.maps.places.Autocomplete) {
            // Fallback to legacy Autocomplete
            setUsesFallback(true)
          } else {
            setUsesFallback(true)
          }
        } catch (err) {
          console.warn('[AddressAutocomplete] Failed to initialize:', err)
          setUsesFallback(true)
        }
      })
      .catch(() => {
        setUsesFallback(true)
      })

    return () => {
      cancelled = true
      if (elementRef.current && containerRef.current?.contains(elementRef.current)) {
        containerRef.current.removeChild(elementRef.current)
        elementRef.current = null
      }
    }
  }, [])

  const inputClasses = className ??
    'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  // If new API is available, show the Google widget container
  // If not, fall back to a plain input
  return (
    <div>
      <div ref={containerRef} className={usesFallback ? 'hidden' : ''} />
      {usesFallback && (
        <input
          ref={inputRef}
          type="text"
          value={value ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
    </div>
  )
}
