// Global picker state so any ImagePickerField can pop the same modal.
// Section forms don't need to know about the modal at all — they call
// usePhotoPicker().pickOne(currentUrl) and await the selected URL (or null
// if dismissed).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface Photo {
  id: string
  url: string
  alt?: string | null
  tag?: string | null
  width?: number | null
  height?: number | null
}

interface PickerRequest {
  resolve: (url: string | null) => void
  initialUrl: string
  initialTag?: string
}

interface PhotoPickerContextValue {
  open: PickerRequest | null
  pickOne: (initialUrl: string, initialTag?: string) => Promise<string | null>
  close: (url: string | null) => void
}

const ctx = createContext<PhotoPickerContextValue | null>(null)

export function PhotoPickerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PickerRequest | null>(null)

  const pickOne = useCallback((initialUrl: string, initialTag?: string) => {
    return new Promise<string | null>((resolve) => {
      setRequest({ resolve, initialUrl, initialTag })
    })
  }, [])

  const close = useCallback((url: string | null) => {
    if (request) {
      request.resolve(url)
      setRequest(null)
    }
  }, [request])

  return (
    <ctx.Provider value={{ open: request, pickOne, close }}>
      {children}
    </ctx.Provider>
  )
}

export function usePhotoPicker() {
  const value = useContext(ctx)
  if (!value) throw new Error('usePhotoPicker must be used within PhotoPickerProvider')
  return value
}

export type { Photo }
