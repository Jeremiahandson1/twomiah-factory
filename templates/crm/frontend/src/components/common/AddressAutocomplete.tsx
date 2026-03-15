import { useEffect, useRef, useCallback } from 'react'

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

  window._googleMapsLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api"]')
    if (existing) {
      // Script tag exists but hasn't loaded yet — wait for it
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Maps script failed to load'))
    document.head.appendChild(script)
  })

  return window._googleMapsLoading
}

function parsePlace(place: any): { address: string; city: string; state: string; zip: string } {
  const components = place.address_components || []
  let streetNumber = ''
  let route = ''
  let city = ''
  let state = ''
  let zip = ''

  for (const comp of components) {
    const types: string[] = comp.types || []
    if (types.includes('street_number')) {
      streetNumber = comp.long_name
    } else if (types.includes('route')) {
      route = comp.long_name
    } else if (types.includes('locality')) {
      city = comp.long_name
    } else if (types.includes('sublocality_level_1') && !city) {
      city = comp.long_name
    } else if (types.includes('administrative_area_level_1')) {
      state = comp.short_name
    } else if (types.includes('postal_code')) {
      zip = comp.long_name
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
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const listenerRef = useRef<any>(null)

  const handleSelect = useCallback(() => {
    if (!autocompleteRef.current) return
    const place = autocompleteRef.current.getPlace()
    if (!place?.address_components) return
    const parsed = parsePlace(place)
    onSelect(parsed)
  }, [onSelect])

  useEffect(() => {
    let cancelled = false

    loadGooglePlaces()
      .then(() => {
        if (cancelled || !inputRef.current) return
        if (autocompleteRef.current) return // already initialized

        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ['address'],
          componentRestrictions: { country: 'us' },
          fields: ['address_components'],
        })

        autocompleteRef.current = ac
        listenerRef.current = ac.addListener('place_changed', handleSelect)
      })
      .catch(() => {
        // API key missing or script load failure — input still works as a plain text field
      })

    return () => {
      cancelled = true
      if (listenerRef.current) {
        window.google?.maps?.event?.removeListener(listenerRef.current)
        listenerRef.current = null
      }
    }
  }, [handleSelect])

  const inputClasses = className ??
    'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <input
      ref={inputRef}
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      className={inputClasses}
    />
  )
}
