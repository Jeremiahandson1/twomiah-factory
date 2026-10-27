import { z } from 'zod'

/**
 * `schema.partial()` for an update route: a key the caller did not send stays ABSENT.
 *
 * zod 3's `.partial()` wrapped each field in `.optional()`, so a missing key came out undefined and the route left that
 * column alone. zod 4 applies a field's `.default(...)` inside the optional: a PUT that sent only `{ notes }` came out as
 * `{ notes, discount: 0, lineItems: [] }`, and the invoice's lines and discount were wiped (found by
 * contractor-live-1022: "saving it unchanged still works"). Stripping the defaults first keeps the old behaviour on either
 * zod. Only a field's own default (or one behind `.optional()`) is stripped; every other rule of the field is kept.
 */
export function partialOf<T extends z.ZodObject<any>>(schema: T) {
  const strip = (f: any): any => {
    if (f instanceof z.ZodDefault) return strip((f as any).removeDefault())
    if (f instanceof z.ZodOptional) return strip((f as any).unwrap()).optional()
    return f
  }
  const shape: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema.shape)) shape[k] = strip(v)
  return (schema as any).extend(shape).partial() as ReturnType<T['partial']>
}
