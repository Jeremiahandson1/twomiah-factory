import { useEffect, useRef, useCallback, useState } from 'react'

interface AddressAutocompleteProps {
  onSelect: (parsed: { address: string; city: string; state: string; zip: string }) => void
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

  /**
   * READY IS NOT LOADED. (T61)
   *
   * With `loading=async` the script tag's onload fires when the BOOTSTRAP has arrived, before
   * google.maps is built — so the component then called google.maps.importLibrary and got
   * "importLibrary is not a function" (seen in a real browser on the roofing tenant; a few seconds
   * later the same call works). Google's signal for "ready" is the `callback` parameter, so that is
   * what resolves this now. A script already on the page is waited for the same way: poll for the
   * API rather than trust a load event that may have fired long ago, or fired too early.
   */
  window._googleMapsLoading = new Promise<void>((resolve, reject) => {
    const ready = () => typeof window.google?.maps?.importLibrary === 'function' || !!window.google?.maps?.places
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api"]')
    if (existing) {
      if (ready()) { resolve(); return }
      const started = Date.now()
      const iv = setInterval(() => {
        if (ready()) { clearInterval(iv); resolve() }
        else if (Date.now() - started > 15000) { clearInterval(iv); reject(new Error('Google Maps did not finish loading')) }
      }, 100)
      existing.addEventListener('error', () => { clearInterval(iv); reject(new Error('Google Maps script failed to load')) })
      return
    }

    ;(window as any).__twomiahMapsReady = () => resolve()
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&loading=async&callback=__twomiahMapsReady`
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Google Maps script failed to load'))
    document.head.appendChild(script)
  })

  return window._googleMapsLoading
}

function parseAddressComponents(components: any[]): { address: string; city: string; state: string; zip: string } {
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
          // `libraries=places` already loads it; importLibrary is the modern way to be sure, when present.
          if (typeof window.google.maps.importLibrary === 'function') await window.google.maps.importLibrary('places')

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
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
    </div>
  )
}
