// Shipday delivery dispatch.
// Customers order and pay ONLY on this website — no marketplace commission.
// When a delivery order is paid (or test_paid), the server sends it to
// Shipday, which assigns a driver for a flat per-delivery fee.
// Dispatch is best-effort: a Shipday failure never fails the customer's order.

export interface ShipdayOrder {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  items_json: {
    id: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    line_total_cents: number;
  }[];
  tax_cents: number;
  total_cents: number;
  shipday_order_id: string | null;
}

export function shipdayConfigured(): boolean {
  return Boolean(process.env.SHIPDAY_API_KEY);
}

/** Normalizes a US phone number to +1 form for Shipday. */
export function normalizePhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone;
}

export async function dispatchToShipday(
  order: ShipdayOrder
): Promise<{ ok: boolean; shipday_order_id?: string; status: string }> {
  if (order.shipday_order_id) {
    return { ok: true, shipday_order_id: order.shipday_order_id, status: "already sent" };
  }
  if (!shipdayConfigured()) {
    return { ok: false, status: "not sent — Shipday key not configured" };
  }
  try {
    const res = await fetch("https://api.shipday.com/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Shipday expects the RAW api key after "Basic" (not base64).
        Authorization: `Basic ${process.env.SHIPDAY_API_KEY}`,
      },
      body: JSON.stringify({
        orderNumber: String(order.id),
        customerName: order.customer_name ?? "Customer",
        customerAddress: order.delivery_address ?? "",
        customerPhoneNumber: normalizePhone(order.customer_phone ?? ""),
        restaurantName: "Madinah Market",
        restaurantAddress: "3126 S Parker Rd, Aurora, CO 80014, USA",
        orderItem: (order.items_json ?? []).map((l) => ({
          name: l.name,
          unitPrice: l.unit_price_cents / 100,
          quantity: l.qty,
        })),
        tax: order.tax_cents / 100,
        totalOrderCost: order.total_cents / 100,
        deliveryInstruction: "Please deliver to the address on this order.",
        orderSource: "Madinah Market website",
        paymentMethod: "credit_card",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      orderId?: number | string;
      response?: string;
    };
    if (res.ok && data && (data.success || data.orderId)) {
      return {
        ok: true,
        shipday_order_id: data.orderId ? String(data.orderId) : undefined,
        status: "sent",
      };
    }
    return {
      ok: false,
      status: `error: ${data?.response ?? `Shipday HTTP ${res.status}`}`,
    };
  } catch (err) {
    return { ok: false, status: `error: ${err instanceof Error ? err.message : "network error"}` };
  }
}
