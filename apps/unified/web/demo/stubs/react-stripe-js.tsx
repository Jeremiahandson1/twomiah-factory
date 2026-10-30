// The demo build's stand-in for @stripe/react-stripe-js (see stubs/stripe-js.ts): no card form is ever drawn.
import type { ReactNode } from 'react'

export const Elements = ({ children }: { children?: ReactNode; stripe?: unknown; options?: unknown }) => <>{children}</>
export const PaymentElement = (_props: Record<string, unknown>) => null
export const useStripe = () => null
export const useElements = () => null
