// GET /api/account/orders — the signed-in customer's own order history.
// Only orders linked to their account (orders.user_id) are returned, in a
// sanitized view — the same fields the tracking page shows.

import { NextResponse } from "next/server";
import { supabaseConfigured, verifyCustomerUser, getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const user = await verifyCustomerUser(req);
  if (!user) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, items_json, subtotal_cents, tax_cents, delivery_fee_cents, tip_cents, total_cents, fulfillment, delivery_address, payment_status, kitchen_status, shipday_status, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[account/orders] query failed:", error);
    return NextResponse.json({ error: "Could not load your orders." }, { status: 500 });
  }
  return NextResponse.json({ orders: data ?? [] });
}
