// POST /api/track-order  { order_id, phone }
// Customer tracking. The order is returned ONLY when the phone's last 10
// digits match the phone used at checkout. The response is a sanitized
// view: no Stripe ids, no other customers' data, ever.

import { NextResponse } from "next/server";
import { getServiceClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function last10(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.slice(-10);
}

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  let orderId = 0;
  let phone = "";
  try {
    const body = (await req.json()) as { order_id?: number; phone?: string };
    orderId = Math.floor(Number(body.order_id));
    phone = String(body.phone ?? "");
  } catch {
    /* handled below */
  }
  if (!orderId || last10(phone).length < 10) {
    return NextResponse.json({ found: false }, { status: 400 });
  }
  const supabase = getServiceClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, customer_phone, items_json, subtotal_cents, tax_cents, delivery_fee_cents, tip_cents, total_cents, fulfillment, delivery_address, payment_status, kitchen_status, shipday_status, created_at"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || last10(String(order.customer_phone ?? "")) !== last10(phone)) {
    // Same answer for "no such order" and "wrong phone" — never leak which.
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    order: {
      id: order.id,
      items: order.items_json,
      subtotal_cents: order.subtotal_cents,
      tax_cents: order.tax_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      tip_cents: order.tip_cents,
      total_cents: order.total_cents,
      fulfillment: order.fulfillment,
      delivery_address: order.fulfillment === "delivery" ? order.delivery_address : null,
      payment_status: order.payment_status,
      kitchen_status: order.kitchen_status,
      shipday_status: order.shipday_status,
      created_at: order.created_at,
    },
  });
}
