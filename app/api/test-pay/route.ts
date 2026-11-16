// POST /api/test-pay  { order_id }
// TEST MODE ONLY: marks an unpaid order "test_paid" with NO real charge and
// fires the same side-effects as a real payment (owner email + Shipday).
// Refuses to run when a real STRIPE_SECRET_KEY is configured.

import { NextResponse } from "next/server";
import { stripeTestMode } from "@/lib/stripe";
import { supabaseConfigured } from "@/lib/supabase/server";
import { markOrderPaid } from "@/lib/orders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!stripeTestMode()) {
    return NextResponse.json(
      { error: "Test mode is off — a real Stripe key is configured." },
      { status: 403 }
    );
  }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }
  let orderId = 0;
  try {
    const body = (await req.json()) as { order_id?: number };
    orderId = Math.floor(Number(body.order_id));
  } catch {
    /* handled below */
  }
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  try {
    const { order } = await markOrderPaid(orderId, "test_paid");
    return NextResponse.json({ ok: true, order_id: order.id, payment_status: "test_paid" });
  } catch (err) {
    console.error("[test-pay] failed:", err);
    return NextResponse.json({ error: "Could not mark the order as paid." }, { status: 500 });
  }
}
