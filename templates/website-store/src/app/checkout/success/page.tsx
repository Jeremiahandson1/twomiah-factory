import Link from "next/link";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { formatMoney } from "@/lib/money";
import { ClearCartOnMount } from "@/components/ClearCartOnMount";

export const dynamic = "force-dynamic";

type Search = { session_id?: string };

type OrderItem = {
  productName: string;
  variantName: string;
  quantity: number;
  lineTotalCents: number;
  imageUrl: string | null;
};

type OrderSummary = {
  orderNumber: string;
  status: string;
  email: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  items: OrderItem[];
};

async function fetchOrder(sessionId: string): Promise<OrderSummary | null> {
  const base = process.env.CRM_STORE_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/api/public/order-summary?session_id=${encodeURIComponent(
        sessionId,
      )}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { order?: OrderSummary | null };
    return data.order ?? null;
  } catch {
    return null;
  }
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { session_id } = await searchParams;

  // The crm-store backend persists the order (via its own payment webhook).
  // This page just reads it back to confirm to the buyer.
  const order = session_id ? await fetchOrder(session_id) : null;
  const paid = order?.status === "paid" || order?.status === "fulfilled";

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <ClearCartOnMount />

      <div className="text-center space-y-4">
        <CheckCircleIcon className="w-16 h-16 mx-auto text-green-600" />
        <h1 className="text-3xl font-bold">
          {paid ? "Thanks for your order!" : "Order received"}
        </h1>
        <p className="text-muted-foreground">
          {paid
            ? "We've got it — you'll receive a confirmation email shortly. We'll send another when it ships."
            : "We're still processing payment. You'll receive a confirmation email once it's complete."}
        </p>
      </div>

      {order && (
        <div className="mt-10 border border-border rounded-lg p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Order number</span>
            <span className="font-mono">{order.orderNumber}</span>
          </div>
          {order.email && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email</span>
              <span>{order.email}</span>
            </div>
          )}

          {order.items.length > 0 && (
            <ul className="border-t border-border pt-4 space-y-3">
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-4 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{item.productName}</span>
                    {item.variantName &&
                      item.variantName !== item.productName && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {item.variantName}
                        </span>
                      )}
                    <span className="text-muted-foreground">
                      {" "}
                      × {item.quantity}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    {formatMoney(item.lineTotalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border pt-4 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>{formatMoney(order.shippingCents)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax</span>
              <span>{formatMoney(order.taxCents)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold pt-2">
              <span>Total charged</span>
              <span>{formatMoney(order.totalCents)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-10 text-center">
        <Link
          href="/"
          className="inline-block bg-foreground text-background px-6 py-3 rounded-md font-medium hover:opacity-90"
        >
          Keep shopping
        </Link>
      </div>
    </main>
  );
}
