// A material order's status, in the roofer's words. One list for the server's documents (the printable order, the email to the
// supplier); the screens keep their own copy of the words in web/.../roof/lib/supplier.ts (the web build cannot import the
// server). The statuses themselves are validation.ts MATERIAL_ORDER_STATUSES.
export const MATERIAL_STATUS_LABELS: Record<string, string> = {
  not_ordered: 'Not ordered', ordered: 'Ordered', partial: 'Partly delivered', delivered: 'Delivered', cancelled: 'Cancelled',
}
export const materialStatusLabel = (s: string | null | undefined) =>
  MATERIAL_STATUS_LABELS[String(s ?? '')] ?? String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
